import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";

// 公開エンドポイントのリダイレクト先を検証してから、サイト設定へ反映する
const origin = "https://downloads.koto-thing.com";
const endpoint = `${origin}/download/windows`;

// no-storeと期待する302を確認し、未準備の配布先を設定へ書き込まない
const response = await fetch(endpoint, {method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(30000)});
if (response.status !== 302 || response.headers.get("cache-control") !== "no-store") throw new Error("Cloudflare endpoint is not ready; site configuration unchanged");

// リダイレクト先のパスとバージョン形式を固定し、意図しない実行ファイルを受け付けない
const target = response.headers.get("location") ?? "";
if (!/^https:\/\/downloads\.koto-thing\.com\/v1\/launcher\/installers\/windows\/x86_64\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\/PandD-Game-Launcher-Online-Installer\.exe$/.test(target)) throw new Error("Unexpected installer destination");

// ポインターとリダイレクトを同時点のリリースとして照合する
const pointerResponse = await fetch(`${origin}/v1/launcher/downloads/windows/x86_64/latest.json`, {cache: "no-store", signal: AbortSignal.timeout(30000)});
if (!pointerResponse.ok) throw new Error("Pointer unavailable");
const pointer = await pointerResponse.json() as {version: string; sha256: string; size: number};
if (target !== `${origin}/v1/launcher/installers/windows/x86_64/${pointer.version}/PandD-Game-Launcher-Online-Installer.exe`) throw new Error("Release changed during verification; retry");

// 実ファイルを取得し、公開ポインターのサイズとSHA-256を検証する
const installer = await fetch(target, {redirect: "error", signal: AbortSignal.timeout(120000)});
if (!installer.ok || !installer.body) throw new Error("Installer unavailable");
const hash = createHash("sha256");
let size = 0;
for await (const chunk of installer.body) { hash.update(chunk); size += chunk.length; }
if (size !== pointer.size || hash.digest("hex") !== pointer.sha256) throw new Error("Public installer integrity mismatch");

// 検証済みの公開先だけを配布サイトのWindows設定へ置き換える
const path = new URL("../site.config.ts", import.meta.url);
const source = await readFile(path, "utf8");
const updated = source.replace(/(windows:\s*\{[\s\S]*?url:\s*)"[^"]+"/, `$1"${endpoint}"`).replace(/      \/\/ Verified public[^\n]*\n/, "      // Stable Cloudflare endpoint; activation script verified the public installer.\n");
if (updated === source && !source.includes(endpoint)) throw new Error("Windows configuration not found");
await writeFile(path, updated);

console.log(`Windows download activated: ${endpoint} (verified ${pointer.version})`);
