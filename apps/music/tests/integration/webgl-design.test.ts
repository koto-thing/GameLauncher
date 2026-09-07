import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime, fixtureClient } from "../support/rental-runtime.mjs";
import { seed } from "../../scripts/seed.mjs";

test("WebGL design stays private until publication and survives PHP delivery", /** @brief 背景設定を実D1からPHP公開データまで検証する */ async (t) => {
  const runtime = await createRuntime();
  t.after(
    /** @brief テスト用プロセスと保存領域を解放する */ () =>
      runtime.dispose(),
  );
  await seed(runtime);
  const client = await fixtureClient(runtime);
  const catalogue = await (
    await fetch(`${runtime.php.origin}/api/public/catalogue`)
  ).json();
  const id = catalogue[0].id;
  const { game } = await client.json(`/manage/games/${id}`);
  const design = {
    backgroundColor: "#112233",
    backgroundAssetId: null,
    backgroundMode: "cover",
    webgl: {
      fragmentShader:
        "void mainImage(out vec4 color, in vec2 p) { color = vec4(p / iResolution.xy, sin(iTime), 1.0); }\n// 日本語 < > &",
    },
  };
  await client.json(`/manage/games/${id}`, {
    method: "PUT",
    body: { version: game.version, draft: { ...game.draft, design } },
  });
  const saved = await client.json(`/manage/games/${id}`);
  assert.deepEqual(saved.game.draft.design, design);
  const before = await (
    await fetch(`${runtime.php.origin}/api/public/catalogue`)
  ).json();
  assert.deepEqual(before, catalogue);
  await client.json(`/manage/games/${id}/publication`, {
    method: "POST",
    body: { version: saved.game.version, publish: true },
  });
  const after = await (
    await fetch(`${runtime.php.origin}/api/public/catalogue`)
  ).json();
  assert.deepEqual(
    after.find(
      /** @brief 更新対象の作品を取り出す */ (item: { id: string }) =>
        item.id === id,
    ).design,
    design,
  );
});
