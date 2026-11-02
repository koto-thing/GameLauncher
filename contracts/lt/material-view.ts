export type MaterialView = {
  url: string;
  embedUrl: string | null;
  provider: "Google スライド" | "PowerPoint" | null;
};

/**
 * 資料URLを検証し、対応する公式ビューのURLを組み立てる
 * @param value 提出された資料URL
 * @returns 安全な資料リンクと埋め込み情報、不正なURLならnull
 */
export function materialView(value: string): MaterialView | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (value.length > 2048 || !["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;

  const result: MaterialView = { url: url.href, embedUrl: null, provider: null };
  // 埋め込み先はHTTPSの公式ホストと既知のパスだけに限定する
  if (url.protocol !== "https:" || url.port) return result;
  if (url.hostname === "docs.google.com") {
    const match = url.pathname.match(/^\/presentation\/d\/(e\/)?([A-Za-z0-9_-]+)(?:\/(?:edit|view|preview|present|embed|pub))?\/?$/);
    if (match) {
      result.provider = "Google スライド";
      result.embedUrl = `https://docs.google.com/presentation/d/${match[1] ?? ""}${match[2]}/${match[1] ? "embed" : "preview"}`;
    }
  }
  if (url.hostname === "onedrive.live.com" && ["/embed", "/view.aspx", "/edit.aspx"].includes(url.pathname)) {
    const id = url.searchParams.get("resid");
    if (id && /^[A-Fa-f0-9]+![0-9]+$/.test(id)) {
      const embed = new URL("https://onedrive.live.com/embed");
      embed.searchParams.set("resid", id);
      const authkey = url.searchParams.get("authkey");
      if (authkey) embed.searchParams.set("authkey", authkey);
      result.provider = "PowerPoint";
      result.embedUrl = embed.href;
    }
  }
  return result;
}
