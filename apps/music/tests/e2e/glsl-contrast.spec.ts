import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";

for (const variant of ["page", "mini"]) {
test(`${variant}: GLSL covers the content panel and adjusts text, shadows and controls`, /** @brief 本文透過と明暗・透過背景の配色を実ブラウザーで確認する。 */ async ({
  page,
}) => {
  const bundle = await build({
    stdin: {
      contents: `import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SiteContext } from './src/presentation/web/context';
import { GameDesignSurface } from './src/presentation/web/design-surface';
function Harness(){const [color,setColor]=useState('1.0,1.0,1.0,1.0');
return <SiteContext.Provider value={{assetUrl:id=>id}}><button onClick={()=>setColor('1.0,1.0,1.0,1.0')}>Bright</button><button onClick={()=>setColor('0.0,0.0,0.0,1.0')}>Dark</button><button onClick={()=>setColor('0.0,0.0,0.0,0.0')}>Transparent</button><GameDesignSurface variant="${variant}" design={{backgroundColor:'#ffffff',backgroundAssetId:null,backgroundMode:'cover',webgl:{fragmentShader:'void mainImage(out vec4 c,in vec2 p){c=vec4('+color+');}'}}}><h1>Canvas Blue</h1><p className="hint">Credits</p><button>Play</button><select aria-label="Repeat"><option>OFF</option></select><span className="spectrum-bars"><i style={{background:'red'}} /></span></GameDesignSurface></SiteContext.Provider>}
createRoot(document.getElementById('root')).render(<Harness/>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({
    content:
      (await readFile("src/config/design-tokens.css", "utf8")) +
      (await readFile("src/presentation/web/style.css", "utf8")),
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const surface = page.locator(".game-surface");
  await expect(surface).toHaveAttribute("data-background-tone", "light");
  await expect(page.locator(".game-surface-content")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(page.locator("h1")).toHaveCSS("color", "rgb(16, 25, 37)");
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toHaveCSS("background-color", "rgb(244, 248, 252)");
  const lightShadow = await page
    .locator("h1")
    .evaluate(
      /** @brief 明るい背景でのシャドウを記録する */ (element) =>
        getComputedStyle(element).textShadow,
    );
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(surface).toHaveAttribute("data-background-tone", "dark");
  await expect(page.locator("h1")).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(page.locator("h1")).not.toHaveCSS("text-shadow", lightShadow);
  await expect(page.locator(".spectrum-bars i")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Transparent", exact: true }).click();
  await expect(surface).toHaveAttribute("data-background-tone", "light");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(surface).toHaveAttribute("data-background-tone", "light");
});
}
