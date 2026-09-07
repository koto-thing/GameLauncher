import assert from "node:assert/strict";
import test from "node:test";
import { gameDesign } from "../../src/domain/rules";
import { DEFAULT_FRAGMENT_SHADER } from "../../src/presentation/web/glsl-program";

const base = {
  backgroundColor: "#112233",
  backgroundAssetId: null,
  backgroundMode: "cover",
};
test("GLSL source is preserved verbatim including operators and comments", /** @brief コードをHTMLや通常テキストとして加工せず保存する */ () => {
  const fragmentShader = DEFAULT_FRAGMENT_SHADER + "\n// < > & 日本語";
  assert.deepEqual(
    gameDesign({ ...base, webgl: { fragmentShader, effect: "waves" } }),
    { ...base, webgl: { fragmentShader } },
  );
  assert.deepEqual(gameDesign(base), base);
});
test("GLSL source rejects empty, oversized, non-string and obsolete preset values", /** @brief 保存境界と旧プリセット拒否を検証する */ () => {
  for (const webgl of [
    {},
    { effect: "waves" },
    { fragmentShader: "" },
    { fragmentShader: "   " },
    { fragmentShader: 42 },
    { fragmentShader: "a".repeat(16001) },
    { fragmentShader: "\0" },
  ]) {
    assert.throws(
      /** @brief 不正な背景入力を渡す */ () => gameDesign({ ...base, webgl }),
    );
  }
  assert.equal(
    gameDesign({ ...base, webgl: { fragmentShader: "a".repeat(16000) } }).webgl
      ?.fragmentShader.length,
    16000,
  );
});
