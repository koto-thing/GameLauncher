import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime, fixtureClient } from "../support/rental-runtime.mjs";
import { seed } from "../../scripts/seed.mjs";
import type { PublicGame, Track } from "../../src/domain/models";

test("loudness is saved in D1 drafts and published atomically to PHP", /** @brief 実D1とPHPを通し、保存だけで公開音量が変わらないことを検証する */ async (t) => {
  const runtime = await createRuntime();
  t.after(
    /** @brief この検証専用の保存とプロセスを終了する */ () =>
      runtime.dispose(),
  );
  await seed(runtime);
  const client = await fixtureClient(runtime);
  const catalogue = (await (
    await fetch(`${runtime.php.origin}/api/public/catalogue`)
  ).json()) as PublicGame[];
  const id = catalogue[0].tracks[0].id;
  const { track } = (await client.json(`/manage/tracks/${id}`)) as {
    track: Track;
  };
  const loudness = {
    audioAssetId: track.draft.audioAssetId!,
    integratedLufs: -24,
    truePeakDbtp: -4,
  };
  await client.json(`/manage/tracks/${id}`, {
    method: "PUT",
    body: {
      version: track.version,
      position: track.position,
      draft: { ...track.draft, loudness },
    },
  });
  const saved = await client.json(`/manage/tracks/${id}`);
  assert.deepEqual(saved.track.draft.loudness, loudness);
  assert.deepEqual(saved.audio.loudness, loudness);
  const before = (await (
    await fetch(`${runtime.php.origin}/api/public/catalogue`)
  ).json()) as PublicGame[];
  assert.equal(
    before
      .flatMap(/** @brief 公開中の全曲を探す。 */ (game) => game.tracks)
      .find(/** @brief 対象曲を照合する。 */ (track) => track.id === id)
      ?.loudness,
    undefined,
  );
  await client.json(`/manage/tracks/${id}/publication`, {
    method: "POST",
    body: { version: saved.track.version, publish: true },
  });
  const after = (await (
    await fetch(`${runtime.php.origin}/api/public/catalogue`)
  ).json()) as PublicGame[];
  assert.deepEqual(
    after
      .flatMap(
        /** @brief PHP公開snapshotの全曲を探す */ (game) => game.tracks,
      )
      .find(/** @brief 更新した曲を照合する。 */ (track) => track.id === id)
      ?.loudness,
    loudness,
  );
  const current = await client.json(`/manage/tracks/${id}`);
  const rejected = await client.request(`/manage/tracks/${id}`, {
    method: "PUT",
    body: {
      version: current.track.version,
      position: current.track.position,
      draft: {
        ...current.track.draft,
        loudness: { ...loudness, audioAssetId: "wrong-asset" },
      },
    },
  });
  assert.equal(rejected.status, 400);
});
