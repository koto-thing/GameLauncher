import test from "node:test";
import assert from "node:assert/strict";
import vectors from "../../../../contracts/music/command-code-vectors.json" with { type: "json" };
import {
  crc12,
  encodeCommand,
  decodeCommand,
  normalizeCommand,
  displayCommand,
} from "../../src/domain/command-code";
import { ScanCommand } from "../../src/application/scan-command";

test("v1 fixed vectors, CRC check, roundtrips and every single-symbol substitution", /** @brief 期待値は仕様に固定し、実装結果から生成しない */ () => {
  assert.equal(crc12(new TextEncoder().encode("123456789")), 0xf5b);
  for (const vector of vectors) {
    assert.equal(encodeCommand(vector.id), vector.code);
    assert.equal(decodeCommand(1, vector.code), vector.id);
    for (let i = 0; i < 12; i++)
      for (const c of "UDRLABXY")
        if (c !== vector.code[i])
          assert.throws(
            /** @brief 全位置の一記号置換を拒否する */ () =>
              decodeCommand(
                1,
                vector.code.slice(0, i) + c + vector.code.slice(i + 1),
              ),
          );
  }
  for (let id = 0; id <= 0xffffff; id += 7919)
    assert.equal(decodeCommand(1, encodeCommand(id)), id);
  for (const value of [-1, 16777216, 0.5, NaN, Infinity])
    assert.throws(
      /** @brief 整数範囲外を拒否する */ () => encodeCommand(value),
    );
  for (const value of [
    "",
    "UUUUUUUU",
    "UUUUUUUUUUUU",
    "012345670123",
    "uuuuuuuuluby",
  ])
    assert.throws(
      /** @brief APIの正規形式以外を拒否する */ () => decodeCommand(1, value),
    );
  assert.throws(
    /** @brief 手入力も未知版では復号しない */ () =>
      decodeCommand(2, vectors[0].code),
  );
  assert.equal(
    normalizeCommand(displayCommand(vectors[2].code)),
    vectors[2].code,
  );
  assert.equal(normalizeCommand("u-u,u\nu"), "UUUU");
  assert.throws(
    /** @brief 不明な文字を黙って削除しない */ () =>
      normalizeCommand("UU?UU"),
  );
});
test("stable frames, one request, cancellation and no late navigation", /** @brief カメラとHTTPを差し替え、状態遷移だけを試験する */ async () => {
  let count = 0,
    finish: ((id: string) => void) | undefined;
  const scan = new ScanCommand(
    {
      resolve: /** @brief 遅延応答を試験から制御する */ async () => {
        count++;
        return new Promise<string>(
          /** @brief 解決関数を保管する */ (resolve) => {
            finish = resolve;
          },
        );
      },
    },
    { consecutiveFrames: 3 },
  );
  const result = { kind: "code" as const, code: vectors[2].code };
  assert.equal(scan.frame(result), null);
  assert.equal(scan.frame(result), null);
  scan.frame({ kind: "none" });
  assert.equal(scan.frame(result), null);
  assert.equal(scan.frame(result), null);
  assert.equal(scan.frame(result), result.code);
  const request = scan.resolve(result.code);
  assert.equal(await scan.resolve(result.code), null);
  assert.equal(count, 1);
  scan.cancel();
  finish!("11111111-1111-4111-8111-111111111111");
  assert.equal(await request, null);
  await assert.rejects(scan.resolve("UUUUUUUUUUUU"));
  assert.equal(count, 1);
});
