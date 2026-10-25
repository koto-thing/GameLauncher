import assert from "node:assert/strict";

export interface FolderInputState {
  inputEvents: string | null;
  changeEvents: string | null;
  fileCount: number | undefined;
  fileName: string | undefined;
  relativePath: string | undefined;
  previewReady: boolean;
}

/** @brief 完了通知だけの欠落を実入力と画面検証で証明し、それ以外は失敗させる */
export async function recoverFolderInput(
  error: unknown,
  readState: () => Promise<FolderInputState>,
  verifyPreview: () => Promise<void>,
): Promise<void> {
  if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
  const state = await readState();
  assert.ok(Number(state.inputEvents) > 0);
  assert.ok(Number(state.changeEvents) > 0);
  assert.equal(state.fileCount, 1);
  assert.equal(state.fileName, "TestGame.exe");
  assert.equal(state.relativePath, "GameBuild/TestGame.exe");
  assert.equal(state.previewReady, true);
  await verifyPreview();
}
