import test from "node:test";
import assert from "node:assert/strict";
import {
  authorize,
  createLoopRegion,
  gameContent,
  nextTrack,
  playbackPosition,
  safeUrl,
  seekPosition,
  shuffledQueue,
  trackContent,
  validateAsset,
  validatePolicy,
} from "../../src/domain/rules.ts";
import { DOMAIN_POLICY_DEFAULTS as policy } from "../../src/config/domain-policy.defaults.ts";
import { byteRange } from "../../src/presentation/api/http.ts";

test("loop boundaries reject non-finite, reversed, short and out-of-duration values", /** @brief DBやブラウザー不要でループ値の境界を検証する。 */ () => {
  assert.deepEqual(createLoopRegion(12.123456, 90.987654, 100, 0.1), {
    startSeconds: 12.123456,
    endSeconds: 90.987654,
  });
  for (const values of [
    [NaN, 3, 4, 0.1],
    [0, Infinity, 4, 0.1],
    [-1, 3, 4, 0.1],
    [1, 1, 4, 0.1],
    [2, 1, 4, 0.1],
    [0, 5, 4, 0.1],
    [0, 0.09, 4, 0.1],
    [0, 1, 4, 0],
  ])
    assert.throws(
      /** @brief 不正値が例外になることを確認する。 */ () =>
        createLoopRegion(...(values as [number, number, number, number])),
    );
  assert.ok(Object.isFrozen(createLoopRegion(0, 0.1, 1, 0.1)));
});
test("audio-clock position plays intro once and preserves position on pause/disable", /** @brief 多数の反復でも表示タイマー誤差を積算しない。 */ () => {
  const loop = { startSeconds: 12, endSeconds: 90 };
  assert.equal(playbackPosition(0, 8, 100, loop), 8);
  assert.equal(playbackPosition(0, 90, 100, loop), 12);
  assert.equal(playbackPosition(0, 90 + 78 * 1000 + 4.5, 100, loop), 16.5);
  assert.equal(playbackPosition(16.5, 2, 100, loop), 18.5);
  assert.equal(playbackPosition(16.5, 80, 100, null), 96.5);
  assert.equal(seekPosition(90, 100, loop), 12);
  assert.equal(seekPosition(8, 100, loop), 8);
  assert.equal(seekPosition(200, 100, null), 100);
});
test("queue end, single-track, repeat modes and shuffle respect current track", /** @brief 空キューと1曲も通常のキュー規則で扱う。 */ () => {
  assert.equal(nextTrack([], "x", 1, "queue", true), null);
  assert.equal(nextTrack(["a"], "a", 1, "off", true), null);
  assert.equal(nextTrack(["a"], "a", 1, "track", true), "a");
  assert.equal(nextTrack(["a", "b"], "a", 1, "track", false), "b");
  assert.equal(nextTrack(["a", "b"], "b", 1, "queue", true), "a");
  const shuffled = shuffledQueue(
    ["a", "b", "c", "d"],
    "b",
    /** @brief 再現可能な乱数。 */ () => 0.25,
  );
  assert.equal(shuffled[0], "b");
  assert.equal(new Set(shuffled).size, 4);
  assert.deepEqual(shuffledQueue([], "", Math.random), []);
});
test("authorization is scoped to game membership and admin operations", /** @brief GitHubログイン済みだけでは投稿できない。 */ () => {
  const actor = { id: "1", login: "creator", admin: false, gameIds: ["a"] };
  assert.doesNotThrow(
    /** @brief 担当作品を許可する。 */ () => authorize(actor, "a"),
  );
  assert.throws(/** @brief 別作品を拒否する。 */ () => authorize(actor, "b"));
  assert.throws(/** @brief 運営機能は拒否する。 */ () => authorize(actor));
  assert.throws(/** @brief 未認証を拒否する。 */ () => authorize(null, "a"));
});
test("content and config validation rejects HTML, unsafe links and invalid defaults", /** @brief UI入力制限をサーバー検証の代替にしない。 */ () => {
  assert.throws(
    /** @brief 任意HTMLを拒否する。 */ () =>
      gameContent(
        {
          title: "<script>",
          description: "",
          imageAssetId: null,
          imageAlt: "",
          externalUrl: "",
          rightsConfirmed: false,
        },
        policy,
      ),
  );
  assert.throws(
    /** @brief JavaScript URLを拒否する。 */ () =>
      safeUrl("javascript:alert(1)", policy.text.urlMax),
  );
  assert.throws(
    /** @brief 設定値NaNを拒否する。 */ () =>
      validatePolicy({ ...policy, loop: { minimumLengthSeconds: NaN } }),
  );
  assert.equal(
    safeUrl("https://example.com/game", policy.text.urlMax),
    "https://example.com/game",
  );
  assert.throws(
    /** @brief 不完全なクレジットを拒否する。 */ () =>
      trackContent(
        {
          title: "track",
          credits: [{ name: "", role: "作曲" }],
          comment: "",
          audioAssetId: null,
          imageAssetId: null,
          imageAlt: "",
          loop: null,
        },
        policy,
      ),
  );
  assert.throws(
    /** @brief 検証前素材の公開を拒否する。 */ () =>
      validateAsset(null, "a", "audio"),
  );
});
test("HTTP single ranges cover suffix, open end, clamping and invalid intervals", /** @brief Range算術を実配信とは別に境界検証する。 */ () => {
  assert.equal(byteRange(null, 100), null);
  assert.deepEqual(byteRange("bytes=0-9", 100), { offset: 0, length: 10 });
  assert.deepEqual(byteRange("bytes=-10", 100), { offset: 90, length: 10 });
  assert.deepEqual(byteRange("bytes=95-", 100), { offset: 95, length: 5 });
  assert.deepEqual(byteRange("bytes=95-999", 100), { offset: 95, length: 5 });
  for (const input of [
    "bytes=100-",
    "bytes=9-2",
    "bytes=0-1,3-4",
    "bytes=-0",
    "garbage",
    "bytes=-",
  ])
    assert.equal(byteRange(input, 100), false);
});
