import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { encodeCommand } from "../../src/domain/command-code";

test("command backgrounds export without QR", /** @brief 保存画像の技コードを読み取りQRが含まれないことを検証する */ async ({
  page,
}) => {
  const url = "https://music.example/sub/tracks/track-123";
  const bundle = await build({
    stdin: {
      contents: `import React from 'react';
import {createRoot} from 'react-dom/client';
import jsQR from 'jsqr';
import {DistributionCard} from './src/presentation/web/distribution-card';
import {pngBlob,saveBlob} from './src/infrastructure/command/browser-images';
import {CommandRecognizer} from './src/infrastructure/command/recognizer';
import {COMMAND_RUNTIME} from './src/config/command-runtime.defaults';
window.decodeQR=jsQR;
window.commandRecognizer=new CommandRecognizer(COMMAND_RUNTIME);
window.print=()=>{window.printed=true};
createRoot(document.getElementById('root')).render(<DistributionCard id={123} title="曲のタイトル" url="${url}" exporter={async()=>({png:pngBlob,save:saveBlob})}/>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    define: { "process.env.NODE_ENV": '"production"' },
  });

  await page.setContent(
    '<style>.distribution-card{max-width:600px}.command-image{width:100%}</style><div id="root"></div>',
  );
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByLabel("PNG保存幅").selectOption("1200");
  for (const mode of ["color", "image", "webgl"]) {
    await page.getByLabel("コードの背景").selectOption(mode);
    if (mode === "color")
      await page.getByLabel("背景色", { exact: true }).fill("#cc3355");
    if (mode === "image") {
      const bytes = await page.evaluate(
        /** @brief 背景用の実PNGを生成する */ () => {
          const canvas = document.createElement("canvas");
          canvas.width = 800;
          canvas.height = 480;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#33cc55";
          ctx.fillRect(0, 0, 800, 480);
          return canvas.toDataURL("image/png").split(",")[1];
        },
      );
      await page.getByLabel("背景画像").setInputFiles({
        name: "background.png",
        mimeType: "image/png",
        buffer: Buffer.from(bytes, "base64"),
      });
    }

    await expect(
      page.getByRole("button", { name: "PNG保存", exact: true }),
    ).toBeEnabled();
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "PNG保存", exact: true }).click();
    const download = await downloading;
    if (mode === "color")
      await download.saveAs("build/distribution-crest-preview.png");
    const bytes = await readFile((await download.path())!);
    const result = await page.evaluate(
      /** @brief PNGの背景画素とQRの内容を確認する */ async (base64) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(image, 0, 0);
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decode = (
          window as unknown as {
            decodeQR(
              data: Uint8ClampedArray,
              width: number,
              height: number,
            ): { data: string } | null;
          }
        ).decodeQR;
        return {
          url: decode(frame.data, frame.width, frame.height)?.data,
          command: (
            window as unknown as {
              commandRecognizer: {
                recognize(frame: ImageData): { kind: string; code?: string };
              };
            }
          ).commandRecognizer.recognize(frame),
          pixel: [
            ...ctx.getImageData(
              Math.round((canvas.width * 150) / 800),
              Math.round((canvas.height * 150) / 480),
              1,
              1,
            ).data,
          ],
        };
      },
      bytes.toString("base64"),
    );
    expect(result.url).toBeUndefined();
    expect(result.command).toEqual({ kind: "code", code: encodeCommand(123) });
    if (mode === "color") expect(result.pixel).toEqual([204, 51, 85, 255]);
    if (mode === "image") expect(result.pixel).toEqual([51, 204, 85, 255]);

    const svgDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "SVG保存", exact: true }).click();
    const savedSvg = await readFile(
      (await (await svgDownload).path())!,
      "utf8",
    );
    expect(savedSvg).toContain("曲のタイトル");
    if (mode !== "color") expect(savedSvg).toContain("data:image/png;base64,");

    await page
      .getByRole("button", { name: "曲名付きで印刷", exact: true })
      .click();
    await expect(page.locator(".command-print-sheet img")).toHaveAttribute(
      "src",
      /^data:image\/svg\+xml,/,
    );
    await expect
      .poll(
        /** @brief OS印刷の代わりに呼出し完了を検証する */ () =>
          page.evaluate(
            /** @brief 印刷呼出しを読む */ () =>
              (window as unknown as { printed: boolean }).printed,
          ),
      )
      .toBe(true);
  }
});
