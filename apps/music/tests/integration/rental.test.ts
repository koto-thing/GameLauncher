import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, utimes, stat } from "node:fs/promises";
import path from "node:path";
import {
  createRuntime,
  createPhpServer,
  fixtureClient,
} from "../support/rental-runtime.mjs";
import { seed } from "../../scripts/seed.mjs";
import { toneWav, placeholderPng } from "../support/fixtures.mjs";
import { signatureHeaders } from "../../../admin-web/music/infrastructure/bridge.ts";
import type { Envelope } from "../../../../contracts/music/bridge-v1.ts";
import encoded from "../support/encoded-media.json" with { type: "json" };

test("control-plane D1 + actual PHP publication, permissions and recovery", /** @brief 外部GitHub以外の実システム境界を通して検証する。 */ async (t) => {
  const runtime = await createRuntime();
  t.after(
    /** @brief 所有する実行環境を終了する。 */ async () => runtime.dispose(),
  );
  await seed(runtime);
  const admin = await fixtureClient(runtime);
  const author = await fixtureClient(runtime, "music-a");
  const other = await fixtureClient(runtime, "music-b");
  const outsider = await fixtureClient(runtime, "outsider");
  const gamer = await fixtureClient(runtime, "maintainer");
  const guest = await fixtureClient(runtime, null);
  /** @brief 公開情報は管理サービスを経由せずPHPから読む。 @returns 公開カタログ。 */
  async function catalogue() {
    return (await fetch(`${runtime.php.origin}/api/public/catalogue`)).json();
  }
  const games = await catalogue();
  const game = games.find(
    /** @brief 担当作品Aを選ぶ。 */ (g: { title: string }) =>
      g.title.startsWith("DEMO 1"),
  );
  const foreign = games.find(
    /** @brief 別作品Bを選ぶ。 */ (g: { id: string }) => g.id !== game.id,
  );
  const original = game.tracks[0];
  /** @brief ローカル配信への一般要求を送る。 @param id 素材。 @param options HTTP設定。 @returns HTTP応答。 */
  const media = (id: string, options?: RequestInit) =>
    fetch(`${runtime.php.origin}/api/assets/${id}`, options);

  await t.test(
    "game, Music-only, unassigned and anonymous permissions remain separate",
    /** @brief ゲームデータとゲーム書込をMusic Cookieで読めない。 */ async () => {
      assert.equal((await gamer.json("/api/dashboard")).authenticated, true);
      for (const client of [admin, author, other, outsider]) {
        assert.equal((await client.request("/api/dashboard")).status, 403);
        assert.equal(
          (
            await client.request("/api/control", {
              method: "POST",
              body: { action: "dispatch_request", requestId: "anything" },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await client.request("/api/intake/uploads", {
              method: "POST",
              body: {},
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await client.request("/api/actions/preflight", {
              method: "POST",
              body: {},
            })
          ).status,
          401,
        );
      }
      assert.equal((await gamer.request("/manage/games")).status, 403);
      assert.equal((await outsider.request("/manage/games")).status, 403);
      assert.equal((await guest.request("/manage/games")).status, 401);
      assert.equal((await author.json("/manage/games")).length, 1);
      assert.equal(
        await runtime.db
          .prepare("SELECT * FROM music_accounts WHERE id='900004'")
          .first(),
        null,
      );
    },
  );
  await t.test(
    "scope, admin-only settings and CSRF reject direct API attacks",
    /** @brief 別作品のIDと同一Cookieでの越権を拒否する。 */ async () => {
      assert.equal(
        (await author.request(`/manage/games/${foreign.id}`)).status,
        403,
      );
      assert.equal(
        (await author.request(`/manage/tracks/${foreign.tracks[0].id}`)).status,
        403,
      );
      assert.equal((await author.request("/admin/settings")).status, 403);
      assert.equal(
        (
          await author.request(`/admin/games/${game.id}/members/900004`, {
            method: "PUT",
            body: { enabled: true },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await author.request(`/manage/games/${game.id}`, {
            method: "PUT",
            body: {},
            headers: { Origin: "https://evil.invalid" },
          })
        ).status,
        403,
      );
      const current = (await author.json(`/manage/tracks/${original.id}`))
        .track;
      const attempt = await author.request(`/manage/tracks/${original.id}`, {
        method: "PUT",
        body: {
          ...current,
          draft: {
            ...current.draft,
            audioAssetId: foreign.tracks[0].audioAssetId,
            loop: null,
          },
        },
      });
      assert.equal(attempt.status, 400);
    },
  );
  await t.test(
    "drafts, preview, stale versions and old URLs are protected",
    /** @brief 下書き編集は公開版を変更せず素材URLも漏れない。 */ async () => {
      const audio = await author.upload(game.id, "audio", toneWav(9));
      assert.equal((await media(audio.id)).status, 404);
      assert.equal((await guest.request(`/assets/${audio.id}`)).status, 401);
      assert.equal((await other.request(`/assets/${audio.id}`)).status, 403);
      assert.equal((await author.request(`/assets/${audio.id}`)).status, 200);
      for (const url of [
        `/private/assets/${audio.id}.bin`,
        `/var/assets/${audio.id}.bin`,
        "/snapshots/current.json",
        "/src/Store.php",
        "/config/local.php",
      ])
        assert.equal((await fetch(runtime.php.origin + url)).status, 404);
      const { track } = await author.json(`/manage/tracks/${original.id}`);
      const body = {
        draft: { ...track.draft, title: "編集中の非公開タイトル" },
        position: track.position,
        version: track.version,
      };
      await author.json(`/manage/tracks/${track.id}`, { method: "PUT", body });
      assert.equal(
        (
          await author.request(`/manage/tracks/${track.id}`, {
            method: "PUT",
            body,
          })
        ).status,
        409,
      );
      assert.equal(
        (await catalogue()).find(
          /** @brief 公開対象の作品を照合する。 */ (g: { id: string }) =>
            g.id === game.id,
        ).tracks[0].title,
        original.title,
      );
    },
  );
  await t.test(
    "PHP validates MP3, PCM WAV and image metadata; upload retries are immutable",
    /** @brief MIME偽装・切断・digest変更・実行ファイルを拒否する。 */ async () => {
      const bytes = toneWav(4);
      const start = await author.json("/uploads", {
        method: "POST",
        body: {
          gameId: game.id,
          kind: "audio",
          bytes: bytes.length,
          mime: "audio/wav",
          digest: createHash("sha256").update(bytes).digest("hex"),
        },
      });
      assert.equal(
        (await other.request(`/uploads/${start.id}`, { method: "PUT", bytes }))
          .status,
        403,
      );
      assert.equal(
        (
          await author.request(`/uploads/${start.id}`, {
            method: "PUT",
            bytes: bytes.subarray(0, 40),
          })
        ).status,
        400,
      );
      const asset = await author.json(`/uploads/${start.id}`, {
        method: "PUT",
        bytes,
      });
      assert.equal(asset.durationSeconds, 4);
      assert.equal(asset.sampleRateHz, 24000);
      assert.equal(
        (await author.json(`/uploads/${start.id}`, { method: "PUT", bytes }))
          .id,
        asset.id,
      );
      const altered = Buffer.from(bytes);
      altered[100] ^= 1;
      assert.equal(
        (
          await author.request(`/uploads/${start.id}`, {
            method: "PUT",
            bytes: altered,
          })
        ).status,
        400,
      );
      await assert.rejects(
        author.upload(
          game.id,
          "image",
          Buffer.from("<?php echo 'bad';"),
          "image/png",
        ),
      );
      await assert.rejects(
        author.upload(game.id, "image", placeholderPng(), "image/jpeg"),
      );
      const mp3 = await author.upload(
        game.id,
        "audio",
        Buffer.from(encoded.mp3, "base64"),
        "audio/mpeg",
      );
      assert.equal(mp3.mime, "audio/mpeg");
      for (const [bytes, mime] of [
        [encoded.jpeg, "image/jpeg"],
        [encoded.webp, "image/webp"],
      ]) {
        const image = await author.upload(
          game.id,
          "image",
          Buffer.from(bytes, "base64"),
          mime,
        );
        assert.equal(image.mime, mime);
        assert.ok(image.widthPixels > 0);
      }
    },
  );
  await t.test(
    "GET HEAD suffix Range open Range and invalid ranges have exact headers",
    /** @brief 公開チェック後にbyte単位の応答を検証する。 */ async () => {
      const full = await media(original.audioAssetId);
      const bytes = Buffer.from(await full.arrayBuffer());
      assert.equal(full.status, 200);
      assert.match(full.headers.get("cache-control")!, /no-store/);
      const head = await media(original.audioAssetId, { method: "HEAD" });
      assert.equal(head.status, 200);
      assert.equal(Number(head.headers.get("content-length")), bytes.length);
      assert.equal((await head.arrayBuffer()).byteLength, 0);
      for (const [header, start, length] of [
        ["bytes=0-15", 0, 16],
        ["bytes=-10", bytes.length - 10, 10],
        [`bytes=${bytes.length - 4}-`, bytes.length - 4, 4],
      ] as const) {
        const response = await media(original.audioAssetId, {
          headers: { Range: header },
        });
        assert.equal(response.status, 206);
        assert.equal(Number(response.headers.get("content-length")), length);
        assert.equal(
          response.headers.get("content-range"),
          `bytes ${start}-${start + length - 1}/${bytes.length}`,
        );
        assert.deepEqual(
          Buffer.from(await response.arrayBuffer()),
          bytes.subarray(start, start + length),
        );
      }
      for (const Range of [
        "bytes=9999999-",
        "bytes=1-0",
        "bytes=0-1,4-8",
        "bytes=-0",
      ])
        assert.equal(
          (await media(original.audioAssetId, { headers: { Range } })).status,
          416,
        );
    },
  );
  await t.test(
    "atomic switch failure leaves old catalogue and blocks competing operations",
    /** @brief 切替前に停止しても古い公開版を保ち、固定した内容だけ再送する。 */ async () => {
      const { track } = await author.json(`/manage/tracks/${original.id}`);
      await runtime.php.fault("before-switch");
      assert.equal(
        (
          await author.request(`/manage/tracks/${track.id}/publication`, {
            method: "POST",
            body: { version: track.version, publish: true },
          })
        ).status,
        503,
      );
      assert.equal(
        (await catalogue()).find(
          /** @brief 公開対象の作品を照合する。 */ (g: { id: string }) =>
            g.id === game.id,
        ).tracks[0].title,
        original.title,
      );
      const pending = (await author.json("/publications")).find(
        /** @brief 結果不明の元操作を選ぶ。 */ (op: { state: string }) =>
          op.state === "unknown",
      );
      assert.ok(pending);
      assert.equal(
        (
          await author.request(`/manage/tracks/${track.id}/publication`, {
            method: "POST",
            body: { version: track.version, publish: false },
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await other.request(`/publications/${pending.id}/retry`, {
            method: "POST",
            body: {},
          })
        ).status,
        403,
      );
      await runtime.php.fault("");
      await author.json(`/publications/${pending.id}/retry`, {
        method: "POST",
        body: {},
      });
      assert.equal(
        (await catalogue()).find(
          /** @brief 公開対象の作品を照合する。 */ (g: { id: string }) =>
            g.id === game.id,
        ).tracks[0].title,
        "編集中の非公開タイトル",
      );
    },
  );
  await t.test(
    "lost receipt after switch reconciles without republishing; withdrawal stops all new requests",
    /** @brief 切替直後の応答消失を同じIDで確認し、304/Rangeでも非公開素材を返さない。 */ async () => {
      const { track } = await author.json(`/manage/tracks/${original.id}`);
      await runtime.php.fault("after-switch");
      assert.equal(
        (
          await author.request(`/manage/tracks/${track.id}/publication`, {
            method: "POST",
            body: { version: track.version, publish: false },
          })
        ).status,
        503,
      );
      const pending = (await author.json("/publications")).find(
        /** @brief 結果不明の元操作を選ぶ。 */ (op: { state: string }) =>
          op.state === "unknown",
      );
      assert.ok(pending);
      assert.ok(
        (await author.json(`/manage/tracks/${track.id}`)).track.published,
      );
      for (const options of [
        {},
        { method: "HEAD" },
        { headers: { Range: "bytes=0-100" } },
        {
          headers: {
            "If-None-Match": "*",
            "If-Modified-Since": new Date().toUTCString(),
          },
        },
      ] as RequestInit[]) {
        assert.equal((await media(original.audioAssetId, options)).status, 404);
        assert.equal((await media(original.imageAssetId, options)).status, 404);
      }
      await runtime.php.fault("");
      await author.json(`/publications/${pending.id}/retry`, {
        method: "POST",
        body: {},
      });
      assert.equal(
        (await author.json(`/manage/tracks/${track.id}`)).track.published,
        null,
      );
      await author.json(`/publications/${pending.id}/retry`, {
        method: "POST",
        body: {},
      });
      assert.equal(
        (await catalogue()).find(
          /** @brief 公開対象の作品を照合する。 */ (g: { id: string }) =>
            g.id === foreign.id,
        ).tracks.length,
        3,
      );
    },
  );
  await t.test(
    "membership revocation takes effect with the existing cookie",
    /** @brief Cookieを作り直さず次のAPIを拒否する。 */ async () => {
      await admin.json(`/admin/games/${game.id}/members/900002`, {
        method: "PUT",
        body: { enabled: false },
      });
      assert.equal(
        (await author.request(`/manage/games/${game.id}`)).status,
        403,
      );
      assert.equal(
        (await author.request(`/assets/${original.audioAssetId}`)).status,
        403,
      );
      await admin.json(`/admin/games/${game.id}/members/900002`, {
        method: "PUT",
        body: { enabled: true },
      });
    },
  );
  await t.test(
    "signature target, nonce, timestamps and idempotency are bound across TS and PHP",
    /** @brief 認証済みエンベロープへの攻撃を実HTTPで検証する。 */ async () => {
      const row = await runtime.db
        .prepare(
          "SELECT * FROM music_publications WHERE scope=? AND state='applied' ORDER BY created_at DESC LIMIT 1",
        )
        .bind(game.id)
        .first();
      const now = Math.floor(Date.now() / 1000);
      const base: Envelope = {
        protocolVersion: 1,
        keyId: "primary",
        audience: "pandd-music",
        environment: "local",
        method: "POST",
        path: "/bridge.php",
        issuedAt: now,
        expiresAt: now + 120,
        nonce: crypto.randomUUID(),
        operationId: row.id,
        actorId: "900001",
        gameId: game.id,
        assetId: null,
        action: "status",
        expectedRevision: row.expected_revision,
        payloadDigest: row.digest,
        bytes: 0,
        kind: null,
        mime: null,
      };
      /** @brief TypeScript署名をPHPに送る。 @param envelope エンベロープ。 @returns HTTP応答。 */
      async function send(envelope: Envelope) {
        return fetch(`${runtime.php.origin}/bridge.php`, {
          method: "POST",
          headers: await signatureHeaders(envelope, runtime.php.secret),
        });
      }
      assert.equal((await send(base)).status, 200);
      assert.equal((await send(base)).status, 409);
      for (const change of [
        { environment: "production" },
        { path: "/another.php" },
        { issuedAt: now + 90, expiresAt: now + 120 },
        { issuedAt: now - 200, expiresAt: now - 1 },
      ])
        assert.ok(
          (await send({ ...base, ...change, nonce: crypto.randomUUID() }))
            .status >= 400,
        );
      assert.equal(
        (
          await send({
            ...base,
            gameId: foreign.id,
            nonce: crypto.randomUUID(),
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await send({
            ...base,
            payloadDigest: "0".repeat(64),
            nonce: crypto.randomUUID(),
          })
        ).status,
        409,
      );
      const headers = await signatureHeaders(
        { ...base, nonce: crypto.randomUUID() },
        runtime.php.secret,
      );
      headers["X-Music-Signature"] = "0".repeat(64);
      assert.equal(
        (
          await fetch(`${runtime.php.origin}/bridge.php`, {
            method: "POST",
            headers,
          })
        ).status,
        401,
      );
    },
  );
  await t.test(
    "corrupt or missing current pointer fails closed and never revives withdrawn tracks",
    /** @brief 参照破損時に履歴snapshotへ戻さない。 */ async () => {
      const file = path.join(runtime.php.config.storageRoot, "current.json");
      const valid = await readFile(file, "utf8");
      await writeFile(file, "broken");
      assert.equal(
        (await fetch(`${runtime.php.origin}/api/public/catalogue`)).status,
        503,
      );
      assert.equal((await media(foreign.tracks[0].audioAssetId)).status, 503);
      await writeFile(file, valid);
    },
  );
  await t.test(
    "D1 confirmation failure is reconciled without overwriting a newer draft",
    /** @brief PHP成功後にD1 batchだけを失敗させ同じ操作で追従する。 */ async () => {
      const { track } = await other.json(
        `/manage/tracks/${foreign.tracks[0].id}`,
      );
      await runtime.db.exec(
        "CREATE TRIGGER test_confirmation_failure BEFORE UPDATE ON music_publications WHEN NEW.state='applied' BEGIN SELECT RAISE(ABORT,'injected confirmation failure'); END;",
      );
      assert.equal(
        (
          await other.request(`/manage/tracks/${track.id}/publication`, {
            method: "POST",
            body: { version: track.version, publish: true },
          })
        ).status,
        503,
      );
      await runtime.db.exec("DROP TRIGGER test_confirmation_failure;");
      const pending = (await other.json("/publications")).find(
        /** @brief D1未確定操作を選ぶ。 */ (op: { state: string }) =>
          op.state === "unknown",
      );
      assert.ok(pending);
      await other.json(`/manage/tracks/${track.id}`, {
        method: "PUT",
        body: {
          version: track.version,
          position: track.position,
          draft: { ...track.draft, title: "確認待ち中に編集した下書き" },
        },
      });
      await other.json(`/publications/${pending.id}/retry`, {
        method: "POST",
        body: {},
      });
      const saved = (await other.json(`/manage/tracks/${track.id}`)).track;
      assert.equal(saved.draft.title, "確認待ち中に編集した下書き");
      assert.equal(saved.published.title, track.published.title);
    },
  );
  await t.test(
    "different works and advertisement merge concurrently; same work conflicts",
    /** @brief 最新snapshotへscope単位で合成し同じ作品の競合は拒否する。 */ async () => {
      const first = (await author.json(`/manage/games/${game.id}`)).game;
      const second = (await other.json(`/manage/games/${foreign.id}`)).game;
      const ad = (await admin.json("/admin/settings")).advertisement;
      await Promise.all([
        author.json(`/manage/games/${first.id}/publication`, {
          method: "POST",
          body: { version: first.version, publish: true },
        }),
        other.json(`/manage/games/${second.id}/publication`, {
          method: "POST",
          body: { version: second.version, publish: true },
        }),
        admin.json("/admin/advertisement", {
          method: "PUT",
          body: {
            ...ad,
            enabled: true,
            imageAssetId: original.imageAssetId,
            href: "https://example.com/",
            alt: "検証広告",
          },
        }),
      ]);
      assert.equal((await catalogue()).length, 2);
      assert.equal(
        (await (await fetch(`${runtime.php.origin}/api/public/ad`)).json())
          .enabled,
        true,
      );
      const current = (await author.json(`/manage/games/${game.id}`)).game;
      const responses = await Promise.all(
        [true, true].map(
          /** @brief 同じ期待版の操作を同時送信する。 */ () =>
            author.request(`/manage/games/${game.id}/publication`, {
              method: "POST",
              body: { version: current.version, publish: true },
            }),
        ),
      );
      assert.deepEqual(
        responses
          .map(
            /** @brief 応答順によらず競合を調べる。 */ (response: Response) =>
              response.status,
          )
          .sort(),
        [200, 409],
      );
      const updatedAd = (await admin.json("/admin/settings")).advertisement;
      await admin.json("/admin/advertisement", {
        method: "PUT",
        body: { ...updatedAd, enabled: false },
      });
      assert.equal((await media(original.imageAssetId)).status, 404);
    },
  );
});

test("private storage verification, temporary cleanup and two PHP processes", /** @brief 本物のfilesystem lockと運用CLIを別プロセスから試験する。 */ async (t) => {
  const runtime = await createRuntime();
  t.after(/** @brief 自分の環境を閉じる。 */ () => runtime.dispose());
  await seed(runtime);
  const root = runtime.php.config.storageRoot;
  const orphan = path.join(root, "tmp/upload-orphan"),
    fresh = path.join(root, "tmp/upload-fresh"),
    staleSnapshot = path.join(root, "snapshots", `${"f".repeat(32)}.json`);
  await writeFile(orphan, "orphan");
  await writeFile(fresh, "fresh");
  await writeFile(staleSnapshot, "{}");
  const old = new Date(Date.now() - 172800000);
  await utimes(orphan, old, old);
  await utimes(staleSnapshot, old, old);
  const before = await runtime.php.cli("verify-storage.php");
  assert.ok(before.assetsVerified >= 14);
  assert.ok(before.receipts <= 3);
  const dry = await runtime.php.cli("cleanup.php");
  assert.equal(dry.dryRun, true);
  assert.equal(dry.files.length, 1);
  assert.ok(await stat(orphan));
  const applied = await runtime.php.cli("cleanup.php", ["--apply"]);
  assert.equal(applied.files.length, 1);
  await assert.rejects(stat(orphan));
  assert.ok(await stat(fresh));
  assert.equal(
    (await runtime.php.cli("verify-storage.php")).assetsVerified,
    before.assetsVerified,
  );
  const second = await createPhpServer({
    directory: runtime.php.directory,
    secret: runtime.php.secret,
  });
  t.after(/** @brief 2番目のPHPを閉じる。 */ () => second.close());
  const rows = (
    await runtime.db
      .prepare(
        "SELECT p.* FROM music_publications p JOIN music_delivery d ON p.scope=d.scope AND p.expected_revision=d.revision-1 WHERE p.state='applied'",
      )
      .all()
  ).results;
  assert.equal(rows.length, 2);
  /** @brief 同じ私有storeへ別PHPプロセスから署名公開を送る。 @param index scope位置。 @param origin PHP origin。 @returns 応答。 */
  async function apply(index: number, origin: string) {
    const row = rows[index];
    const now = Math.floor(Date.now() / 1000);
    const envelope: Envelope = {
      protocolVersion: 1,
      keyId: "primary",
      audience: "pandd-music",
      environment: "local",
      method: "POST",
      path: "/bridge.php",
      issuedAt: now,
      expiresAt: now + 120,
      nonce: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      actorId: "900001",
      gameId: row.scope,
      assetId: null,
      action: "publish",
      expectedRevision: row.expected_revision + 1,
      payloadDigest: row.digest,
      bytes: 0,
      kind: null,
      mime: null,
    };
    return fetch(`${origin}/bridge.php`, {
      method: "POST",
      headers: await signatureHeaders(envelope, runtime.php.secret),
      body: row.payload,
    });
  }
  const separate = await Promise.all([
    apply(0, runtime.php.origin),
    apply(1, second.origin),
  ]);
  for (const response of separate) assert.equal(response.status, 200);
  await assert.rejects(stat(staleSnapshot));
  const revision = (await runtime.php.cli("verify-storage.php")).revision;
  rows[0].expected_revision++;
  const same = await Promise.all([
    apply(0, runtime.php.origin),
    apply(0, second.origin),
  ]);
  assert.deepEqual(
    same
      .map(/** @brief 排他の勝敗を確認する。 */ (response) => response.status)
      .sort(),
    [200, 409],
  );
  assert.equal(
    (await runtime.php.cli("verify-storage.php")).revision,
    revision + 1,
  );
});

test("Music OFF keeps existing game management working", /** @brief Music機能フラグからゲームAPIへ障害を広げない。 */ async (t) => {
  const runtime = await createRuntime({ enabled: false });
  t.after(/** @brief 隔離環境を停止する。 */ async () => runtime.dispose());
  const gamer = await fixtureClient(runtime, "admin");
  assert.equal((await gamer.json("/api/dashboard")).authenticated, true);
  assert.equal((await gamer.request("/manage/games")).status, 503);
  assert.equal((await gamer.json("/session")).config.enabled, false);
});
