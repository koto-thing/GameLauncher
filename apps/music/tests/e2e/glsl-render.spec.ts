import { test, expect } from "@playwright/test";
import { build } from "esbuild";

test("custom GLSL compiles, draws pixels and keeps the applied shader on errors", /** @brief 実WebGLでコード編集と描画を独立して検証する */ async ({
  page,
}) => {
  const bundle = await build({
    stdin: {
      contents: `import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ShaderEditor } from './src/presentation/web/shader-editor';
import { WebGLBackground } from './src/presentation/web/webgl-background';
function Harness(){const [value,setValue]=useState(undefined);return <form><ShaderEditor value={value} onChange={setValue}/><div style={{position:'relative',width:320,height:200}}>{value && <WebGLBackground settings={value}/>}</div></form>}
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
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const input = page.getByLabel("フラグメントシェーダー（GLSL）");
  const apply = page.getByRole("button", { name: "コンパイルして適用" });
  await input.fill("invalid GLSL");
  await apply.click();
  await expect(page.locator("#shader-error")).not.toBeEmpty();
  await expect(page.locator("canvas.game-backdrop")).toHaveCount(0);
  const source =
    "void mainImage(out vec4 color, in vec2 p){color=vec4(1.0,0.0,0.0,1.0);}";
  await input.fill(source);
  await apply.click();
  await expect(page.locator("#shader-error")).toBeEmpty();
  const canvas = page.locator("canvas.game-backdrop");
  await expect(canvas).toBeVisible();
  const pixel = await canvas.evaluate(
    /** @brief 現在のプログラムを描画しGPUの画素値を読む */ (element) => {
      const gl = (element as HTMLCanvasElement).getContext("webgl")!;
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      const pixel = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return Array.from(pixel);
    },
  );
  expect(pixel).toEqual([255, 0, 0, 255]);
  await input.fill("invalid again");
  await apply.click();
  await expect(page.locator("#shader-error")).not.toBeEmpty();
  await expect(canvas).toBeVisible();
  expect(
    await input.evaluate(
      /** @brief 未適用コードで保存が進まないことを確認する */ (element) =>
        (element as HTMLTextAreaElement).checkValidity(),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "編集を取り消す" }).click();
  await expect(input).toHaveValue(source);
  await page.getByRole("button", { name: "GLSL背景を外す" }).click();
  await expect(canvas).toHaveCount(0);
});
