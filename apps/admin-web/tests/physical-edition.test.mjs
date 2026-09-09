import assert from "node:assert/strict";
import test from "node:test";
import { validateEdition, validateEditionImage, productionUrl } from "../lib/physical-edition-contract.ts";

test("edition creation fixes the chosen titles and rejects duplicates or unsafe IDs", () => {
  const input = { name: "冬版", accentColor: "#00aabb", games: ["sample-game"] };
  assert.deepEqual(validateEdition(input, "edition-id"), { ...input, id: "edition-id", schemaVersion: 1 });
  assert.throws(() => validateEdition({ ...input, games: ["sample-game", "sample-game"] }, "edition-id"));
  assert.throws(() => validateEdition({ ...input, games: ["../sample-game"] }, "edition-id"));
  assert.throws(() => validateEdition({ ...input, accentColor: "url(https://evil.example)" }, "edition-id"));
  assert.throws(() => validateEdition({ ...input, games: [] }, "edition-id"));
});

test("edition image input rejects oversized decoded dimensions and non-PNG data", () => {
  const image = new Uint8Array(33);
  image.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(image.buffer);
  view.setUint32(16, 1920); view.setUint32(20, 1080);
  assert.doesNotThrow(() => validateEditionImage(image));
  view.setUint32(16, 100000);
  assert.throws(() => validateEditionImage(image));
  assert.throws(() => validateEditionImage(new Uint8Array(100)));
});

test("edition URLs are restricted to production paths", () => {
  assert.equal(productionUrl("https://downloads.koto-thing.com/v1/catalog.json"), "https://downloads.koto-thing.com/v1/catalog.json");
  for (const url of ["https://evil.example/v1/game", "https://downloads.koto-thing.com.evil.example/v1/game", "https://user:pass@downloads.koto-thing.com/v1/game"]) {
    assert.throws(() => productionUrl(url));
  }
});
