import { deflateSync, crc32 } from "node:zlib";

/** @brief 自作検証トーンをPCM16 WAVとして生成する。 @param variant 周波数を区別する番号。 @returns 権利上問題のない検証音源。 */
export function toneWav(variant = 0) {
  // 0〜1秒イントロ、1〜3秒反復区間、3〜4秒アウトロを周波数で区別する。
  const rate = 24000;
  const seconds = 4;
  const samples = rate * seconds;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) {
    const time = index / rate;
    const frequency = (time < 1 ? 220 : time < 3 ? 440 : 660) + variant * 40;
    buffer.writeInt16LE(
      Math.round(Math.sin(2 * Math.PI * frequency * time) * 2800),
      44 + index * 2,
    );
  }
  return buffer;
}
/** @brief PNGの標準チャンクを構成する。 */
function pngChunk(name, data) {
  const type = Buffer.from(name);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, checksum]);
}
/** @brief 作品素材を捏造せず、単色の検証用プレースホルダーを生成する。 */
export function placeholderPng(width = 480, height = 270, variant = 0) {
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 3 + 1) + x * 3 + 1;
      const border = x < 8 || x >= width - 8 || y < 8 || y >= height - 8;
      pixels[offset] = border ? 100 : variant % 2 ? 191 : 208;
      pixels[offset + 1] = border ? 123 : 221;
      pixels[offset + 2] = border ? 105 : variant % 2 ? 226 : 182;
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
