
import { commandSvg } from "../../domain/command-art";
import { COMMAND_V1 } from "../../../../../contracts/music/command-code-v1";

/** @brief SVG内の文字列を属性と本文へ安全に埋め込む */
function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** @brief 技コードの枠内へ背景を合成し記号の位置を維持する */
export function distributionSvg(
  id: number,
  title: string,
  color: string,
  image = "",
): string {
  // 読み取り位置だけに白い下地を置き、枠内全体へ選択背景を表示する
  const markerPlates = COMMAND_V1.centers
    .map(
      /** @brief 四隅のマーカーと余白のコントラストを固定する */ ([x, y]) =>
        `<rect x="${x - 30}" y="${y - 30}" width="60" height="60" fill="white"/>`,
    )
    .join("");
  let glyphPlates = "";
  for (let i = 0; i < 12; i++) {
    const x = COMMAND_V1.glyphOrigin + (i % 6) * COMMAND_V1.cellStride;
    const y =
      COMMAND_V1.glyphOrigin + Math.floor(i / 6) * COMMAND_V1.cellStride;
    glyphPlates += `<rect x="${x - 4}" y="${y - 4}" width="64" height="64" rx="3" fill="white"/>`;
  }

  const background = `<rect width="800" height="480" fill="white"/><defs><clipPath id="code-background"><rect x="66" y="66" width="668" height="348"/></clipPath></defs><g clip-path="url(#code-background)"><rect width="800" height="480" fill="${escapeXml(color)}"/>${image ? `<image href="${escapeXml(image)}" width="800" height="480" preserveAspectRatio="xMidYMid slice"/>` : ""}</g><path d="M64 64H736V416H64Z" fill="none" stroke="white" stroke-width="9"/>${markerPlates}${glyphPlates}`;
  const command = commandSvg(id).replace(
    '<rect width="800" height="480" fill="white"/>',
    background,
  );

  // 曲名を枠内の上部に配置する
  return command.replace(
    "</svg>",
    `<title>${escapeXml(title)}</title><rect x="164" y="92" width="472" height="44" rx="4" fill="white"/><svg x="180" y="100" width="440" height="30"><text x="220" y="23" text-anchor="middle" font-family="sans-serif" font-size="22" fill="black">${escapeXml(title)}</text></svg></svg>`,
  );
}
