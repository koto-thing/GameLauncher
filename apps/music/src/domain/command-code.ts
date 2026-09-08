import {
  COMMAND_ALPHABET,
  COMMAND_SYMBOLS,
} from "../../../../contracts/music/command-code-v1";

/** @brief 受信バイト列のCRC-12/DECTを計算する認証や誤り訂正ではない */
export function crc12(bytes: Iterable<number>): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 4;
    for (let bit = 0; bit < 8; bit++)
      crc = ((crc << 1) ^ (crc & 0x800 ? 0x80f : 0)) & 0xfff;
  }
  return crc;
}

/** @brief 24ビットの整数だけを共有IDとして受け付ける0も有効 */
export function validateCodeId(id: number): void {
  if (!Number.isInteger(id) || id < 0 || id > 0xffffff)
    throw new Error("共有IDが不正です。");
}

/** @brief IDをビッグエンディアン3バイトで固定ドメインへ連結する */
export function commandChecksum(id: number): number {
  validateCodeId(id);
  return crc12([0x50, 0x44, 0x4d, 1, id >>> 16, (id >>> 8) & 255, id & 255]);
}

/** @brief 先頭ゼロを保持し、ID8記号とCRC4記号を発行する */
export function encodeCommand(id: number): string {
  const octal =
    id.toString(8).padStart(8, "0") +
    commandChecksum(id).toString(8).padStart(4, "0");
  return [...octal]
    .map(
      /** @brief 8進の1桁を固定記号へ変換する */ (n) =>
        COMMAND_ALPHABET[Number(n)],
    )
    .join("");
}

/** @brief 12記号すべてを検査し、誤った記号を勝手に訂正しない */
export function decodeCommand(version: number, code: string): number {
  if (version !== 1 || !/^[UDRLABXY]{12}$/.test(code))
    throw new Error("v1の12記号を入力してください。");
  const octal = [...code]
    .map(
      /** @brief 固定の順序を保って数値化する */ (c) =>
        COMMAND_ALPHABET.indexOf(c),
    )
    .join("");
  const id = parseInt(octal.slice(0, 8), 8);
  if (parseInt(octal.slice(8), 8) !== commandChecksum(id))
    throw new Error("検査値が一致しません。12記号を確認してください。");
  return id;
}

/** @brief 空白・改行・ハイフン・カンマだけを区切りとして許可し、不明な文字は拒否する */
export function normalizeCommand(text: string): string {
  const value = [...text.toUpperCase().replace(/[\s,-]/g, "")]
    .map(
      /** @brief 矢印だけを対応ASCIIへ変換する */ (c) => {
        const i = COMMAND_SYMBOLS.indexOf(c);
        return i < 0 ? c : COMMAND_ALPHABET[i];
      },
    )
    .join("");
  if (!/^[UDRLABXY]{0,12}$/.test(value))
    throw new Error(
      "使用できる記号は↑ ↓ → ← A B X Yです。区切りは空白・改行・ハイフン・カンマです。",
    );
  return value;
}

/** @brief コピー用の読みやすい記号列を作る */
export function displayCommand(code: string): string {
  return [...code]
    .map(
      /** @brief 記号列を表示用の区切りへ変換する */ (c, index) =>
        `${c}${index % 4 === 3 && index < code.length - 1 ? " " : ""}`,
    )
    .join("");
}
