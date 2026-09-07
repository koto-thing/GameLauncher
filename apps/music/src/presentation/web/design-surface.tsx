import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { GameDesign } from "../../domain/models";
import { useSite } from "./context";
import { WebGLBackground } from "./webgl-background";
import { contrastTone } from "./background-contrast";

/** @brief 作品ページ・曲ページ・下書きプレビューで同じ背景表示を使う */
export function GameDesignSurface({
  design,
  children,
  variant = "page",
}: {
  design?: GameDesign;
  children: ReactNode;
  variant?: "page" | "mini";
}) {
  const { assetUrl } = useSite();
  const [tone, setTone] = useState<"light" | "dark">("dark");
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const sample = useRef<CanvasRenderingContext2D | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const imageUrl = design?.backgroundAssetId
    ? assetUrl(design.backgroundAssetId)
    : undefined;
  useEffect(
    /** @brief 透過シェーダーの背後にある画像を明度判定用に読み込む */ () => {
      if (!imageUrl) return;
      const loaded = new Image();
      loaded.crossOrigin = "anonymous";
      loaded.onload = /** @brief 読み込んだ同一サイト画像を判定に使う */ () =>
        setImage(loaded);
      loaded.src = imageUrl;
      return /** @brief 古い作品画像の遅延反映を防ぐ */ () => {
        loaded.onload = null;
      };
    },
    [imageUrl],
  );
  const onFrame = useCallback(
    /** @brief 背景を小さなCanvasへ合成し、描画結果から文字配色を選ぶ */ (
      canvas: HTMLCanvasElement,
    ) => {
      if (!design) return;
      if (!sample.current) {
        const target = document.createElement("canvas");
        target.width = 16;
        target.height = 16;
        sample.current = target.getContext("2d", { willReadFrequently: true });
      }
      const ctx = sample.current;
      if (!ctx) return;
      ctx.fillStyle = design.backgroundColor;
      ctx.fillRect(0, 0, 16, 16);
      if (
        image &&
        imageUrl &&
        image.src === new URL(imageUrl, window.location.href).href
      ) {
        const width = canvas.clientWidth || canvas.width || 1,
          height = canvas.clientHeight || canvas.height || 1;
        ctx.save();
        ctx.scale(16 / width, 16 / height);
        if (design.backgroundMode === "tile") {
          const tileHeight = (240 * image.height) / image.width;
          for (
            let y = (((height - tileHeight) / 2) % tileHeight) - tileHeight;
            y < height;
            y += tileHeight
          )
            for (let x = (((width - 240) / 2) % 240) - 240; x < width; x += 240)
              ctx.drawImage(image, x, y, 240, tileHeight);
        } else {
          const ratio =
            design.backgroundMode === "cover"
              ? Math.max(width / image.width, height / image.height)
              : Math.min(width / image.width, height / image.height);
          const w = image.width * ratio,
            h = image.height * ratio;
          ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
        }
        ctx.restore();
      }
      ctx.drawImage(canvas, 0, 0, 16, 16);
      const pixels = ctx.getImageData(0, 0, 16, 16).data;
      setTone(
        /** @brief 前回の配色を境界付近では維持する */ (previous) =>
          contrastTone(pixels, previous),
      );
    },
    [design, image, imageUrl],
  );
  useEffect(/** @brief 静止背景もミニプレーヤーの寸法で明度を判定する */ () => {
    if (variant !== "mini" || !design || design.webgl || !surface.current) return;
    const element = surface.current;
    const blank = document.createElement("canvas");
    /** @brief 背景の表示領域が変わったら再判定する */
    function measure() {
      blank.width = Math.max(1, element.clientWidth);
      blank.height = Math.max(1, element.clientHeight);
      onFrame(blank);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return /** @brief 静止背景の監視を終了する */ () => observer.disconnect();
  }, [variant, design, onFrame]);
  if (!design) return variant === "mini" ? <div className="mini-player-content">{children}</div> : <>{children}</>;
  // 任意HTML/CSSを生成せず、検証済みの色と同一サイトの素材IDだけをスタイルへ渡す
  return (
    <div
      ref={surface}
      className={`game-surface${design.webgl || variant === "mini" ? " game-surface-glsl" : ""}${variant === "mini" ? " mini-player-content" : ""}`}
      data-background-tone={design.webgl || variant === "mini" ? tone : undefined}
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
      {design.webgl && (
        <WebGLBackground settings={design.webgl} onFrame={onFrame} />
      )}
      <div className="game-surface-content">{children}</div>
    </div>
  );
}
