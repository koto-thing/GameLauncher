import { locales } from "./locales.ts";
import { platforms, siteUrl, validateConfig } from "./config.ts";
import type { SiteConfig } from "./config.ts";

/** Escape configuration text for HTML text nodes and quoted attributes. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

/** Render real links or disabled OS slots at build time, including without JavaScript. */
export function renderDownloads(config: SiteConfig, base: string): string {
  const labels = { windows: "Windows", macos: "Mac", linux: "Linux" };
  return platforms.map(platform => {
    const target = config.downloads[platform];
    const label = `${labels[platform]}版`;
    const available = target.status === "available";
    const action = available ? "ダウンロード" : "準備中";
    const detail = available && target.detail ? `<small>${escapeHtml(target.detail)}</small>` : "";
    const content = `<span class="os-name">${label}</span><span class="download-action">${action}</span>${detail}`;
    return available
      ? `<a class="download" data-platform="${platform}" href="${escapeHtml(siteUrl(target.url, base))}" aria-label="${label}をダウンロード${target.detail ? `（${escapeHtml(target.detail)}）` : ""}">${content}</a>`
      : `<button class="download" data-platform="${platform}" type="button" disabled aria-label="${label}（準備中）">${content}</button>`;
  }).join("\n");
}

/** Produce the page shell from validated settings; media loading is never a render prerequisite. */
export function renderPage(config: SiteConfig, base: string): string {
  validateConfig(config);
  const url = (value: string) => escapeHtml(siteUrl(value, base));
  const { background } = config;
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="PandD ${escapeHtml(config.title)}の公式ダウンロードページ。Windows・Mac・Linux版の配布状況をご案内します。">
  <meta name="theme-color" content="#17191c">
  <title>${escapeHtml(config.title)}</title>
  <link rel="stylesheet" href="/src/style.css">
  <script type="module" src="/src/main.ts"></script>
</head>
<body>
  <div class="backdrop" aria-hidden="true" style="--media-position: ${background.objectPosition}">
    ${background.posterUrl ? `<div class="poster" style="background-image: url('${url(background.posterUrl)}')"></div>` : '<div class="poster"></div>'}
    <video class="background-video" muted loop playsinline preload="none" tabindex="-1" disablepictureinpicture${background.videoUrl ? ` data-src="${url(background.videoUrl)}"` : ""}></video>
    <div class="scrim"></div>
    <div class="graphic-lines"></div>
    <svg class="controller-art controller-art-top" viewBox="0 0 320 200" fill="none" focusable="false"><path d="M96 45h128c28 0 42 17 50 43l22 65c8 27-19 43-38 24l-39-37H101l-39 37c-19 19-46 3-38-24l22-65c8-26 22-43 50-43Z"/><path d="M82 72v44m-22-22h44"/><circle cx="229" cy="76" r="8"/><circle cx="250" cy="97" r="8"/><circle cx="208" cy="97" r="8"/><circle cx="229" cy="118" r="8"/><path d="M144 102h12m12 0h12"/></svg>
    <svg class="controller-art controller-art-bottom" viewBox="0 0 160 160" fill="none" focusable="false"><path d="M62 20h36v42h42v36H98v42H62V98H20V62h42Z"/><path d="m74 40 6-6 6 6m34 34 6 6-6 6m-34 34-6 6-6-6M40 74l-6 6 6 6"/></svg>
  </div>
  <header class="site-header">${config.logoUrl ? `<span class="brand-logo"><img src="${url(config.logoUrl)}" alt="PandD" width="1500" height="1500"></span>` : '<span class="wordmark">PandD</span>'}<div class="language-picker" hidden>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 6.5h14M5 17.5h14"/></svg>
    <select id="language" aria-label="言語を選択">${Object.entries(locales).map(([code, text]) => `<option value="${code}" lang="${code}">${text.name}</option>`).join("")}</select>
  </div></header>
  <main class="stage">
    <div class="hero">
      <h1 class="title"><span class="product-title">${config.title.split(" ").map(word => `<span class="title-word">${/^[PD]/.test(word) ? `<span class="title-initial">${escapeHtml(word[0]!)}</span>${escapeHtml(word.slice(1))}` : escapeHtml(word)}</span>`).join(" ")}</span></h1>
      <p class="tagline">${escapeHtml(config.tagline)}</p>
      <nav class="downloads" aria-label="OS別ダウンロード">${renderDownloads(config, base)}</nav>
    </div>
  </main>
  <footer class="site-footer"><small>© PandD</small></footer>
</body>
</html>`;
}
