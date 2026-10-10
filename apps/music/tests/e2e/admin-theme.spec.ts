import { test, expect } from "@playwright/test";

for (const blockedStorage of [false, true]) {
  test(`admin theme follows system changes until manually selected (storage blocked: ${blockedStorage})`, /** @brief 端末設定への追従と手動選択の優先を保存可否の両方で検証する */ async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });

    if (blockedStorage) {
      await page.addInitScript(/** @brief ブラウザーの保存拒否を再現する */ () => {
        Object.defineProperty(window, "localStorage", {
          get: /** @brief 保存領域へのアクセスを拒否する */ () => {
            throw new DOMException("Blocked", "SecurityError");
          },
        });
      });
    }

    await page.goto("http://127.0.0.1:8788/intake");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "ライトモードに切り替える" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.emulateMedia({ colorScheme: "light" });
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    if (!blockedStorage) {
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    }
  });
}
