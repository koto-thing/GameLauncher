import { mkdir, writeFile, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { toneWav, placeholderPng } from "../tests/support/fixtures.mjs";

// 自作トーンと単色画像をFFmpegで変換する。実作品の素材は取り込まない。
await mkdir("build/media", { recursive: true });
await writeFile("build/media/source.wav", toneWav());
await writeFile("build/media/source.png", placeholderPng());
const fixtures = {
  description:
    "Generated test-only tones and solid placeholders. Regenerate with node scripts/generate-media-fixtures.mjs and FFmpeg. No real game assets.",
};
for (const [name, args] of [
  [
    "mp3",
    [
      "-i",
      "build/media/source.wav",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "96k",
      "build/media/tone.mp3",
    ],
  ],
  [
    "jpeg",
    [
      "-i",
      "build/media/source.png",
      "-frames:v",
      "1",
      "build/media/image.jpeg",
    ],
  ],
  [
    "webp",
    [
      "-i",
      "build/media/source.png",
      "-frames:v",
      "1",
      "build/media/image.webp",
    ],
  ],
]) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", ...args],
    { encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error(`FFmpeg ${name}: ${result.stderr || result.error}`);
  fixtures[name] = (await readFile(args.at(-1))).toString("base64");
}
await writeFile(
  "tests/support/encoded-media.json",
  JSON.stringify(fixtures, null, 2) + "\n",
);
console.log("MP3 / JPEG / WebP fixtures generated.");
