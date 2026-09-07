import {isLocale, locales} from "./locales.ts";
import type {Locale} from "./locales.ts";

/**
 * @brief 言語選択・URL指定・ブラウザー設定の順にページ文言を反映する
 * @remarks 保存領域が使えなくても、ページ内の言語変更は継続する
 */
export function setupLanguage(): void {
  const select = document.querySelector<HTMLSelectElement>("#language");

  if (!select) return;

  const tagline = document.querySelector<HTMLElement>(".tagline")!;
  const japaneseTagline = tagline.dataset.japaneseTagline!;

  /** @brief 指定言語の文言とアクセシビリティ情報をDOMへ反映する @param locale 適用する言語 */
  const apply = (locale: Locale): void => {
    const text = locales[locale];

    document.documentElement.lang = locale;
    select.value = locale;
    select.setAttribute("aria-label", text.language);
    tagline.textContent = locale === "ja" ? japaneseTagline : text.tagline;

    // ページ説明とダウンロード領域の名前も表示言語へ揃える
    document.querySelector('meta[name="description"]')?.setAttribute("content", text.description);
    document.querySelector(".downloads")?.setAttribute("aria-label", text.nav);

    // リンクと準備中ボタンを同じDOM更新で切り替え、状態表示と読み上げを一致させる
    for (const element of document.querySelectorAll<HTMLElement>(".download")) {
      const os = {windows: "Windows", macos: "Mac", linux: "Linux"}[element.dataset.platform as "windows" | "macos" | "linux"];
      const label = os + text.suffix;
      const action = element.matches("a[href]") ? text.download : text.soon;
      element.querySelector(".os-name")!.textContent = label;
      element.querySelector(".download-action")!.textContent = action;
      const detail = element.querySelector("small")?.textContent;
      element.setAttribute("aria-label", `${label} · ${action}${detail ? ` (${detail})` : ""}`);
    }
  };

  let saved: string | null = null;

  // 保存領域は利用者設定の補助であり、無効化されていても本体表示を止めない
  try {
    saved = localStorage.getItem("pandd-language");
  } catch {
    // ブラウザーの保存制限時もURL指定と既定言語で表示できる
  }

  // URL指定を最優先にし、保存値とブラウザー設定へ順にフォールバックする
  const requested = new URL(location.href).searchParams.get("lang");

  const preferred = navigator.languages.map(
    /** @brief ブラウザー言語をアプリのロケールキーへ正規化する @param language ブラウザーの言語タグ */
    (language): string => {
      const base = language.toLowerCase().split("-")[0];

      return base === "zh" ? "zh-CN" : base;
    },
  ).find(isLocale);
  const initial = isLocale(requested) ? requested : isLocale(saved) ? saved : preferred ?? "en";

  // 初回表示時に選択肢・説明・配布状態を一括で確定する
  apply(initial);

  select.addEventListener("change", /** @brief 選択言語を画面・保存領域・URLへ反映する */ () => {
    if (!isLocale(select.value)) return;

    apply(select.value);

    // 保存失敗は言語変更そのものの失敗ではないため、表示を継続する
    try {
      localStorage.setItem("pandd-language", select.value);
    } catch {
      // 保存領域が利用できない環境でもURLと表示は更新する
    }

    // 再読込後も共有可能な言語指定をURLへ残す
    const url = new URL(location.href);
    url.searchParams.set("lang", select.value);
    history.replaceState(null, "", url);
  });

  // JavaScriptが有効な場合だけ操作可能な選択UIを表示する
  select.hidden = false;
  select.parentElement!.hidden = false;
}
