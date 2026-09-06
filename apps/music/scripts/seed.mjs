import { pathToFileURL } from "node:url";
import { fixtureClient } from "../tests/support/rental-runtime.mjs";
import { placeholderPng, toneWav } from "../tests/support/fixtures.mjs";

/** @brief 2作品6曲を実APIで登録し、公開・アップロード経路のseedにもする。 */
export async function seed(runtime) {
  const client = await fixtureClient(runtime, "music-admin");
  const existing = await client.json("/manage/games");
  if (
    existing.some(
      /** @brief 実データへデモを混ぜない。 */ (game) =>
        !game.draft.title.startsWith("DEMO "),
    )
  ) {
    console.log("実データがあるためseedを追加しません。");
    return;
  }
  for (let index = 0; index < 2; index++) {
    const draft = {
      title: `DEMO ${index + 1} / ${index === 0 ? "ひだまりの庭" : "夜の航路"}`,
      description:
        "自作テストトーンによる検証用サウンドトラックです。実在するゲーム・作曲者の情報ではありません。",
      imageAssetId: null,
      imageAlt: "単色の検証用プレースホルダー",
      externalUrl: "",
      rightsConfirmed: true,
    };
    let game =
      existing.find(
        /** @brief 途中で止まったseedを同じ作品から再開する。 */ (item) =>
          item.draft.title === draft.title,
      ) ??
      (await client.json("/manage/games", { method: "POST", body: draft }));
    if (!game.published) {
      const cover = await client.upload(
        game.id,
        "image",
        placeholderPng(480, 270, index),
      );
      draft.imageAssetId = cover.id;
      await client.json(`/manage/games/${game.id}`, {
        method: "PUT",
        body: { draft, version: game.version },
      });
      game = (await client.json(`/manage/games/${game.id}`)).game;
      await client.json(`/manage/games/${game.id}/publication`, {
        method: "POST",
        body: { publish: true, version: game.version },
      });
    }
    await client.json(
      `/admin/games/${game.id}/members/${index === 0 ? "900002" : "900003"}`,
      { method: "PUT", body: { enabled: true } },
    );
    for (let song = 0; song < 3; song++) {
      const title = `DEMO ${index + 1}-${song + 1} / ${["はじまりの音", "繰り返す風景", "帰り道"][song]}`;
      const tracks = (await client.json(`/manage/games/${game.id}`)).tracks;
      let track = tracks.find(
        /** @brief 完了済みのデモ曲と編集内容を上書きしない。 */ (item) =>
          item.draft.title === title,
      );
      if (track?.published) continue;
      track ??= await client.json(`/manage/games/${game.id}/tracks`, {
        method: "POST",
        body: { title },
      });
      const audio = await client.upload(
        game.id,
        "audio",
        toneWav(index * 3 + song),
      );
      const image = await client.upload(
        game.id,
        "image",
        placeholderPng(
          song === 1 ? 200 : 480,
          song === 1 ? 360 : 270,
          index + song,
        ),
      );
      const content = {
        ...track.draft,
        credits: [{ name: "PandD Music 検証トーン生成", role: "テスト素材" }],
        audioAssetId: audio.id,
        imageAssetId: image.id,
        imageAlt: song === 1 ? "縦長の検証用画像" : "横長の検証用画像",
        comment:
          "イントロ0〜1秒、区間1〜3秒、アウトロ3〜4秒の検証用トーンです。",
        rightsConfirmed: true,
      };
      await client.json(`/manage/tracks/${track.id}`, {
        method: "PUT",
        body: {
          draft: content,
          position: track.position,
          version: track.version,
        },
      });
      track = (await client.json(`/manage/tracks/${track.id}`)).track;
      await client.json(`/manage/tracks/${track.id}`, {
        method: "PUT",
        body: {
          draft: {
            ...track.draft,
            loop: song < 2 ? { startSeconds: 1, endSeconds: 3 } : null,
          },
          position: track.position,
          version: track.version,
        },
      });
      track = (await client.json(`/manage/tracks/${track.id}`)).track;
      await client.json(`/manage/tracks/${track.id}/publication`, {
        method: "POST",
        body: { publish: true, version: track.version },
      });
    }
  }
  console.log("DEMO: 2作品・6曲をローカルcontrol-plane D1/PHPに登録しました。");
}
// seedは独立したローカルプロセスで実施し、本番用コマンドやリモート指定を受け付けない。
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const origin = "http://127.0.0.1:8788";
  await seed({
    origin,
    dispatchFetch: /** @brief 起動中の隔離ローカル環境へだけ送る。 */ (
      ...args
    ) => fetch(...args),
  });
}
