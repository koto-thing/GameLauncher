import { cp, mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

// 配布は準備だけ。FTP・SSH・DNS・本番書込は行わない。
await import("./check-build.mjs");
await mkdir("build", { recursive: true });
const destination = await mkdtemp(path.resolve("build/rental-package-"));
await cp("dist", path.join(destination, "music/public"), { recursive: true });
for (const directory of ["public", "src", "vendor", "scripts"])
  await cp(
    `../../server/music/${directory}`,
    path.join(destination, "music", directory),
    { recursive: true },
  );
await mkdir(path.join(destination, "music/config"));
for (const file of ["config.example.php", "policy.json"])
  await cp(
    `../../server/music/config/${file}`,
    path.join(destination, "music/config", file),
  );
for (const file of ["composer.json", "composer.lock"])
  await cp(`../../server/music/${file}`, path.join(destination, "music", file));
await writeFile(
  path.join(destination, "PACKAGE.json"),
  JSON.stringify(
    {
      protocol: 1,
      builtAt: new Date().toISOString(),
      policySha256: createHash("sha256")
        .update(await readFile("../../contracts/music/policy.json"))
        .digest("hex"),
      documentRoot: "music/public",
      privateDirectories: ["music/src", "music/vendor", "music/config"],
      instructions: "docs/music/operations.md",
    },
    null,
    2,
  ),
);
console.log(`Rental package prepared: ${destination}`);
