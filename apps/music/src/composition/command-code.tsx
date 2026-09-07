import { ScanCommand } from "../application/scan-command";
import { PhpCommandLookup } from "../infrastructure/command/lookup";
import { COMMAND_RUNTIME } from "../config/command-runtime.defaults";
import { CommandScan, type ScanDevice } from "../presentation/web/command-scan";
import type { CommandExport } from "../presentation/web/command-share";

/** @brief ホーム・曲詳細・手入力では画素認識依存を読み込まない */
async function loadDevice(): Promise<ScanDevice> {
  const [{ CommandRecognizer }, { CommandCamera }, images] = await Promise.all([
    import("../infrastructure/command/recognizer"),
    import("../infrastructure/command/camera"),
    import("../infrastructure/command/browser-images"),
  ]);
  const recognizer = new CommandRecognizer(COMMAND_RUNTIME),
    camera = new CommandCamera();
  return {
    start: /** @brief カメラ資源を専用Adapterへ委譲する */ (video) =>
      camera.start(video),
    stop: /** @brief 所有する全trackを停止する */ () => camera.stop(),
    video: /** @brief 映像から縮小した画素だけを認識器へ渡す */ (video) =>
      recognizer.recognize(
        images.capturePixels(
          video,
          video.videoWidth,
          video.videoHeight,
          COMMAND_RUNTIME.maxDimension,
        ),
      ),
    image: /** @brief 実際の画像復号後に同じ認識器を使う */ async (file) =>
      recognizer.recognize(await images.imagePixels(file, COMMAND_RUNTIME)),
  };
}

/** @brief PNGエンコード処理も保存操作まで読み込まない */
export async function commandExporter(): Promise<CommandExport> {
  const images = await import("../infrastructure/command/browser-images");
  return { png: images.pngBlob, save: images.saveBlob };
}

/** @brief 再生エンジンを生成せずスキャン画面だけを結線する */
export function ScanPage() {
  return (
    <CommandScan
      createScan={
        /** @brief マウントごとに独立した照会状態を作る */ () =>
          new ScanCommand(
            new PhpCommandLookup(
              import.meta.env.BASE_URL,
              COMMAND_RUNTIME.timeoutMs,
            ),
            COMMAND_RUNTIME,
          )
      }
      loadDevice={loadDevice}
      intervalMs={COMMAND_RUNTIME.intervalMs}
    />
  );
}
