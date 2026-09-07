import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));
process.loadEnvFile(".env");
if (process.argv.length > 2)
  throw new Error("deploy does not accept arguments");
for (const key of [
  "FTP_SERVER",
  "FTP_USERNAME",
  "FTP_PASSWORD",
  "PUBLIC_FOLDER",
])
  if (!process.env[key]?.trim()) throw new Error(`${key} is required in .env`);
if (process.env.OVERWRITE !== "true")
  throw new Error("Set OVERWRITE=true in .env to deploy the public frontend");

const server = new URL(
  process.env.FTP_SERVER.includes("://")
    ? process.env.FTP_SERVER
    : `ftp://${process.env.FTP_SERVER}`,
);
if (
  !["ftp:", "ftps:"].includes(server.protocol) ||
  server.username ||
  server.password ||
  server.search ||
  server.hash ||
  server.pathname !== "/"
)
  throw new Error("FTP_SERVER must contain only the FTPS server host and port");
const folder = process.env.PUBLIC_FOLDER.trim().replace(/^\/+|\/+$/g, "");
if (
  !folder ||
  folder
    .split("/")
    .some(
      /** @brief 親・現在・空のパス要素を拒否する */ (part) =>
        !part || part === "." || part === "..",
    ) ||
  /[\\\r\n]/.test(folder)
)
  throw new Error("PUBLIC_FOLDER must be a non-root server directory");

/** @brief curl設定値を引用し、認証情報をプロセス引数に出さない */
function quote(value) {
  if (/[\r\n\0]/.test(value))
    throw new Error("Invalid newline in deployment configuration");
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
const credentials = quote(
  `${process.env.FTP_USERNAME}:${process.env.FTP_PASSWORD}`,
);
const curl = process.platform === "win32" ? "curl.exe" : "curl";
const available = spawnSync(curl, ["--version"], { stdio: "ignore" });
if (available.error || available.status !== 0)
  throw new Error("curl is required for FTPS deployment");

for (const args of [
  ["node_modules/vite/bin/vite.js", "build"],
  ["scripts/check-build.mjs"],
]) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.error || result.status !== 0)
    throw new Error("Deployment stopped: build validation failed");
}

/** @brief Vite出力だけを列挙し、サーバー入口や非公開データと分離する */
function collect(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(
    /** @brief 実ファイルを再帰列挙する */ (entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("Deployment output must not contain symlinks");
      return entry.isDirectory() ? collect(file) : [file];
    },
  );
}
const files = collect("dist").map(
  /** @brief 配信先の相対パスに変換する */ (file) =>
    path.relative("dist", file).split(path.sep).join("/"),
);
if (!files.includes("index.html")) throw new Error("Missing dist/index.html");
if (
  files.some(
    /** @brief 公開物にPHPや隠し設定が含まれないことを確認する */ (file) =>
      /(^|\/)\.|\.(php|ini)$/i.test(file),
  )
)
  throw new Error(
    "Deployment output contains server configuration or PHP files",
  );
files.sort(
  /** @brief HTMLを最後に更新して先にアセットを配置する */ (a, b) =>
    Number(a === "index.html") - Number(b === "index.html") ||
    a.localeCompare(b),
);
// レンタルサーバーの要件に合わせ、証明書検証付きの明示的FTPSを使用する
const base = `ftp://${server.host}/${folder.split("/").map(encodeURIComponent).join("/")}/`;
for (const file of files) {
  const url = base + file.split("/").map(encodeURIComponent).join("/");
  const config = `user = ${credentials}\nurl = ${quote(url)}\n`;
  const result = spawnSync(
    curl,
    [
      "--disable",
      "--config",
      "-",
      "--silent",
      "--show-error",
      "--fail",
      "--ssl-reqd",
      "--ftp-create-dirs",
      "--connect-timeout",
      "30",
      "--max-time",
      "300",
      "--upload-file",
      path.join("dist", file),
    ],
    { input: config, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
  if (result.error || result.status !== 0)
    throw new Error(
      `FTPS upload failed for ${file} (exit ${result.status ?? "unavailable"}); rerun deploy after resolving the connection issue`,
    );
  console.log(`Uploaded ${file}`);
}
console.log("Public frontend deployed successfully.");
