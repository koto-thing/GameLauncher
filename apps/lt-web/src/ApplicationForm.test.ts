import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vite-plus/test";
import { ApplicationForm } from "./ApplicationForm";
import type { Application } from "./types";
describe("申請フォーム", () => {
  it("複数発表者と任意情報を保持する", () => {
    const a = {
      content: {
        title: "架空申請",
        abstract: "概要",
        speakers: [
          { displayName: "架空甲", affiliation: "所属甲" },
          { displayName: "架空乙", profile: "紹介乙" },
        ],
      },
      materialUrl: "https://example.invalid",
    } as Application;
    const html = renderToStaticMarkup(
      createElement(ApplicationForm, {
        application: a,
        events: { items: [], nextCursor: null },
        busy: false,
        save: () => {},
        cancel: () => {},
      }),
    );
    expect(html).toContain("架空甲");
    expect(html).toContain("架空乙");
    expect(html).toContain("所属甲");
    expect(html).toContain("紹介乙");
    expect(html).toContain("発表者を追加");
  });
});
