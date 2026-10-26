import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const schema = JSON.parse(readFileSync(new URL('../../../../contracts/lt/dto.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ strict: false });
addFormats(ajv);
ajv.addSchema(schema);
const createInput = ajv.getSchema(schema.$id + '#/$defs/CreateEventInput');
const eventPage = ajv.getSchema(schema.$id + '#/$defs/EventSettingsPage');

/** @brief 通常CI用の明示的な内部RPC fixture。Rust Workerの実結合とは別に境界を検証する */
export function createLtBindingFixture() {
  const events = [];
  const receipts = new Map();
  const calls = [];
  return {
    calls,
    async operate(context, request) {
      calls.push({ context: structuredClone(context), headers: new Headers(request.headers) });
      assert.ok(context.actorId);
      assert.ok(context.requestId);
      assert.ok(['admin', 'executive', 'assistant'].includes(context.role));
      assert.equal(request.headers.get('cookie'), null);
      assert.equal(request.headers.get('authorization'), null);
      assert.equal(request.headers.get('x-role'), null);
      assert.equal(request.headers.get('x-actor-id'), null);
      assert.equal(new URL(request.url).pathname, '/api/lt/v1/operator/events');
      if (request.method === 'GET') {
        const page = { items: structuredClone(events), nextCursor: null };
        assert.ok(eventPage(page), JSON.stringify(eventPage.errors));
        return Response.json(page);
      }
      assert.equal(request.method, 'POST');
      const input = await request.json();
      assert.ok(createInput(input), JSON.stringify(createInput.errors));
      const { operationId, ...data } = input;
      assert.ok(operationId);
      if (receipts.has(operationId)) return Response.json(receipts.get(operationId));
      const event = { ...data, id: `fixture-event-${events.length + 1}`, version: 1, state: 'scheduled', publishEnabled: false };
      events.push(event);
      receipts.set(operationId, event);
      return Response.json(event);
    },
  };
}
