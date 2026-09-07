import test from "node:test";
import assert from "node:assert/strict";
import { CommandCamera } from "../../src/infrastructure/command/camera";
import { imageDimensions } from "../../src/infrastructure/command/browser-images";

test("camera adapter cancellation, playback failure and repeated stop release every track", /** @brief 実カメラなしで許可応答の競合と資源解放を検査する */ async (t) => {
  const savedNavigator = Object.getOwnPropertyDescriptor(
      globalThis,
      "navigator",
    ),
    savedWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  t.after(
    /** @brief 他のテストへブラウザー代用品を残さない */ () => {
      if (savedNavigator)
        Object.defineProperty(globalThis, "navigator", savedNavigator);
      if (savedWindow) Object.defineProperty(globalThis, "window", savedWindow);
      else Reflect.deleteProperty(globalThis, "window");
    },
  );
  let stopped = 0,
    resolve: ((stream: MediaStream) => void) | undefined;
  const stream = {
    getTracks: /** @brief 全trackが解放対象になることを検査する */ () => [
      { stop: /** @brief 1本目の停止を記録する */ () => stopped++ },
      { stop: /** @brief 2本目も必ず停止する */ () => stopped++ },
    ],
  } as unknown as MediaStream;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { isSecureContext: true },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: /** @brief 許可応答を試験が返すまで保留する */ () =>
          new Promise<MediaStream>(
            /** @brief 遅延した許可を保持する */ (finish) => {
              resolve = finish;
            },
          ),
      },
    },
  });
  const video = {
    srcObject: null,
    pause: /** @brief 停止時のプレビュー操作を受ける */ () => {},
    play: /** @brief 映像再生の成功を返す */ async () => {},
  } as unknown as HTMLVideoElement;
  const camera = new CommandCamera(),
    pending = camera.start(video);
  camera.stop();
  resolve!(stream);
  assert.equal(await pending, false);
  assert.equal(stopped, 2);
  assert.equal(video.srcObject, null);
  const active = camera.start(video);
  resolve!(stream);
  assert.equal(await active, true);
  camera.stop();
  camera.stop();
  assert.equal(stopped, 4);
  assert.equal(video.srcObject, null);
  video.play = /** @brief 起動後のplay拒否でもtrackを残さない */ async () => {
    throw new Error("play failure");
  };
  const failed = camera.start(video);
  resolve!(stream);
  await assert.rejects(failed, /再生できません/);
  assert.equal(stopped, 6);
});

test("compressed image dimensions are inspected without decoding metadata as a code", /** @brief 巨大PNGと不正形式を復号前に判別できることを確認する */ () => {
  const png = new Uint8Array(24),
    view = new DataView(png.buffer);
  view.setUint32(0, 0x89504e47);
  view.setUint32(4, 0x0d0a1a0a);
  view.setUint32(16, 100000);
  view.setUint32(20, 100000);
  assert.deepEqual(imageDimensions(png), [100000, 100000]);
  for (const input of [
    new Uint8Array(),
    new TextEncoder().encode('<svg data-code="UUUUUUUULUBY"/>'),
  ])
    assert.throws(
      /** @brief 埋め込み文字列を復号結果に流用しない */ () =>
        imageDimensions(input),
    );
});
