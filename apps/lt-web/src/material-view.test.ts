import { describe, expect, it } from "vite-plus/test";
import { materialView } from "../../../contracts/lt/material-view";

describe("資料ビューのURL境界", () => {
  it("Googleの共有URLと公開URLを公式ビューに変換する", () => {
    expect(
      materialView("https://docs.google.com/presentation/d/deck_123/edit?usp=sharing#slide=id.a")
        ?.embedUrl,
    ).toBe("https://docs.google.com/presentation/d/deck_123/preview");
    expect(
      materialView("https://docs.google.com/presentation/d/e/public_123/pub?start=true")?.embedUrl,
    ).toBe("https://docs.google.com/presentation/d/e/public_123/embed");
  });
  it("OneDriveの埋め込み識別子と閲覧キーだけを引き継ぐ", () => {
    const result = materialView(
      "https://onedrive.live.com/embed?resid=AB12!345&authkey=!secret&redirect=https://evil.invalid",
    );
    const embed = new URL(result!.embedUrl!);
    expect(result?.provider).toBe("PowerPoint");
    expect(embed.searchParams.get("resid")).toBe("AB12!345");
    expect(embed.searchParams.get("authkey")).toBe("!secret");
    expect(embed.searchParams.has("redirect")).toBe(false);
  });
  it("類似ホスト、非HTTPS、未知パス、短縮リンクを埋め込まない", () => {
    for (const url of [
      "https://docs.google.com.evil.invalid/presentation/d/id/edit",
      "http://docs.google.com/presentation/d/id/edit",
      "https://docs.google.com:8443/presentation/d/id/edit",
      "https://docs.google.com/document/d/id/edit",
      "https://onedrive.live.com/embed?resid=bad",
      "https://1drv.ms/p/example",
      "https://example.com/slides.pptx",
    ])
      expect(materialView(url)?.embedUrl).toBeNull();
  });
  it("スクリプト、HTML、認証情報を含むURLをリンクにも使わない", () => {
    for (const url of [
      "",
      "javascript:alert(1)",
      "data:text/html,test",
      "<iframe src='https://docs.google.com'></iframe>",
      "https://user:pass@docs.google.com/presentation/d/id/edit",
    ])
      expect(materialView(url)).toBeNull();
  });
});
