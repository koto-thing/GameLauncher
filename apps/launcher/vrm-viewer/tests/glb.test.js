import assert from 'node:assert/strict';
import test from 'node:test';
import { validateVrm } from '../src/glb.js';

/** Create a GLB JSON chunk to exercise the input boundary */
function glb(json) {
  const text = JSON.stringify(json);
  const bytes = new TextEncoder().encode(text + ' '.repeat((4 - text.length % 4) % 4));
  const buffer = new ArrayBuffer(20 + bytes.length);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, bytes.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buffer, 20).set(bytes);
  return buffer;
}

test('accepts self-contained VRM 0 and 1 containers', () => {
  for (const extension of ['VRM', 'VRMC_vrm']) {
    assert.ok(validateVrm(glb({ extensions: { [extension]: {} }, buffers: [{ byteLength: 4 }] })));
  }
});

test('rejects truncated files and mismatched chunk lengths', () => {
  assert.throws(() => validateVrm(new ArrayBuffer(5)));
  const buffer = glb({ extensions: { VRM: {} } });
  new DataView(buffer).setUint32(12, 0xffffffff, true);
  assert.throws(() => validateVrm(buffer), /container/);
});

test('rejects ordinary glTF and external resources', () => {
  assert.throws(() => validateVrm(glb({ asset: { version: '2.0' } })), /VRM extension/);
  for (const type of ['buffers', 'images']) {
    for (const uri of ['https://example.com/texture.png', 'file:///private', '../texture.png']) {
      assert.throws(() => validateVrm(glb({ extensions: { VRM: {} }, [type]: [{ uri }] })), /embedded/);
    }
  }
});
