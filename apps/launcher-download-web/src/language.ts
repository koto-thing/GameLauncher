import {isLocale, locales} from "./locales.ts";
import type {Locale} from "./locales.ts";
export function setupLanguage() {
  const select = document.querySelector<HTMLSelectElement>("#language");
  if (!select) return;
  const tagline = document.querySelector<HTMLElement>(".tagline")!;
  const japaneseTagline = tagline.textContent;
  const apply = (locale: Locale) => {
    const text = locales[locale];
    document.documentElement.lang = locale;
    select.value = locale;
    select.setAttribute("aria-label", text.language);
    tagline.textContent = locale === "ja" ? japaneseTagline : text.tagline;
    document.querySelector('meta[name="description"]')?.setAttribute("content", text.description);
    document.querySelector(".downloads")?.setAttribute("aria-label", text.nav);
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
  try { saved = localStorage.getItem("pandd-language"); } catch { /* Storage may be disabled. */ }
  const requested = new URL(location.href).searchParams.get("lang");
  const initial = isLocale(requested) ? requested : isLocale(saved) ? saved : "ja";
  // Keep the build-time Japanese accessible names until a different locale is selected.
  if (initial !== "ja") apply(initial);
  select.addEventListener("change", () => {
    if (!isLocale(select.value)) return;
    apply(select.value);
    try { localStorage.setItem("pandd-language", select.value); } catch { /* Selection still works. */ }
    const url = new URL(location.href);
    url.searchParams.set("lang", select.value);
    history.replaceState(null, "", url);
  });
  select.hidden = false;
  select.parentElement!.hidden = false;
}
