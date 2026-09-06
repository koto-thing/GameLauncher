const POINTER = "v1/launcher/downloads/windows/x86_64/latest.json";
const ORIGIN = "https://downloads.koto-thing.com";
const installerKey = version => `v1/launcher/installers/windows/x86_64/${version}/PandD-Game-Launcher-Online-Installer.exe`;
const headers = {"Cache-Control": "no-store", "CDN-Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"};
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const reply = (status, message, extra = {}) => new Response(request.method === "HEAD" ? null : message, {status, headers: {...headers, ...extra}});
    if (url.pathname !== "/download/windows") return reply(404, "Not found");
    if (!["GET", "HEAD"].includes(request.method)) return reply(405, "Method not allowed", {Allow: "GET, HEAD"});
    try {
      const object = await env.RELEASES.get(POINTER);
      if (!object || object.size > 4096) return reply(503, "Installer is not available yet.", {"Retry-After": "60"});
      const data = await object.json();
      if (data?.schemaVersion !== 1 || typeof data.version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(data.version) ||
          !/^[a-f0-9]{64}$/.test(data.sha256) || !Number.isSafeInteger(data.size) || data.size <= 0) throw new Error("Invalid pointer");
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
