import { beforeEach, describe, it, expect, vi } from "vite-plus/test";
import { operation } from "./operation";
const values = new Map<string, string>();
beforeEach(() => {
  values.clear();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  });
});
describe("再読込後の operationId", () => {
  it("同じ指紋で再利用し本文を保存しない", async () => {
    const a = await operation("fixture", { title: "秘密本文", email: "private@example.invalid" });
    expect(
      (await operation("fixture", { title: "秘密本文", email: "private@example.invalid" })).id,
    ).toBe(a.id);
    expect(JSON.stringify([...values])).not.toContain("秘密本文");
    expect(JSON.stringify([...values])).not.toContain("private@");
    a.complete();
    expect(
      (await operation("fixture", { title: "秘密本文", email: "private@example.invalid" })).id,
    ).not.toBe(a.id);
  });
});
