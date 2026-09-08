import type { PixelFrame } from "../../application/scan-command";

/** @brief ダウンロード用Blob URLを一時的に作り、使用後に解放する */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(
    /** @brief ダウンロード開始後に参照を解放する */ () =>
      URL.revokeObjectURL(url),
    1000,
  );
}

/** @brief 固定SVGをCanvasでPNGへ変換する外部画像・フォントの要求はない */
export async function pngBlob(svg: string, width: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.round(width * 0.6);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>(
      /** @brief エンコード失敗も呼出元へ返す */ (resolve, reject) =>
        canvas.toBlob(
          /** @brief PNGだけを生成する */ (blob) =>
            blob ? resolve(blob) : reject(new Error("PNG保存に失敗しました。")),
          "image/png",
        ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** @brief JPEG/PNG/WebPの寸法を圧縮ヘッダーから読み、巨大画像を復号前に拒否する */
export function imageDimensions(bytes: Uint8Array): [number, number] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length >= 24 &&
    v.getUint32(0) === 0x89504e47 &&
    v.getUint32(4) === 0x0d0a1a0a
  )
    return [v.getUint32(16), v.getUint32(20)];
  if (bytes.length > 12 && v.getUint16(0) === 0xffd8) {
    let p = 2;
    while (p + 4 <= bytes.length) {
      if (bytes[p++] !== 255) continue;
      while (bytes[p] === 255) p++;
      const marker = bytes[p++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const size = v.getUint16(p);
      if (size < 2 || p + size > bytes.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        size >= 7
      )
        return [v.getUint16(p + 5), v.getUint16(p + 3)];
      p += size;
    }
  }
  if (
    bytes.length >= 30 &&
    v.getUint32(0) === 0x52494646 &&
    v.getUint32(8) === 0x57454250
  ) {
    const tag = v.getUint32(12);
    if (tag === 0x56503858)
      return [
        1 + bytes[24] + bytes[25] * 256 + bytes[26] * 65536,
        1 + bytes[27] + bytes[28] * 256 + bytes[29] * 65536,
      ];
    if (tag === 0x56503820)
      return [v.getUint16(26, true) & 0x3fff, v.getUint16(28, true) & 0x3fff];
    if (tag === 0x5650384c && bytes[20] === 0x2f) {
      const n = v.getUint32(21, true);
      return [(n & 0x3fff) + 1, ((n >>> 14) & 0x3fff) + 1];
    }
  }
  throw new Error(
    "JPEG・PNG・WebPの有効な画像を選んでください。SVG・HEICは読み取れません。",
  );
}

/** @brief 動画・復号済み画像を処理上限まで縮小し、実画素だけを取り出す */
export function capturePixels(
  source: CanvasImageSource,
  width: number,
  height: number,
  max: number,
): PixelFrame {
  const scale = Math.min(1, max / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/** @brief 10MiB等の容量と寸法を先に検査し、EXIFの向きを反映して端末内復号する */
export async function imagePixels(
  file: File,
  settings: { maxFileBytes: number; maxPixels: number; maxDimension: number },
): Promise<PixelFrame> {
  if (file.size > settings.maxFileBytes)
    throw new Error("画像は10MiB以下にしてください。");
  const [w, h] = imageDimensions(new Uint8Array(await file.arrayBuffer()));
  if (!w || !h || w * h > settings.maxPixels)
    throw new Error("画像は20メガピクセル以下にしてください。");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (img.naturalWidth * img.naturalHeight > settings.maxPixels)
      throw new Error("画像が大きすぎます。");
    return capturePixels(
      img,
      img.naturalWidth,
      img.naturalHeight,
      settings.maxDimension,
    );
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message.includes("大き")
        ? error.message
        : "画像を復号できません。JPEG・PNG・WebPを確認してください。",
      { cause: error },
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
