import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

/** @brief 第一者のソースとスクリプトを再帰列挙する。 */
async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await files(name)));
    else if (/\.(?:ts|tsx|mjs)$/.test(name)) result.push(name);
  }
  return result;
}
const errors = [];
for (const file of [
  ...(await files("src")),
  ...(await files("scripts")),
  ...(await files("tests")),
  ...(await files("../admin-web/music")),
  ...(await files("../../contracts/music")),
]) {
  const content = await readFile(file, "utf8");
  const normalized = file.replaceAll("\\", "/");
  const source = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  /** @brief 層の依存違反と未記述の自作関数をASTで検出する。 */
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const name = node.moduleSpecifier.text;
      if (
        normalized.startsWith("src/domain/") &&
        (!name.startsWith(".") ||
          /infrastructure|application|presentation|composition|config/.test(
            name,
          ))
      )
        errors.push(`${file}: Domain外部依存 ${name}`);
      if (
        normalized.startsWith("src/application/") &&
        /infrastructure|presentation|composition|config/.test(name)
      )
        errors.push(`${file}: Application依存方向 ${name}`);
      if (
        normalized.startsWith("src/presentation/web/") &&
        /server-config|infrastructure|composition\/server/.test(name)
      )
        errors.push(`${file}: クライアント境界 ${name}`);
    }
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node)
    ) {
      // JSDocが親の変数・メソッドへ付く形と、匿名callbackの直前コメントを認識する。
      const start = Math.max(0, node.getFullStart() - 300);
      const end = ts.isArrowFunction(node)
        ? node.equalsGreaterThanToken.end
        : (node.body?.getStart() ?? node.end);
      const prefix = content.slice(start, end);
      if (!/\/\*\*[^]*?@brief[^]*?\*\//.test(prefix))
        errors.push(
          `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: @briefがありません`,
        );
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (
    normalized.startsWith("src/domain/") &&
    /\b(?:window|document|process|AudioContext|D1Database|R2Bucket|fetch)\b/.test(
      content,
    )
  )
    errors.push(`${file}: Domainに外部APIが混入`);
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else console.log("Architecture + function documentation checks passed.");
