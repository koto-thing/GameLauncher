import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

// 既存配備設定を通常のFTPS接続だけに使用し、値・一覧・認証応答は表示しない
const path = process.argv[2];
if (!path || !existsSync(path)) throw Error("Existing deployment configuration is unavailable");
process.loadEnvFile(path);
for (const key of ["FTP_SERVER", "FTP_USERNAME", "FTP_PASSWORD", "PUBLIC_FOLDER"]) {
  if (!process.env[key] || /[\r\n]/.test(process.env[key])) throw Error("Invalid deployment configuration");
}
const raw = process.env.FTP_SERVER;
const server = new URL(raw.includes("://") ? raw : "ftp://" + raw);
if (!["ftp:", "ftps:"].includes(server.protocol) || server.username || server.password || server.search || server.hash || server.pathname !== "/") throw Error("Invalid FTPS host");
const folder = process.env.PUBLIC_FOLDER.replace(/^\/+|\/+$/g, "");
if (!folder || folder.split("/").some(part => part === ".." || part === ".")) throw Error("Invalid public folder");
const quote = value => '"' + value.replaceAll("\\", "\\\\").replaceAll('"', '\\"') + '"';
const config = [
  "url = " + quote("ftp://" + server.host + "/" + folder.split("/").map(encodeURIComponent).join("/") + "/"),
  "user = " + quote(process.env.FTP_USERNAME + ":" + process.env.FTP_PASSWORD),
  "ssl-reqd", "ftp-pasv", "silent", "show-error", "list-only", "connect-timeout = 20", "max-time = 45",
].join("\n");
const result = spawnSync(process.platform === "win32" ? "curl.exe" : "curl", ["--config", "-"], { input: config, encoding: "utf8", windowsHide: true });
if (result.status !== 0) {
  console.log(JSON.stringify({connected:false,curlExit:result.status,reason:"FTPS connection failed; credentials and response suppressed"}));
  process.exit(1);
}
const entries = result.stdout.split(/\r?\n/).map(line => line.trim());
console.log(JSON.stringify({connected:true,certificateValidation:true,relayEntryExists:entries.includes("lt-mail.php"),uploaded:false}));
