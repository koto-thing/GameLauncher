import { fileTypeFromBuffer } from "file-type";
import { imageDimensionsFromData } from "image-dimensions";
import { parseWebStream } from "music-metadata";
import type { AssetStorage, StoredBody } from "../../application/ports";
import type { Asset } from "../../domain/models";
import { requireValue } from "../../domain/rules";

/** @brief ファイル構造の宣言長と実体の不一致を画像デコード前に拒否する。 */
function validateImageEnvelope(data: Uint8Array, mime: string): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (mime === "image/png") {
    // PNGの全チャンク境界を歩き、途中切断と後付けデータを拒否する。
    let offset = 8;
    let ended = false;
    while (offset + 12 <= data.length) {
      const size = view.getUint32(offset);
      requireValue(
        offset + 12 + size <= data.length,
        "PNGのチャンクが途中で切れています。",
      );
      const type = new TextDecoder().decode(
        data.subarray(offset + 4, offset + 8),
      );
      offset += size + 12;
      if (type === "IEND") {
        ended = true;
        break;
      }
    }
    requireValue(ended && offset === data.length, "PNGの終端が不正です。");
  } else if (mime === "image/webp")
    requireValue(
      data.length >= 16 && view.getUint32(4, true) + 8 === data.length,
      "WebPの容量が不正です。",
    );
  else
    requireValue(
      data.length > 4 &&
        data[data.length - 2] === 0xff &&
        data[data.length - 1] === 0xd9,
      "JPEGの終端が不正です。",
    );
}

/** @brief R2に不変の素材を保存し、ストリームから実データを検証する。 */
export class R2AssetStorage implements AssetStorage {
  /** @brief 非公開のMusic専用バケットを注入する。 */
  constructor(private readonly bucket: R2Bucket) {}
  /** @brief 申告容量を超過・不足したストリームを拒否して保存する。 */
  async put(
    key: string,
    body: ReadableStream<Uint8Array>,
    bytes: number,
  ): Promise<void> {
    const fixed = new FixedLengthStream(bytes);
    // バックプレッシャー付きで接続し、音源全体のarrayBuffer化を避ける。
    await Promise.all([
      body.pipeTo(fixed.writable),
      this.bucket.put(key, fixed.readable),
    ]);
  }
  /** @brief R2のRange処理を利用して必要な範囲だけ返す。 */
  async get(
    key: string,
    range?: { offset: number; length: number },
  ): Promise<StoredBody | null> {
    const object = await this.bucket.get(key, range ? { range } : undefined);
    return object ? { body: object.body, size: object.size } : null;
  }
  /** @brief 未確定の失敗素材を回収する。 */
  async remove(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
  /** @brief 拡張子と申告MIMEに頼らず形式・寸法・音源長を検証する。 */
  async inspect(
    key: string,
    kind: Asset["kind"],
    bytes: number,
  ): ReturnType<AssetStorage["inspect"]> {
    const head = await this.bucket.get(key, {
      range: { offset: 0, length: Math.min(bytes, 8192) },
    });
    requireValue(head && head.size === bytes, "保存容量が一致しません。");
    const prefix = new Uint8Array(await head.arrayBuffer());
    const detected = await fileTypeFromBuffer(prefix);
    requireValue(
      detected &&
        (kind === "audio"
          ? ["audio/mpeg", "audio/wav", "audio/x-wav"].includes(detected.mime)
          : ["image/jpeg", "image/png", "image/webp"].includes(detected.mime)),
      "音源はMP3 / PCM WAV、画像はJPEG / PNG / WebPにしてください。",
    );
    const object = await this.bucket.get(key);
    requireValue(object, "保存した素材が見つかりません。");
    if (kind === "image") {
      // 画像だけは上限8MiB以内で全構造を確認する。音源の全件展開はしない。
      const data = new Uint8Array(await object.arrayBuffer());
      validateImageEnvelope(data, detected.mime);
      const dimensions = imageDimensionsFromData(data);
      requireValue(dimensions, "画像の寸法を確認できません。");
      return {
        mime: detected.mime,
        durationSeconds: null,
        sampleRateHz: null,
        channels: null,
        widthPixels: dimensions.width,
        heightPixels: dimensions.height,
      };
    }
    if (detected.ext === "wav") {
      // RIFF全体長の不一致を、寛容なメタデータパーサーに渡す前に拒否する。
      requireValue(
        prefix.length >= 44 &&
          new DataView(prefix.buffer).getUint32(4, true) + 8 === bytes,
        "WAVの実容量がRIFF宣言と一致しません。",
      );
    }
    const { format } = await parseWebStream(
      object.body,
      { mimeType: detected.mime, size: bytes },
      { duration: true, skipCovers: true },
    );
    requireValue(
      Number.isFinite(format.duration) &&
        format.duration! > 0 &&
        Number.isFinite(format.sampleRate) &&
        [1, 2].includes(format.numberOfChannels ?? 0),
      "音源メタデータを確認できません。モノラルまたはステレオを使用してください。",
    );
    requireValue(
      detected.ext === "mp3"
        ? format.codec?.includes("MPEG")
        : format.codec?.startsWith("PCM"),
      "MP3またはPCM WAVのみ対応しています。",
    );
    return {
      mime: detected.ext === "wav" ? "audio/wav" : "audio/mpeg",
      durationSeconds: format.duration!,
      sampleRateHz: format.sampleRate!,
      channels: format.numberOfChannels!,
      widthPixels: null,
      heightPixels: null,
    };
  }
}
