import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {existsSync} from "node:fs";

// 作業ディレクトリをWebプロジェクトへ固定し、環境ファイルはその配下だけから読む
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
if (existsSync(".env")) process.loadEnvFile(".env");

// アップロード操作以外の引数を拒否し、意図しない運用操作を起こさない
const args = process.argv.slice(2);
if (args.some(/** @brief 運用CLIの許可引数だけを通す @param arg 指定された引数 */ arg => arg !== "--upload")) throw new Error("Only --upload is supported");

// 実際のFTPS処理と秘密値の扱いはPythonスクリプトへ委譲する
const result = spawnSync("python", ["scripts/deploy-ftps.py", ...args], {stdio: "inherit", env: process.env});
if (result.error) throw result.error;

process.exit(result.status ?? 1);
