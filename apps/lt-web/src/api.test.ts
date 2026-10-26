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

describe("CSRF 境界", () => {
  it.each(["POST", "PATCH", "PUT", "DELETE"])("%s に JSON と CSRF を付与", async (method) => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", f);
    await request("/applications", {
      method,
      headers: { "X-LT-CSRF": "override", "Content-Type": "text/plain" },
    });
    const options = f.mock.calls[0][1];
    expect(options.headers.get("X-LT-CSRF")).toBe("1");
    expect(options.headers.get("Content-Type")).toBe("application/json");
    expect(options.credentials).toBe("same-origin");
    expect(options.redirect).toBe("error");
  });
  it("GET では CSRF を送信しない", async () => {
    const f = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", f);
    await request("/events", { headers: { "X-LT-CSRF": "override" } });
    expect(f.mock.calls[0][1].headers.has("X-LT-CSRF")).toBe(false);
  });
  it("外部 URL は送信前に拒否", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(request("https://example.invalid", { method: "POST" })).rejects.toThrow(
      "API パス",
    );
    await expect(request("//example.invalid", { method: "POST" })).rejects.toThrow("API パス");
    expect(f).not.toHaveBeenCalled();
  });
  it("mutation の401も認証エラーを保持", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED", requestId: "qa" } }), {
          status: 401,
        }),
      ),
    );
    await expect(request("/applications", { method: "POST" })).rejects.toThrow(
      "セッションがありません",
    );
  });
});
