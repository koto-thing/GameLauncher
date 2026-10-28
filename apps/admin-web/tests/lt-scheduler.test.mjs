import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

/**
 * 実際のWorker入口へ通知と保持処理の記録用関数を接続する
 * @param push 通知処理
 * @param retention 保持処理
 * @returns 定期実行を持つWorker
 */
function worker(push, retention) {
  const source = readFileSync(new URL("../worker.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const dependencies = {
    "./lib/lt/push": { dispatchOperationsPush: push },
    "vinext/server/fetch-handler": { default: {} },
    "./lib/request-retention": { scheduledRequestRetention: retention },
    "../../packages/observability/d1": { observeD1: db => db },
  };
  const exports = {};
  new Function("require", "exports", compiled)(name => dependencies[name], exports);
  return exports.default;
}

test("one five-minute trigger sends notifications and retains requests only at 03:00 JST", async () => {
  const calls = [];
  const entry = worker(async (_, now) => calls.push(["push", now]), async (_, now) => { calls.push(["retention", now]); return { mode: "active" }; });
  for (const time of ["2026-10-28T17:55:00Z", "2026-10-28T18:00:00Z", "2026-10-28T18:05:00Z", "2026-10-29T03:00:00Z"]) {
    await entry.scheduled({ scheduledTime: Date.parse(time), cron: "*/5 * * * *" }, {});
  }
  assert.equal(calls.filter(([kind]) => kind === "push").length, 4);
  assert.deepEqual(calls.filter(([kind]) => kind === "retention"), [["retention", Date.parse("2026-10-28T18:00:00Z")]]);
  const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.deepEqual(config.triggers.crons, ["*/5 * * * *"]);
});

test("push failure still waits for daily retention to complete", async () => {
  let retained = false;
  const entry = worker(async () => { throw new Error("push unavailable"); }, async () => { await new Promise(resolve => setTimeout(resolve, 10)); retained = true; return { mode: "active" }; });
  await assert.rejects(entry.scheduled({ scheduledTime: Date.parse("2026-10-28T18:00:00Z"), cron: "*/5 * * * *" }, {}), /push unavailable/);
  assert.equal(retained, true);
});
