import assert from "node:assert/strict";
import { test } from "node:test";
import * as rust from "../src/rust-validation.ts";

const day = 86_400_000;

/**
 * 従来の JavaScript と同じ日本時間の日付文字列を返す
 * @param {number} instant Unix ミリ秒
 * @returns {string} 日本時間の暦日
 */
function japanDate(instant) {
  return new Date(instant + 32_400_000).toISOString().slice(0, 10);
}

// 境界値の組み合わせで既存の時刻検証と実際の Wasm の結果を比較する
test("Rust Wasm preserves timing tolerances, retention days and final-state boundaries", () => {
  const now = Date.parse("2026-10-11T14:59:59.999Z");

  for (const start of [now - 90 * day, now - 89 * day, now - 1000, now, now + 300_000, now + 300_001]) {
    for (const observed of [start - 1, start, start + 999, start + 1000, now + 300_000, now + 300_001]) {
      for (const ended of [null, start - 1, start, observed, observed + 1]) {
        for (const running of [true, false]) {
          for (const duration of [0, 2, 3, 600]) {
            const expected = !(japanDate(start) < japanDate(now - 89 * day) || start > now + 300_000 || observed < start || observed > now + 300_000 ||
              duration > Math.floor((observed - start) / 1000) + 2 ||
              (running ? ended !== null : ended === null || ended < start || ended > observed) ||
              (ended !== null && observed !== ended));

            assert.equal(Boolean(rust.valid_timing(start, observed, ended ?? NaN, now, duration, Number(running))), expected,
              JSON.stringify({ start, observed, ended, running, duration }));
          }
        }
      }
    }
  }
});

// null とゼロを区別する ABI を全終了状態で検証する
test("Rust Wasm preserves the complete outcome field matrix", () => {
  for (const [code, outcome] of ["running", "normal", "abnormal", "interrupted", "launch_failed"].entries()) {
    for (const exitCode of [null, -1, 0, 1, 2147483647]) {
      for (const crashed of [null, false, true]) {
        for (const duration of [0, 1]) {
          const expected = !((outcome === "normal" && (exitCode !== 0 || crashed !== false)) ||
            (outcome === "abnormal" && (crashed === null || (!crashed && (exitCode === null || exitCode === 0)))) ||
            (["running", "interrupted", "launch_failed"].includes(outcome) && (exitCode !== null || crashed !== null)) ||
            (outcome === "launch_failed" && duration !== 0));

          assert.equal(Boolean(rust.valid_outcome(code, exitCode ?? NaN, crashed === null ? -1 : Number(crashed), duration)), expected);
        }
      }
    }
  }
});

// 日本時間午前零時と秒未満の端数を含む配分の互換性を検証する
test("Rust Wasm preserves Japanese daily allocation bounds", () => {
  const midnight = Date.parse("2026-10-11T00:00:00+09:00");

  for (const start of [midnight - 1001, midnight - 1, midnight, midnight + 1]) {
    for (const observed of [midnight, midnight + 1, midnight + 1001, midnight + day]) {
      for (const dayStart of [midnight - day, midnight, midnight + day]) {
        for (const duration of [0, 1, 2, 3, 86_400]) {
          const available = Math.ceil(Math.max(0, Math.min(observed, dayStart + day) - Math.max(start, dayStart)) / 1000);
          const expected = !(japanDate(dayStart) < japanDate(start) || japanDate(dayStart) > japanDate(observed) || duration > available + 1);

          assert.equal(Boolean(rust.valid_daily(start, observed, dayStart, duration)), expected);
        }
      }
    }
  }
});
