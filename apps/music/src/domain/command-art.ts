import {
  COMMAND_V1,
  COMMAND_ALPHABET,
} from "../../../../contracts/music/command-code-v1";
import { encodeCommand } from "./command-code";

/** @brief フォント非依存の固定7×7図形をSVGパスへ変換する */
export function glyphPath(index: number): string {
  let path = "";
  const rows = COMMAND_V1.glyphs[index];
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 7; x++)
      if (rows[y][x] === "1") path += `M${x * 8} ${y * 8}h8v8h-8z`;
  return path;
}

/** @brief マーカーの5×5固定画素を返す外周は位置検出用の連結した黒枠 */
export function markerBit(id: number, x: number, y: number): number {
  return x === 0 || y === 0 || x === 4 || y === 4
    ? 1
    : Number(COMMAND_V1.markers[id][(y - 1) * 3 + x - 1]);
}

/** @brief 保存と画面表示を同じID・パス・白背景・余白で生成する曲名を領域に埋め込まない */
export function commandSvg(id: number): string {
  const code = encodeCommand(id);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="960" viewBox="0 0 800 480"><rect width="800" height="480" fill="white"/><g fill="black"><path fill="none" stroke="black" stroke-width="3" d="M64 64H736V416H64Z"/>`;
  COMMAND_V1.centers.forEach(
    /** @brief 四隅の固定マーカーは曲IDによって変えない */ ([cx, cy], id) => {
      for (let y = 0; y < 5; y++)
        for (let x = 0; x < 5; x++)
          if (markerBit(id, x, y))
            svg += `<path d="M${cx - 24 + x * 9.6} ${cy - 24 + y * 9.6}h9.6v9.6h-9.6z"/>`;
    },
  );
  [...code].forEach(
    /** @brief 上段左から6記号、続いて下段の6記号を配置する */ (c, i) => {
      svg += `<path transform="translate(${COMMAND_V1.glyphOrigin + (i % COMMAND_V1.columns) * COMMAND_V1.cellStride} ${COMMAND_V1.glyphOrigin + Math.floor(i / COMMAND_V1.columns) * COMMAND_V1.cellStride})" d="${glyphPath(COMMAND_ALPHABET.indexOf(c))}"/>`;
    },
  );
  return svg + "</g></svg>";
}
