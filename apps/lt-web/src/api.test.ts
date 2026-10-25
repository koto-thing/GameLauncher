import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { request } from "./api";
afterEach(() => vi.unstubAllGlobals());
describe("API 境界", () => {
  it("認証エラーを成功値にしない", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { code: "UNAUTHENTICATED", requestId: "fixture" } }),
            { status: 401 },
          ),
        ),
    );
    await expect(request("/applications")).rejects.toThrow("セッションがありません");
  });
  it("HTML エラーも成功にしない", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 502 })));
    await expect(request("/events")).rejects.toThrow("HTTP 502");
  });
  it("cookie を同一オリジンに限定", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: null })));
    vi.stubGlobal("fetch", fetcher);
    await request("/events");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/lt/v1/events",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });
});
