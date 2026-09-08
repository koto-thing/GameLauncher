import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { createRuntime } from "../support/rental-runtime.mjs";
import { seed } from "../../scripts/seed.mjs";
import { encodeCommand } from "../../src/domain/command-code";

test("PHP fixed vectors run independently", /** @brief PHPのパラメーターと固定期待値を既存checkへ組み込む */ () => {
  const php =
    process.env.PHP_BIN ??
    (process.platform === "win32"
      ? path.resolve("../../build/music-tools/php/php.exe")
      : "php");
  assert.match(
    execFileSync(php, ["../../server/music/tests/command-code.php"], {
      encoding: "utf8",
      windowsHide: true,
    }),
    /passed/,
  );
});
test(
  "public command API respects configured subdirectory and HEAD failures",
  { timeout: 60000 },
  /** @brief 設定したbasePathだけで現在snapshotを照会する */ async (t) => {
    const runtime = await createRuntime();
    t.after(
      /** @brief サービスと参照を解放する */ async () => runtime.dispose(),
    );
    await seed(runtime);
    const games = await (
        await fetch(`${runtime.php.origin}/api/public/catalogue`)
      ).json(),
      track = games[0].tracks[0];
    const file = path.join(runtime.php.directory, "settings.json"),
      settings = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify({ ...settings, basePath: "/music" }));
    const route = `${runtime.php.origin}/music/api/public/command-codes/v1/${encodeCommand(track.commandCode.codeId)}`;
    assert.deepEqual(await (await fetch(route)).json(), { trackId: track.id });
    assert.equal(
      (await fetch(`${runtime.php.origin}/api/public/catalogue`)).status,
      404,
    );
    const error = await fetch(
      `${runtime.php.origin}/music/api/public/command-codes/v1/INVALID`,
      { method: "HEAD" },
    );
    assert.equal(error.status, 400);
    assert.equal(await error.text(), "");
    assert.equal((await fetch(`${runtime.php.origin}/music/scan`)).status, 200);
  },
);
