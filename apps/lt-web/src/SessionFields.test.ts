import { describe, it, expect } from "vite-plus/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionFields, readSession, splitTags, isSpeakerUrl } from "./SessionFields";
import { SessionFacts, SpeakerLinks } from "./SessionFacts";

const session = {
  field: "programming",
  relatedFields: ["ENG", "GD"],
  keywords: ["Unity"],
  platforms: ["PC"],
  difficulty: "easy",
  prerequisites: "基礎\n操作",
  takeaways: "仕組み",
} as const;

describe("発表の追加情報", () => {
  it("自由入力を重複なしのタグに整形する", () => {
    expect(splitTags("Unity、C#\nUnity, Web ")).toEqual(["Unity", "C#", "Web"]);
  });
  it("フォームで選んだ分類と自由入力を保存形式にする", () => {
    const f = new FormData();
    f.set("field", "graphics");
    f.set("difficulty", "hard");
    f.append("relatedFields", "VA");
    f.append("relatedFields", "GD");
    f.set("keywords", "Blender、モデリング");
    f.set("platforms", "PC\nWeb");
    f.set("prerequisites", "基本操作");
    f.set("takeaways", "モデル制作");
    expect(readSession(f)).toEqual({
      field: "graphics",
      difficulty: "hard",
      relatedFields: ["VA", "GD"],
      keywords: ["Blender", "モデリング"],
      platforms: ["PC", "Web"],
      prerequisites: "基本操作",
      takeaways: "モデル制作",
    });
    f.set("keywords", Array.from({ length: 11 }, (_, i) => String(i)).join(","));
    expect(() => readSession(f)).toThrow("10個まで");
  });
  it("フォームと公開画面に同じ保存値を表示する", () => {
    const value = {
      ...session,
      relatedFields: [...session.relatedFields],
      keywords: [...session.keywords],
      platforms: [...session.platforms],
    };
    const form = renderToStaticMarkup(createElement(SessionFields, { value }));
    expect(form).toContain('value="programming" selected');
    expect(form).toContain('value="easy" selected');
    expect(form).toContain("Unity");
    const facts = renderToStaticMarkup(createElement(SessionFacts, { session: value }));
    for (const text of [
      "プログラマー",
      "やさしい",
      "エンジニアリング",
      "ゲームデザイン",
      "基礎\n操作",
      "仕組み",
    ])
      expect(facts).toContain(text);
    expect(renderToStaticMarkup(createElement(SessionFacts, {}))).toContain("未登録");
  });
  it("SNSリンクはHTTP(S)だけを許可し別タブで開く", () => {
    expect(isSpeakerUrl("https://github.com/example")).toBe(true);
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,test",
      "https://user:pass@example.com",
      "/local",
    ])
      expect(isSpeakerUrl(url)).toBe(false);
    const html = renderToStaticMarkup(
      createElement(SpeakerLinks, {
        links: [{ label: "GitHub", url: "https://github.com/example" }],
      }),
    );
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });
});

it("SNSアイコンはURLのドメインで識別し紛らわしい別ドメインを除外する", async () => {
  const { socialIcon } = await import("./social-icon");
  expect(socialIcon("https://x.com/example")?.title).toBe("X");
  expect(socialIcon("https://www.youtube.com/@example")?.title).toBe("YouTube");
  expect(socialIcon("https://youtu.be/example")?.title).toBe("YouTube");
  expect(socialIcon("https://x.com.example.org/profile")).toBeUndefined();
  expect(socialIcon("https://example.org/x.com")).toBeUndefined();
});
