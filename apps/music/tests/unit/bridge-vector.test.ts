import test from "node:test";
import assert from "node:assert/strict";
import vector from "../../../../contracts/music/signature-vector.json" with { type: "json" };
import { signatureHeaders } from "../../../admin-web/music/infrastructure/bridge";
import type { Envelope } from "../../../../contracts/music/bridge-v1";

test("v1 signature has a fixed cross-language byte representation", /** @brief 固定ベクトルでJSON表現・base64url・HMACの互換性を検査する。 */ async () => {
  const headers = await signatureHeaders(
    vector.envelope as Envelope,
    vector.secret,
  );
  assert.equal(headers["X-Music-Envelope"], vector.encoded);
  assert.equal(headers["X-Music-Signature"], vector.signature);
});
