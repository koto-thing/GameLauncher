import { describe, it, expect } from "vite-plus/test";
import { applicationFeaturesEnabled, isPublicPage } from "./availability";

describe("閲覧専用公開", () => {
  it("本番は明示trueだけが申請機能を有効にする", () => {
    for (const value of [undefined, "", "false", "1", "TRUE"])
      expect(applicationFeaturesEnabled(false, value)).toBe(false);
    expect(applicationFeaturesEnabled(false, "true")).toBe(true);
    expect(applicationFeaturesEnabled(true)).toBe(true);
    expect(applicationFeaturesEnabled(true, "false")).toBe(false);
  });

  it("公開一覧・開催回・発表以外は閲覧経路に含めない", () => {
    for (const path of ["/", "/events/one", "/events/one/talks/two"])
      expect(isPublicPage(path)).toBe(true);
    for (const path of [
      "/login",
      "/auth/verify",
      "/auth/email-change",
      "/applications",
      "/applications/new",
      "/apply",
      "/events/one/apply",
    ])
      expect(isPublicPage(path)).toBe(false);
  });
});
