import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, unlink, readFile } from "node:fs/promises";
import path from "node:path";
import { createRuntime, fixtureClient } from "../support/rental-runtime.mjs";
import { seed } from "../../scripts/seed.mjs";
import { encodeCommand } from "../../src/domain/command-code";
import { D1CommandReservations } from "../../../admin-web/music/infrastructure/command-codes";
import { IssueCommandCode } from "../../../admin-web/music/application/command-codes";

test(
  "command reservations + signed snapshots + public PHP lifecycle",
  { timeout: 120000 },
  /** @brief 実D1とPHPを使い、公開境界と予約の寿命を検証する */ async (t) => {
    const runtime = await createRuntime();
    t.after(
      /** @brief 所有する隔離サービスだけを停止する */ async () =>
        runtime.dispose(),
    );
    await seed(runtime);
    const admin = await fixtureClient(runtime),
      other = await fixtureClient(runtime, "music-b"),
      guest = await fixtureClient(runtime, null);
    const url = runtime.php.origin;
    /** @brief 現在snapshotだけをHTTPで取得する */
    async function catalogue() {
      return (await fetch(`${url}/api/public/catalogue`)).json();
    }
    const games = await catalogue(),
      game = games[0],
      track = game.tracks[0],
      foreign = games[1];
    const canonical = encodeCommand(track.commandCode.codeId),
      endpoint = `${url}/api/public/command-codes/v1/${canonical}`;
    assert.deepEqual(await (await fetch(endpoint)).json(), {
      trackId: track.id,
    });
    const head = await fetch(endpoint, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.match(head.headers.get("cache-control")!, /no-store/);
    assert.equal((await fetch(endpoint, { method: "POST" })).status, 405);
    for (const code of [
      "UUUUUUUUUUUU",
      "abc",
      "UUUUUUUU",
      canonical.toLowerCase(),
    ])
      assert.equal(
        (await fetch(`${url}/api/public/command-codes/v1/${code}`)).status,
        400,
      );
    assert.equal(
      (await fetch(`${url}/api/public/command-codes/v2/${canonical}`)).status,
      400,
    );
    assert.equal(
      (
        await guest.request(`/manage/tracks/${track.id}/command-code`, {
          method: "POST",
          body: {},
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await other.request(`/manage/tracks/${track.id}/command-code`, {
          method: "POST",
          body: {},
        })
      ).status,
      403,
    );
    const issued = await Promise.all(
      // GETも同じ現在権限を検証することは下記で確認する
      Array.from(
        { length: 4 },
        /** @brief 同じ曲への並行要求を実DBへ送る */ () =>
          admin.json(`/manage/tracks/${track.id}/command-code`, {
            method: "POST",
            body: {},
          }),
      ),
    );
    for (const value of issued) assert.deepEqual(value, track.commandCode);
    assert.deepEqual(await admin.json(`/manage/tracks/${track.id}/command-code`), track.commandCode);
    assert.equal((await other.request(`/manage/tracks/${track.id}/command-code`)).status, 403);
    assert.equal((await guest.request(`/manage/tracks/${track.id}/command-code`)).status, 401);
    // 乱数衝突は本物の一意制約に任せ、未発行の複製曲へ別の候補を予約する
    const copy = await admin.json(`/manage/games/${game.id}/tracks`, {
      method: "POST",
      body: { title: "copy" },
    });
    assert.equal(await admin.json(`/manage/tracks/${copy.id}/command-code`), null);
    const reservations = new D1CommandReservations(
      runtime.db as unknown as ConstructorParameters<
        typeof D1CommandReservations
      >[0],
    );
    let calls = 0;
    const actor = {
      id: "900001",
      login: "music-admin",
      admin: true,
      gameIds: [],
    } as Parameters<IssueCommandCode["issue"]>[1];
    const taken = new Set(
      games.flatMap(
        /** @brief 衝突しない試験候補を事前に選ぶ */ (g: {
          tracks: { commandCode: { codeId: number } }[];
        }) =>
          g.tracks.map(
            /** @brief 既存予約を集める */ (t) => t.commandCode.codeId,
          ),
      ),
    );
    let candidate = 0;
    while (taken.has(candidate)) candidate++;
    const issuer = new IssueCommandCode(reservations, {
      next: /** @brief 最初は必ず衝突し、次は空いているIDを返す。 */ () =>
        ++calls === 1 ? track.commandCode.codeId : candidate,
    });
    assert.equal(await issuer.issue(copy.id, actor), candidate);
    assert.equal(calls, 2);
    await runtime.db
      .prepare("DELETE FROM music_tracks WHERE id=?")
      .bind(copy.id)
      .run();
    assert.equal(await reservations.find(copy.id), candidate);
    await assert.rejects(
      runtime.db
        .prepare("DELETE FROM music_command_codes WHERE track_id=?")
        .bind(copy.id)
        .run(),
    );
    const nextCopy = await admin.json(`/manage/games/${game.id}/tracks`, {
      method: "POST",
      body: { title: "copy2" },
    });
    calls = 0;
    const next = new IssueCommandCode(reservations, {
      next: /** @brief 削除済み予約にも衝突させる。 */ () =>
        ++calls === 1 ? candidate : 0xffffff,
    });
    assert.equal(await next.issue(nextCopy.id, actor), 0xffffff);
    assert.equal(calls, 2);
    // 実公開からcode項目だけを除いて旧snapshotを再現し、下書き編集を残す
    const concurrent = await admin.json(`/manage/games/${game.id}/tracks`, {
      method: "POST",
      body: { title: "concurrent-new" },
    });
    const parallel = await Promise.all(
      Array.from(
        { length: 6 },
        /** @brief 未発行の同じ曲へ初回発行を同時に要求する */ () =>
          admin.json(`/manage/tracks/${concurrent.id}/command-code`, {
            method: "POST",
            body: {},
          }),
      ),
    );
    assert.equal(
      new Set(
        parallel.map(
          /** @brief 並行要求すべてが同じIDに収束する */ (value: {
            codeId: number;
          }) => value.codeId,
        ),
      ).size,
      1,
    );
    const exhausted = new IssueCommandCode(reservations, {
      next: /** @brief 常に予約済み候補を返し再試行上限を検査する。 */ () =>
        track.commandCode.codeId,
    });
    const noCode = await admin.json(`/manage/games/${game.id}/tracks`, {
      method: "POST",
      body: { title: "exhausted" },
    });
    await assert.rejects(exhausted.issue(noCode.id, actor), /予約が混み合/);
    const settings = JSON.parse(
      await readFile(path.join(runtime.php.directory, "settings.json"), "utf8"),
    );
    const current = JSON.parse(
      await readFile(path.join(settings.storageRoot, "current.json"), "utf8"),
    );
    const snapshotFile = path.join(
      settings.storageRoot,
      "snapshots",
      `${current.snapshot}.json`,
    );
    const snapshot = JSON.parse(await readFile(snapshotFile, "utf8"));
    for (const item of snapshot.games[game.id].tracks) delete item.commandCode;
    await writeFile(snapshotFile, JSON.stringify(snapshot));
    const before = await catalogue();
    assert.equal(before[0].tracks[0].commandCode, undefined);
    assert.equal((await fetch(endpoint)).status, 404);
    const edit = (await admin.json(`/manage/tracks/${track.id}`)).track;
    await admin.json(`/manage/tracks/${track.id}`, {
      method: "PUT",
      body: { ...edit, draft: { ...edit.draft, title: "NOT PUBLISHED DRAFT" } },
    });
    const preview = await admin.json(`/manage/games/${game.id}/command-codes`, {
      method: "POST",
      body: { dryRun: true },
    });
    assert.equal(preview.targets.length, game.tracks.length);
    assert.equal((await fetch(endpoint)).status, 404);
    for (let i = 0; i < 2; i++)
      await admin.json(`/manage/games/${game.id}/command-codes`, {
        method: "POST",
        body: { dryRun: false },
      });
    const after = await catalogue();
    assert.equal(after[0].tracks[0].title, track.title);
    assert.deepEqual(after[1], foreign);
    assert.deepEqual(after[0].tracks[0].commandCode, track.commandCode);
    assert.equal((await fetch(endpoint)).status, 200);
    const managed = (await admin.json(`/manage/games/${game.id}`)).game;
    await admin.json(`/admin/games/${game.id}/suspension`, {
      method: "PUT",
      body: { suspended: true, version: managed.version },
    });
    const hidden = await fetch(endpoint);
    assert.equal(hidden.status, 404);
    assert.deepEqual(
      await hidden.json(),
      await (
        await fetch(
          `${url}/api/public/command-codes/v1/${encodeCommand(candidate)}`,
        )
      ).json(),
    );
    const suspended = (await admin.json(`/manage/games/${game.id}`)).game;
    await admin.json(`/admin/games/${game.id}/suspension`, {
      method: "PUT",
      body: { suspended: false, version: suspended.version },
    });
    assert.equal((await fetch(endpoint)).status, 200);
    const stop = path.join(settings.storageRoot, "STOP");
    await writeFile(stop, "");
    assert.equal((await fetch(endpoint)).status, 503);
    await unlink(stop);
  },
);
