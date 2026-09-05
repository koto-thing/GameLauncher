import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime, fixtureClient } from "../support/runtime.mjs";
import { placeholderPng, toneWav } from "../support/fixtures.mjs";
import { seed } from "../../scripts/seed.mjs";
import type {
  Asset,
  Game,
  Advertisement,
  PublicGame,
  Track,
} from "../../src/domain/models.ts";
import encoded from "../support/encoded-media.json" with { type: "json" };

test("real workerd + D1 + R2 publication and authorization", /** @brief モックストレージでなく本番と同じAPIとSQLを通す。 */ async (t) => {
  const runtime = await createRuntime();
  t.after(
    /** @brief データをテストごとに隔離して閉じる。 */ async () => {
      await runtime.dispose();
    },
  );
  await seed(runtime);
  const admin = await fixtureClient(runtime);
  const author = await fixtureClient(runtime, "composer-a");
  const other = await fixtureClient(runtime, "composer-b");
  const guest = await fixtureClient(runtime, null);
  const outsider = await fixtureClient(runtime, "outsider");
  const games = (await guest.json("/public/catalogue")) as PublicGame[];
  const game = games.find(
    /** @brief 担当者Aの作品を選ぶ。 */ (item) =>
      item.title.startsWith("DEMO 1"),
  )!;
  const foreign = games.find(
    /** @brief 別作品の素材を攻撃ケースに使う。 */ (item) =>
      item.id !== game.id,
  )!;
  const original = game.tracks[0];
  await t.test(
    "public DTO exposes six tracks and no draft/account/storage key",
    /** @brief 公開レスポンスの境界を検証する。 */ async () => {
      assert.equal(games.length, 2);
      assert.equal(
        games.flatMap(/** @brief 公開曲数を集計する。 */ (item) => item.tracks)
          .length,
        6,
      );
      const serialized = JSON.stringify(games);
      for (const secret of ['"draft"', '"key"', '"admin"', '"csrf"', "900001"])
        assert.ok(!serialized.includes(secret));
    },
  );
  await t.test(
    "unauthenticated, wrong game and unassigned identities cannot modify",
    /** @brief UIを迂回したAPI操作も拒否する。 */ async () => {
      assert.equal(
        (
          await guest.request(`/manage/games/${game.id}/tracks`, {
            method: "POST",
            body: { title: "attack" },
          })
        ).status,
        401,
      );
      assert.equal(
        (await other.request(`/manage/games/${game.id}`)).status,
        403,
      );
      assert.equal(
        (await outsider.request(`/manage/games/${game.id}`)).status,
        403,
      );
      assert.equal((await author.request("/admin/settings")).status, 403);
    },
  );
  await t.test(
    "CSRF and untrusted origins are rejected",
    /** @brief Cookieだけの書き込みを許可しない。 */ async () => {
      assert.equal(
        (
          await author.request(`/manage/games/${game.id}/tracks`, {
            method: "POST",
            body: { title: "attack" },
            headers: { "X-CSRF-Token": "" },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await author.request(`/manage/games/${game.id}/tracks`, {
            method: "POST",
            body: { title: "attack" },
            headers: { Origin: "https://attacker.example" },
          })
        ).status,
        403,
      );
    },
  );
  await t.test(
    "GET HEAD and Range return correct data and status",
    /** @brief 実R2から全体・部分・不正Rangeを検証する。 */ async () => {
      const all = await guest.request(`/assets/${original.audioAssetId}`);
      const bytes = new Uint8Array(await all.arrayBuffer());
      assert.equal(all.status, 200);
      assert.equal(all.headers.get("Content-Length"), String(bytes.length));
      assert.match(all.headers.get("Cache-Control")!, /no-store/);
      const partial = await guest.request(`/assets/${original.audioAssetId}`, {
        headers: { Range: "bytes=0-9" },
      });
      assert.equal(partial.status, 206);
      assert.equal(
        partial.headers.get("Content-Range"),
        `bytes 0-9/${bytes.length}`,
      );
      assert.deepEqual(
        new Uint8Array(await partial.arrayBuffer()),
        bytes.slice(0, 10),
      );
      const head = await guest.request(`/assets/${original.audioAssetId}`, {
        method: "HEAD",
      });
      assert.equal(head.status, 200);
      assert.equal((await head.arrayBuffer()).byteLength, 0);
      assert.equal(head.headers.get("Content-Length"), String(bytes.length));
      const invalid = await guest.request(`/assets/${original.audioAssetId}`, {
        headers: { Range: `bytes=${bytes.length}-` },
      });
      assert.equal(invalid.status, 416);
      assert.equal(
        invalid.headers.get("Content-Range"),
        `bytes */${bytes.length}`,
      );
    },
  );
  let draft: Track;
  await t.test(
    "MP3 JPEG WebP metadata are validated from actual encoded fixtures",
    /** @brief 拡張子だけでなく実際の3形式をR2から検証する。 */ async () => {
      const mp3 = await author.json<Asset>(
        `/manage/games/${game.id}/assets/audio`,
        { method: "POST", bytes: Buffer.from(encoded.mp3, "base64") },
      );
      assert.equal(mp3.mime, "audio/mpeg");
      assert.ok(mp3.durationSeconds! >= 4 && mp3.durationSeconds! < 4.2);
      for (const [key, mime] of [
        ["jpeg", "image/jpeg"],
        ["webp", "image/webp"],
      ] as const) {
        const image = await author.json<Asset>(
          `/manage/games/${game.id}/assets/image`,
          { method: "POST", bytes: Buffer.from(encoded[key], "base64") },
        );
        assert.equal(image.mime, mime);
        assert.equal(image.widthPixels, 480);
        assert.equal(image.heightPixels, 270);
      }
    },
  );
  await t.test(
    "draft upload is private and supports retry after invalid/truncated files",
    /** @brief 失敗素材は公開されず再送で新しいIDを発行する。 */ async () => {
      draft = await author.json<Track>(`/manage/games/${game.id}/tracks`, {
        method: "POST",
        body: { title: "integration draft" },
      });
      assert.equal(
        (
          await author.request(`/manage/games/${game.id}/assets/audio`, {
            method: "POST",
            bytes: Buffer.from("<html>bad</html>"),
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await author.request(`/manage/games/${game.id}/assets/audio`, {
            method: "POST",
            bytes: toneWav().subarray(0, 100),
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await author.request(`/manage/games/${game.id}/assets/image`, {
            method: "POST",
            bytes: placeholderPng().subarray(0, 80),
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await author.request(`/manage/games/${game.id}/assets/image`, {
            method: "POST",
            bytes: Buffer.from(
              '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
            ),
          })
        ).status,
        400,
      );
      const audio = await author.json<Asset>(
        `/manage/games/${game.id}/assets/audio`,
        { method: "POST", bytes: toneWav() },
      );
      assert.equal(audio.status, "verified");
      assert.equal((await guest.request(`/assets/${audio.id}`)).status, 404);
      assert.equal((await author.request(`/assets/${audio.id}`)).status, 200);
      await author.json(`/manage/tracks/${draft.id}`, {
        method: "PUT",
        body: {
          draft: { ...draft.draft, audioAssetId: audio.id },
          position: draft.position,
          version: draft.version,
        },
      });
      draft = (
        await author.json<{ track: Track }>(`/manage/tracks/${draft.id}`)
      ).track;
    },
  );
  await t.test(
    "foreign assets, unverified assets and missing rights are rejected",
    /** @brief 素材ID差し込みと公開条件を検証する。 */ async () => {
      assert.equal(
        (
          await author.request(`/manage/tracks/${draft.id}`, {
            method: "PUT",
            body: {
              draft: { ...draft.draft, imageAssetId: foreign.imageAssetId },
              position: 1,
              version: draft.version,
            },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await author.request(`/manage/tracks/${draft.id}`, {
            method: "PUT",
            body: {
              draft: {
                ...draft.draft,
                audioAssetId: foreign.tracks[0].audioAssetId,
              },
              position: 1,
              version: draft.version,
            },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await author.request(`/manage/tracks/${draft.id}/publication`, {
            method: "POST",
            body: { publish: true, version: draft.version },
          })
        ).status,
        400,
      );
      const db = await runtime.getD1Database("MUSIC_DB");
      const pending = await db
        .prepare(
          "SELECT id FROM assets WHERE status='pending' AND kind='audio' LIMIT 1",
        )
        .first();
      assert.equal(
        (
          await author.request(`/manage/tracks/${draft.id}`, {
            method: "PUT",
            body: {
              draft: { ...draft.draft, audioAssetId: pending!.id },
              position: 1,
              version: draft.version,
            },
          })
        ).status,
        400,
      );
    },
  );
  await t.test(
    "author publishes directly; concurrent stale saves return 409",
    /** @brief 運営承認なしで公開でき、後勝ち上書きが起きない。 */ async () => {
      const content = {
        ...draft.draft,
        credits: [{ name: "Test", role: "作曲" }],
        rightsConfirmed: true,
        loop: { startSeconds: 1, endSeconds: 3 },
      };
      const options = {
        method: "PUT",
        body: { draft: content, position: 1, version: draft.version },
      };
      const responses = await Promise.all([
        author.request(`/manage/tracks/${draft.id}`, options),
        author.request(`/manage/tracks/${draft.id}`, options),
      ]);
      assert.deepEqual(
        responses
          .map(
            /** @brief 一方だけが保存成功することを確認する。 */ (response) =>
              response.status,
          )
          .sort(),
        [200, 409],
      );
      draft = (
        await author.json<{ track: Track }>(`/manage/tracks/${draft.id}`)
      ).track;
      assert.equal(
        (
          await author.request(`/manage/tracks/${draft.id}/publication`, {
            method: "POST",
            body: { publish: true, version: draft.version },
          })
        ).status,
        200,
      );
      draft = (
        await author.json<{ track: Track }>(`/manage/tracks/${draft.id}`)
      ).track;
    },
  );
  await t.test(
    "draft snapshot changes do not alter public title/audio/loop/order",
    /** @brief 公開スナップショットの整合性を確認する。 */ async () => {
      await author.json(`/manage/tracks/${draft.id}`, {
        method: "PUT",
        body: {
          draft: {
            ...draft.draft,
            title: "private edit",
            loop: { startSeconds: 0.5, endSeconds: 2 },
          },
          position: 500,
          version: draft.version,
        },
      });
      draft = (
        await author.json<{ track: Track }>(`/manage/tracks/${draft.id}`)
      ).track;
      const publicGame = (
        (await guest.json("/public/catalogue")) as PublicGame[]
      ).find(
        /** @brief 公開作品を再取得する。 */ (item) => item.id === game.id,
      )!;
      const publicTrack = publicGame.tracks.find(
        /** @brief 公開版を比較する。 */ (item) => item.id === draft.id,
      )!;
      assert.equal(publicTrack.title, "integration draft");
      assert.equal(publicTrack.position, 1);
      assert.deepEqual(publicTrack.loop, { startSeconds: 1, endSeconds: 3 });
    },
  );
  await t.test(
    "unpublish blocks future direct asset access while editor preview remains valid",
    /** @brief キャッシュ前の公開状態確認を検証する。 */ async () => {
      await author.json(`/manage/tracks/${draft.id}/publication`, {
        method: "POST",
        body: { publish: false, version: draft.version },
      });
      assert.equal(
        (await guest.request(`/assets/${draft.draft.audioAssetId}`)).status,
        404,
      );
      assert.equal(
        (await author.request(`/assets/${draft.draft.audioAssetId}`)).status,
        200,
      );
    },
  );
  await t.test(
    "revoked membership takes effect on the next request with the old session",
    /** @brief 古いCookieで権限解除を迂回できない。 */ async () => {
      await admin.json(`/admin/games/${game.id}/members/900002`, {
        method: "PUT",
        body: { enabled: false },
      });
      assert.equal(
        (await author.request(`/manage/games/${game.id}`)).status,
        403,
      );
      assert.equal(
        (await author.request(`/assets/${draft.draft.audioAssetId}`)).status,
        404,
      );
      await admin.json(`/admin/games/${game.id}/members/900002`, {
        method: "PUT",
        body: { enabled: true },
      });
    },
  );
  await t.test(
    "game suspension blocks catalogue, audio and artwork and cannot be undone by author",
    /** @brief 曲が公開済みでも作品停止を優先する。 */ async () => {
      let current = (
        await admin.json<{ game: Game }>(`/manage/games/${game.id}`)
      ).game;
      await admin.json(`/admin/games/${game.id}/suspension`, {
        method: "PUT",
        body: { suspended: true, version: current.version },
      });
      assert.equal(
        (await guest.request(`/assets/${original.audioAssetId}`)).status,
        404,
      );
      assert.equal(
        (await guest.request(`/assets/${game.imageAssetId}`)).status,
        404,
      );
      current = (await author.json<{ game: Game }>(`/manage/games/${game.id}`))
        .game;
      assert.equal(
        (
          await author.request(`/manage/games/${game.id}/publication`, {
            method: "POST",
            body: { publish: true, version: current.version },
          })
        ).status,
        400,
      );
      await admin.json(`/admin/games/${game.id}/suspension`, {
        method: "PUT",
        body: { suspended: false, version: current.version },
      });
    },
  );
  await t.test(
    "only admin may enable banner; disable removes public asset reference",
    /** @brief 広告の素材参照と権限を検証する。 */ async () => {
      const image = await admin.json<Asset>(
        `/manage/games/${game.id}/assets/image`,
        { method: "POST", bytes: placeholderPng() },
      );
      const settings = await admin.json<{ advertisement: Advertisement }>(
        "/admin/settings",
      );
      const ad = {
        ...settings.advertisement,
        enabled: true,
        imageAssetId: image.id,
        href: "https://example.com",
        alt: "検証バナー",
      };
      assert.equal(
        (
          await author.request("/admin/advertisement", {
            method: "PUT",
            body: ad,
          })
        ).status,
        403,
      );
      await admin.json("/admin/advertisement", { method: "PUT", body: ad });
      assert.equal((await guest.request(`/assets/${image.id}`)).status, 200);
      await admin.json("/admin/advertisement", {
        method: "PUT",
        body: { ...ad, enabled: false, version: ad.version + 1 },
      });
      assert.equal((await guest.request(`/assets/${image.id}`)).status, 404);
      assert.deepEqual(await guest.json("/public/ad"), { enabled: false });
    },
  );
  await t.test(
    "session logout invalidates stored tokens and upload throttling returns 429",
    /** @brief セッション失効と過剰操作制限を実DBで確認する。 */ async () => {
      await outsider.json("/auth/logout", { method: "POST" });
      assert.equal(await outsider.json("/auth/me"), null);
      const db = await runtime.getD1Database("MUSIC_DB");
      await db
        .prepare(
          "INSERT INTO rate_limits VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET window=excluded.window,count=excluded.count",
        )
        .bind("upload:900002", Math.floor(Date.now() / 60000), 20)
        .run();
      assert.equal(
        (
          await author.request(`/manage/games/${game.id}/assets/audio`, {
            method: "POST",
            bytes: toneWav(),
          })
        ).status,
        429,
      );
    },
  );
});
test("production entrypoint does not provide test login even with local configuration", /** @brief デモ認証の本番混入を実Workerで否定する。 */ async (t) => {
  const runtime = await createRuntime({ production: true });
  t.after(
    /** @brief 本番入口テスト環境を閉じる。 */ async () => {
      await runtime.dispose();
    },
  );
  assert.equal(
    (
      await runtime.dispatchFetch("http://127.0.0.1:5173/api/local/login", {
        method: "POST",
        headers: {
          Origin: "http://127.0.0.1:5173",
          "Content-Type": "application/json",
        },
        body: '{"account":"admin"}',
      })
    ).status,
    401,
  );
  assert.equal(
    (await runtime.dispatchFetch("http://127.0.0.1:5173/api/auth/login"))
      .status,
    503,
  );
});
