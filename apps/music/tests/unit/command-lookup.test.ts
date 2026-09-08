import test from "node:test";
import assert from "node:assert/strict";
import { PhpCommandLookup } from "../../src/infrastructure/command/lookup";

test("lookup reports network and malformed response failures in Japanese", /** @brief 通信例外を日本語にし、非公開理由とキャンセルを混同しない */ async (t) => {
  const lookup = new PhpCommandLookup("/music/", 8000);
  const controller = new AbortController();
  let mode = "network";
  const failure = new TypeError("Failed to fetch");
  t.mock.method(
    globalThis,
    "fetch",
    /** @brief 外部通信せず各失敗応答を返す */ async () => {
      if (mode === "network") throw failure;
      return new Response(mode === "invalid" ? "not json" : "", {
        status: mode === "missing" ? 404 : 200,
      });
    },
  );
  await assert.rejects(
    lookup.resolve(1, "UUUUUUUULUBY", controller.signal),
    /通信状態/,
  );
  mode = "invalid";
  await assert.rejects(
    lookup.resolve(1, "UUUUUUUULUBY", controller.signal),
    /照会結果を読み取れません/,
  );
  mode = "missing";
  await assert.rejects(
    lookup.resolve(1, "UUUUUUUULUBY", controller.signal),
    /曲が見つからないか、現在非公開/,
  );
  mode = "network";
  controller.abort();
  await assert.rejects(
    lookup.resolve(1, "UUUUUUUULUBY", controller.signal),
    failure,
  );
});
