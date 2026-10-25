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
  await recoverFolderInput(timeout(), async () => valid, async () => { checked = true; });
  assert.equal(checked, true);
});

for (const patch of [
  { inputEvents: "0" }, { inputEvents: null }, { changeEvents: "0" },
  { fileCount: 0 }, { fileCount: 2 }, { fileName: "Other.exe" },
  { relativePath: "Other/TestGame.exe" }, { previewReady: false },
]) test(`folder recovery rejects missing evidence ${JSON.stringify(patch)}`, async () => {
  let checked = false;
  await assert.rejects(recoverFolderInput(timeout(), async () => ({ ...valid, ...patch }), async () => { checked = true; }));
  assert.equal(checked, false);
});

test("folder recovery propagates failed UI verification", async () => {
  const failure = new Error("preview assertion failed");
  await assert.rejects(recoverFolderInput(timeout(), async () => valid, async () => { throw failure; }), error => error === failure);
});

for (const failure of [new Error("protocol error"), "TimeoutError", null])
  test(`folder recovery rethrows non-timeout ${String(failure)}`, async () => {
    let read = false;
    await assert.rejects(recoverFolderInput(failure, async () => { read = true; return valid; }, async () => {}), error => error === failure);
    assert.equal(read, false);
  });
