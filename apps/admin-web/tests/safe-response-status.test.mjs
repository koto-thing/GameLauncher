import test from 'node:test';
import assert from 'node:assert/strict';
import { expectStatus } from './helpers/safe-response-status.mjs';

test('status diagnostics preserve 400 and leave the response body readable', async () => {
  const response = Response.json({error:'validation'}, {status:400});
  await expectStatus(response,400);
  assert.deepEqual(await response.json(), {error:'validation'});
});

for (const [body, category] of [
  ['D1_ERROR private-value', 'd1'],
  ['Network connection lost private-value', 'network'],
  ['TypeError private-value', 'type_error'],
  ['Cannot perform I/O on behalf private-value', 'request_context'],
  ['unknown private-value', 'unclassified'],
]) test(`500 remains a failing assertion with only safe ${category} diagnostics`, async () => {
  await assert.rejects(expectStatus(new Response(body,{status:500}),400), error => {
    assert.equal(error.actual,500);
    assert.equal(error.expected,400);
    assert.ok(error.message.includes(category));
    assert.ok(!error.message.includes('private-value'));
    return true;
  });
});
