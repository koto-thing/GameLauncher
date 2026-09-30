import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";

for (const variant of ["page", "mini"]) {
test(`${variant}: GLSL covers the content panel and adjusts text, shadows and controls`, /** @brief 本文透過と明暗・透過背景の配色を実ブラウザーで確認する。 */ async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === "firefox",
    "GitHub Actionsのheadless FirefoxはWebGLコンテキストを提供しません。",
  );
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

  // 両方向ともボタンの実際の描画色が中間色を通ることを確認する
  const play = page.getByRole("button", { name: "Play", exact: true });
  for (const [label, tone, target] of [
    ["Bright", "light", "rgb(244, 248, 252)"],
    ["Dark", "dark", "rgb(32, 41, 56)"],
  ]) {
    const before = await play.evaluate(
      /** @brief 切替前のボタン背景色を記録する */ (element) =>
        getComputedStyle(element).backgroundColor,
    );
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(surface).toHaveAttribute("data-background-tone", tone);
    const middle = await play.evaluate(
      /** @brief 色の遷移を中間地点で止め、補間された描画色を取得する */ (element) => {
        const transition = element.getAnimations().find(
          /** @brief 背景色のCSS遷移を選ぶ */ (animation) =>
            animation instanceof CSSTransition &&
            animation.transitionProperty === "background-color",
        );
        if (!transition) throw new Error("Background color must transition");

        transition.pause();
        transition.currentTime = Number(transition.effect!.getTiming().duration) / 2;
        const color = getComputedStyle(element).backgroundColor;
        transition.finish();
        return color;
      },
    );
    expect(middle).not.toBe(before);
    expect(middle).not.toBe(target);
    await expect(play).toHaveCSS("background-color", target);
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Transparent", exact: true }).click();
  await expect(surface).toHaveAttribute("data-background-tone", "light");
  await expect(play).toHaveCSS("transition-duration", "0s");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(surface).toHaveAttribute("data-background-tone", "light");
});
}
