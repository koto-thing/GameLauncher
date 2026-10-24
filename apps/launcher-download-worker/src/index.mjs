import {validPointer} from "./validation.mjs";

const POINTER = "v1/launcher/downloads/windows/x86_64/latest.json";
const ORIGIN = "https://downloads.koto-thing.com";
const installerKey = version => `v1/launcher/installers/windows/x86_64/${version}/PandD-Game-Launcher-Online-Installer.exe`;
const headers = {"Cache-Control": "no-store", "CDN-Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"};
export default {
  /**
   * 検証済みインストーラーへの固定URLを解決する
   * @param {Request} request ダウンロード要求
   * @param {object} env RELEASESバケットの実行環境
   * @returns {Promise<Response>} 転送応答または既存契約のエラー応答
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const reply = (status, message, extra = {}) => new Response(request.method === "HEAD" ? null : message, {status, headers: {...headers, ...extra}});
    if (url.pathname !== "/download/windows") return reply(404, "Not found");
    if (!["GET", "HEAD"].includes(request.method)) return reply(405, "Method not allowed", {Allow: "GET, HEAD"});
    try {
      const object = await env.RELEASES.get(POINTER);
      if (!object || object.size > 4096) return reply(503, "Installer is not available yet.", {"Retry-After": "60"});
      const data = await object.json();
      if (!validPointer(data)) throw new Error("Invalid pointer");
      const key = installerKey(data.version);
      const artifact = await env.RELEASES.head(key);
      if (!artifact || artifact.size !== data.size || artifact.customMetadata?.sha256 !== data.sha256) throw new Error("Artifact mismatch");
      return reply(302, "", {Location: `${ORIGIN}/${key}`});
    } catch {
      console.error("installer_resolution_failed");
      return reply(503, "Installer is temporarily unavailable.", {"Retry-After": "60"});
    }
  }
};
