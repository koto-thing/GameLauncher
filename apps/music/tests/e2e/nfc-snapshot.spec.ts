import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";

test("NFC opens the work and WebGL exports rendered PNG pixels", /** @brief サブディレクトリの作品URLと静止描画の実PNGを検証する */ async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === "firefox",
    "Headless Firefox does not provide WebGL here",
  );

  await page.emulateMedia({ reducedMotion: "reduce" });
  const bundle = await build({
    stdin: {
      contents: `import React from 'react';
import { createRoot } from 'react-dom/client';
import { SiteContext } from './src/presentation/web/context';
import { GameDesignSurface } from './src/presentation/web/design-surface';
import { NfcDistribution } from './src/presentation/web/nfc-distribution';
createRoot(document.getElementById('root')).render(<SiteContext.Provider value={{assetUrl:()=>''}}><NfcDistribution publicUrl="https://music.example/sub/" gameId="work-1" published={false}/><GameDesignSurface design={{backgroundColor:'#000000',backgroundMode:'cover',webgl:{fragmentShader:'void mainImage(out vec4 c, in vec2 p){c=vec4(1.,0.,0.,1.);}'}}} snapshotFileName="webgl-work-1.png"><h2>Preview</h2></GameDesignSurface></SiteContext.Provider>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    define: { "process.env.NODE_ENV": '"production"' },
  });

  await page.setContent(
    '<style>.game-surface{position:relative;width:320px;height:200px}.game-backdrop{position:absolute;inset:0}.game-surface-content{position:relative}</style><div id="root"></div>',
  );
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await expect(page.getByLabel("NFC用の作品URL")).toHaveValue(
    "https://music.example/sub/games/work-1",
  );
  await expect(
    page.getByRole("link", { name: "NFCのリンク先を確認" }),
  ).toHaveAttribute("href", "https://music.example/sub/games/work-1");
  await expect(
    page.getByText(
      "この作品は現在非公開または公開停止中です。配布前に公開してください。",
    ),
  ).toBeVisible();

  await expect(page.locator("canvas.game-backdrop")).toHaveAttribute(
    "width",
    "320",
  );
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "WebGLのスナップショットを保存" })
    .click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("webgl-work-1.png");
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const pixel = await page.evaluate(
    /** @brief 保存されたPNGを復号して空画像でないことを検証する */ async (
      base64,
    ) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);

      return [...context.getImageData(0, 0, 1, 1).data];
    },
    bytes.toString("base64"),
  );
  expect(pixel).toEqual([255, 0, 0, 255]);
});
