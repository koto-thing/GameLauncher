import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { commandSvg } from "../../src/domain/command-art";

test(
  "real raster recognition: 100 baseline, 500 mild, negative images",
  { timeout: 240000 },
  /** @brief SVGを実ブラウザーで画素化し、デコーダーへ画像データだけを渡す */ async () => {
    process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve("build/browsers");
    const { chromium } = await import("@playwright/test");
    const bundle = await build({
      stdin: {
        contents:
          'export {commandSvg} from "./src/domain/command-art"; export {encodeCommand} from "./src/domain/command-code"; export {CommandRecognizer} from "./src/infrastructure/command/recognizer"; export {homography,project} from "./src/infrastructure/command/geometry"; export {COMMAND_RUNTIME} from "./src/config/command-runtime.defaults";',
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
      format: "iife",
      globalName: "CodeTest",
    });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.addScriptTag({
        content:
          "window.__name = (value) => value;\n" + bundle.outputFiles[0].text,
      });
      const seed =
        process.env.COMMAND_IMAGE_CALIBRATION === "true"
          ? 0x69cae541
          : 0xbaf30726;
      const result = await page.evaluate(
        /** @brief テスト用seedは画像生成にだけ使用し認識器に渡さない */ async (
          seed,
        ) => {
          // ブラウザー内テスト用型生成器と検証対象は公開ビルドと同じ関数
          const api = (
            window as unknown as {
              CodeTest: {
                commandSvg: (id: number) => string;
                encodeCommand: (id: number) => string;
                CommandRecognizer: new (s: object) => {
                  lastFailure: string;
                  recognize: (f: ImageData) => { kind: string; code?: string };
                };
                COMMAND_RUNTIME: object;
                homography: (a: number[][], b: number[][]) => number[];
                project: (h: number[], x: number, y: number) => number[];
              };
            }
          ).CodeTest;
          const decoder = new api.CommandRecognizer(api.COMMAND_RUNTIME);
          // 固定ベクターの全図形と90度単位の回転は評価seedと独立に検査する
          for (const id of [0, 1, 0x123456, 0xffffff]) {
            const img = new Image();
            img.src = `data:image/svg+xml,${encodeURIComponent(api.commandSvg(id))}`;
            await img.decode();
            for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
              const canvas = document.createElement("canvas");
              canvas.width = 1000;
              canvas.height = 1000;
              const c = canvas.getContext("2d")!;
              c.fillStyle = "white";
              c.fillRect(0, 0, 1000, 1000);
              c.translate(500, 500);
              c.rotate(angle);
              c.drawImage(img, -400, -240, 800, 480);
              const decoded = decoder.recognize(
                c.getImageData(0, 0, 1000, 1000),
              );
              if (
                decoded.kind !== "code" ||
                decoded.code !== api.encodeCommand(id)
              )
                throw new Error(
                  `固定図形・回転検査失敗: ${id}, ${angle}, ${decoder.lastFailure}`,
                );
            }
          }
          let state = seed;
          /** @brief 再現可能な最終評価専用seedで撮影条件を作る */
          function random() {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return state / 4294967296;
          }
          const results: {
            id: number;
            group: string;
            condition: string;
            expected: string;
            actual: string | null;
            ms: number;
            reason: string;
          }[] = [];
          const source = document.createElement("canvas");
          source.width = 800;
          source.height = 480;
          const ctx = source.getContext("2d", { willReadFrequently: true })!;
          /** @brief SVGの文字列やメタデータを解析せずブラウザーの描画結果を取得する */
          async function raster(svg: string) {
            const img = new Image();
            img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
            await img.decode();
            ctx.clearRect(0, 0, 800, 480);
            ctx.drawImage(img, 0, 0, 800, 480);
          }
          for (let i = 0; i < 640; i++) {
            const id = Math.floor(random() * 0x1000000),
              code = api.encodeCommand(id);
            await raster(api.commandSvg(id));
            const group = i < 100 ? "baseline" : i < 600 ? "mild" : "reject";
            const condition =
              group === "baseline"
                ? "front"
                : group === "mild"
                  ? [
                      "rotation",
                      "perspective",
                      "scale",
                      "jpeg",
                      "brightness",
                      "blur",
                      "background",
                    ][i % 7]
                  : [
                      "blank",
                      "glyphs-only",
                      "missing-marker",
                      "missing-cell",
                      "strong-blur",
                      "bad-crc",
                      "mirror",
                      "two-codes",
                    ][i % 8];
            if (condition === "missing-marker") {
              ctx.fillStyle = "white";
              ctx.fillRect(75, 75, 60, 60);
            }
            if (condition === "missing-cell") {
              ctx.fillStyle = "white";
              ctx.fillRect(168, 168, 64, 64);
            }
            if (condition === "glyphs-only") {
              const cells = ctx.getImageData(160, 160, 480, 160);
              ctx.fillStyle = "white";
              ctx.fillRect(0, 0, 800, 480);
              ctx.putImageData(cells, 160, 160);
            }
            if (condition === "blank") {
              ctx.fillStyle = "white";
              ctx.fillRect(0, 0, 800, 480);
            }
            if (condition === "bad-crc") {
              const next = new Image();
              next.src = `data:image/svg+xml,${encodeURIComponent(api.commandSvg((id + 1) & 0xffffff))}`;
              await next.decode();
              ctx.drawImage(
                next,
                252 * 2,
                252 * 2,
                56 * 2,
                56 * 2,
                252,
                252,
                56,
                56,
              );
            }
            const canvas = document.createElement("canvas");
            canvas.width = 1000;
            canvas.height = 750;
            const c = canvas.getContext("2d", { willReadFrequently: true })!;
            c.fillStyle = condition === "background" ? "#a8b4bc" : "#eee";
            c.fillRect(0, 0, 1000, 750);
            const scale =
              group === "baseline"
                ? i === 0
                  ? 0.375
                  : 0.5 + random() * 0.65
                : 0.65 + random() * 0.4;
            const angle =
              condition === "rotation"
                ? ((random() * 40 - 20) * Math.PI) / 180
                : 0;
            if (condition === "perspective") {
              const pixels = ctx.getImageData(0, 0, 800, 480),
                out = c.getImageData(0, 0, 1000, 750);
              const corners = [
                [100, 100],
                [900, 100],
                [900, 650],
                [100, 650],
              ].map(
                /** @brief 四隅を独立に最大16pxずらす */ (p) => [
                  p[0] + (random() - 0.5) * 32,
                  p[1] + (random() - 0.5) * 32,
                ],
              );
              const transform = api.homography(corners, [
                [0, 0],
                [800, 0],
                [800, 480],
                [0, 480],
              ]);
              for (let y = 70; y < 680; y++)
                for (let x = 70; x < 930; x++) {
                  const [u, v] = api.project(transform, x, y),
                    sx = Math.round(u),
                    sy = Math.round(v);
                  if (sx < 0 || sy < 0 || sx >= 800 || sy >= 480) continue;
                  const a = (y * 1000 + x) * 4,
                    b = (sy * 800 + sx) * 4;
                  for (let k = 0; k < 4; k++)
                    out.data[a + k] = pixels.data[b + k];
                }
              c.putImageData(out, 0, 0);
            } else {
              c.save();
              c.translate(500, 375);
              c.rotate(angle);
              c.scale(condition === "mirror" ? -scale : scale, scale);
              if (condition === "blur" || condition === "strong-blur")
                c.filter = `blur(${condition === "blur" ? 0.6 : 9}px)`;
              if (condition === "brightness")
                c.filter = `brightness(${0.65 + random() * 0.65})`;
              c.drawImage(source, -400, -240, 800, 480);
              c.restore();
              if (condition === "two-codes") {
                c.fillStyle = "white";
                c.fillRect(0, 0, 1000, 750);
                c.drawImage(source, 0, 50, 480, 288);
                c.drawImage(source, 510, 390, 480, 288);
              }
            }
            if (condition === "jpeg") {
              const jpg = new Image();
              jpg.src = canvas.toDataURL("image/jpeg", 0.8);
              await jpg.decode();
              c.drawImage(jpg, 0, 0);
            }
            const start = performance.now(),
              recognized = decoder.recognize(c.getImageData(0, 0, 1000, 750));
            results.push({
              id,
              group,
              condition,
              expected: code,
              actual: recognized.kind === "code" ? recognized.code! : null,
              ms: performance.now() - start,
              reason: decoder.lastFailure,
            });
          }
          return results;
        },
        seed,
      );
      await mkdir("build/command-code", { recursive: true });
      const sample = commandSvg(0x123456);
      await writeFile("build/command-code/sample-v1-123456.svg", sample);
      const png = await page.evaluate(
        /** @brief 実装と同じ図形から共有可能なPNG見本を生成する */ async (
          svg,
        ) => {
          const img = new Image();
          img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
          await img.decode();
          const canvas = document.createElement("canvas");
          canvas.width = 1600;
          canvas.height = 960;
          canvas.getContext("2d")!.drawImage(img, 0, 0);
          return canvas.toDataURL("image/png").split(",")[1];
        },
        sample,
      );
      await writeFile(
        "build/command-code/sample-v1-123456.png",
        Buffer.from(png, "base64"),
      );
      await writeFile(
        `build/command-code/image-results-${seed.toString(16)}.json`,
        JSON.stringify({ seed: seed.toString(16), cases: result }, null, 2),
      );
      const baseline = result.filter(
          /** @brief 基礎セットだけを集計する */ (r) =>
            r.group === "baseline",
        ),
        mild = result.filter(
          /** @brief 調整に使わない最終評価を集計する */ (r) =>
            r.group === "mild",
        ),
        negative = result.filter(
          /** @brief 拒否と誤受理を分ける */ (r) => r.group === "reject",
        );
      const correct = /** @brief 元コードと完全一致だけを成功と数える。 */ (
        rows: typeof result,
      ) =>
        rows.filter(
          /** @brief CRC通過だけを正解としない */ (r) =>
            r.actual === r.expected,
        ).length;
      const falseAccepts = result.filter(
        /** @brief 拒否対象の受理に加え、通常画像を別の有効コードと誤認した場合も失敗とする */ (r) =>
          r.actual !== null && (r.group === "reject" || r.actual !== r.expected),
      );
      console.log(
        JSON.stringify({
          baseline: correct(baseline),
          mild: correct(mild),
          negative: negative.length,
          falseAccepts,
          failures: result
            .filter(
              /** @brief 通常の読み取り失敗を別に報告する */ (r) =>
                r.group !== "reject" && r.actual !== r.expected,
            )
            .slice(0, 12),
        }),
      );
      assert.equal(correct(baseline), 100);
      assert.ok(correct(mild) >= 475);
      assert.equal(falseAccepts.length, 0);
    } finally {
      await browser.close();
    }
  },
);
