import assert from 'node:assert/strict';

/** @brief 生の本文や識別子を出さず、予期しない応答の固定分類だけを報告する */
export async function expectStatus(response, expected) {
  if (response.status === expected) return;
  const body = await response.clone().text();
  const known = [
    ['network', /Network connection lost|disconnected|connection reset/i],
    ['request_aborted', /aborted|cancelled|canceled|never.*response|unresolved/i],
    ['runtime_exception', /exception|runtime.*failed/i],
    ['d1', /D1_ERROR|SQLITE_BUSY|SQLITE_ERROR/],
    ['request_context', /Cannot perform I\/O on behalf|different request/],
    ['runtime_limit', /Too many subrequests|CPU time limit|Memory limit/],
    ['unresolved_request', /never generate a response|canceled/i],
    ['type_error', /TypeError/],
    ['reference_error', /ReferenceError/],
    ['generic_internal', /Internal Server Error/i],
  ];
  const category = known.find(([, pattern]) => pattern.test(body))?.[0] ?? 'unclassified';
  const contentType = response.headers.get('content-type') ?? '';
  const format = contentType.includes('json') ? 'json' : contentType.includes('html') ? 'html' : 'other';
  assert.equal(response.status, expected, JSON.stringify({ status: response.status, expected, category, format, bodyBytes: Buffer.byteLength(body) }));
}
