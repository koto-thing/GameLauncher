import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const { exports: policy } = await WebAssembly.instantiate(await WebAssembly.compile(readFileSync(new URL('../lib/generated/intake-policy.wasm', import.meta.url))));
// 実際の Rust Wasm と既存式を境界値で比較する
 test('multipart Rust Wasm preserves number boundaries and IEEE arithmetic', () => {
 const values = [-Infinity, -1, -0, 0, 0.5, 1, 2, 3, 10000, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN];
 for (const count of values) for (const part of values) {
 assert.equal(Boolean(policy.valid_part_number(part,count)), Number.isSafeInteger(part) && part >= 1 && !(part > count));
 for (const size of values) for (const chunk of [0, 1, 67108864, Number.MAX_VALUE]) {
 const expected = part === count ? size - chunk * (count - 1) : chunk;
 const actual = policy.expected_part_size(part,count,size,chunk);
 assert.ok(Object.is(actual,expected) || (Number.isNaN(actual) && Number.isNaN(expected)));
 }
 }
 });
