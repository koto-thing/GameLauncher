import type { ReactNode } from "react";
import type { GameDesign } from "../../domain/models";
import { useSite } from "./context";

/** @brief 作品ページ・曲ページ・下書きプレビューで同じ背景表示を使う。 */
export function GameDesignSurface({
  design,
  children,
}: {
  design?: GameDesign;
  children: ReactNode;
}) {
  const { assetUrl } = useSite();
  if (!design) return <>{children}</>;
  // 任意HTML/CSSを生成せず、検証済みの色と同一サイトの素材IDだけをスタイルへ渡す。
  return (
    <div
      className="game-surface"
      style={{ backgroundColor: design.backgroundColor }}
    >
      <div
        aria-hidden="true"
        className={`game-backdrop background-${design.backgroundMode}`}
        style={{
          backgroundImage: design.backgroundAssetId
            ? `url("${assetUrl(design.backgroundAssetId)}")`
            : undefined,
        }}
      />
      <div className="game-surface-content">{children}</div>
    </div>
  );
}
