import { describe, it, expect } from "vite-plus/test";
import { operation } from "./operation";
describe("再送の operationId", () => {
  it("結果不明なら同一 payload で再利用", () => {
    const a = operation("x", { v: 1 });
    expect(operation("x", { v: 1 }).id).toBe(a.id);
    expect(operation("x", { v: 2 }).id).not.toBe(a.id);
    a.complete();
    expect(operation("x", { v: 1 }).id).not.toBe(a.id);
  });
});
