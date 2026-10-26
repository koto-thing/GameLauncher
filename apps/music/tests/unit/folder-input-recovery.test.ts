import test from "node:test";
import assert from "node:assert/strict";
import { recoverFolderInput, type FolderInputState } from "../support/folder-input-recovery";

const valid: FolderInputState = {
  inputEvents: "1", changeEvents: "1", fileCount: 1,
  fileName: "TestGame.exe", relativePath: "GameBuild/TestGame.exe", previewReady: true,
};
/** @brief Playwrightと同名のタイムアウトを意図的に作る */
function timeout() { return Object.assign(new Error("controlled"), { name: "TimeoutError" }); }

test("folder completion timeout continues only after real input and preview verification", async () => {
  let checked = false;
  await recoverFolderInput(timeout(), /** @brief 有効な証拠が揃った場合の継続を確認する */ async () => valid, /** @brief 有効な入力状態を返す */ async () => { checked = true; });
  assert.equal(checked, true);
});

for (const patch of [
  { inputEvents: "0" }, { inputEvents: null }, { changeEvents: "0" },
  { fileCount: 0 }, { fileCount: 2 }, { fileName: "Other.exe" },
  { relativePath: "Other/TestGame.exe" }, { previewReady: false },
]) test(`folder recovery rejects missing evidence ${JSON.stringify(patch)}`, /** @brief 証拠不足の場合の拒否を確認する */ async () => {
  let checked = false;
  await assert.rejects(recoverFolderInput(timeout(), /** @brief 不足させた入力状態を返す */ async () => ({ ...valid, ...patch }), /** @brief プレビュー確認の実行を記録する */ async () => { checked = true; }));
  assert.equal(checked, false);
});

test("folder recovery propagates failed UI verification", /** @brief 画面検証の失敗が伝わることを確認する */ async () => {
  const failure = new Error("preview assertion failed");
  await assert.rejects(recoverFolderInput(timeout(), /** @brief 有効な入力状態を返す */ async () => valid, /** @brief 画面検証の失敗を発生させる */ async () => { throw failure; }), /** @brief 元の失敗との一致を確認する */ error => error === failure);
});

for (const failure of [new Error("protocol error"), "TimeoutError", null])
  test(`folder recovery rethrows non-timeout ${String(failure)}`, /** @brief タイムアウト以外の拒否を確認する */ async () => {
    let read = false;
    await assert.rejects(recoverFolderInput(failure, /** @brief 入力状態の読取を記録する */ async () => { read = true; return valid; }, /** @brief 呼び出されない画面確認を用意する */ async () => {}), /** @brief 元の失敗との一致を確認する */ error => error === failure);
    assert.equal(read, false);
  });
