import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CommandExport } from "./command-share";
import type { GameDesign } from "../../domain/models";
import { WebGLBackground } from "./webgl-background";
import { DEFAULT_FRAGMENT_SHADER } from "./glsl-program";
import { distributionSvg } from "./distribution-art";
import { encodeCommand } from "../../domain/command-code";

/** @brief 管理と公開共有で同じ背景付き配布画像を表示・保存・印刷する */
export function DistributionCard({
  id,
  url,
  title,
  exporter,
  webgl,
}: {
  id: number;
  url: string;
  title: string;
  exporter: () => Promise<CommandExport>;
  webgl?: GameDesign["webgl"];
}) {
  const [mode, setMode] = useState("color");
  const [color, setColor] = useState("#18243b");
  const [image, setImage] = useState("");
  const [frame, setFrame] = useState("");
  const [width, setWidth] = useState(1600);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const printImage = useRef<HTMLImageElement>(null);
  const uploadVersion = useRef(0);
  const onFrame = useCallback(
    /** @brief 描画直後のWebGLを背景用静止画像へ変換する */ (
      canvas: HTMLCanvasElement,
    ) => {
      setFrame(canvas.toDataURL("image/png"));
    },
    [],
  );
  const background = mode === "webgl" ? frame : mode === "image" ? image : "";
  const ready = mode === "color" || !!background;
  const svg = distributionSvg(id, title, color, background);

  /** @brief ローカル画像を検証して自己完結したPNG背景へ変換する */
  async function selectImage(file?: File) {
    const version = ++uploadVersion.current;
    setImage("");
    if (!file) return;

    try {
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        file.size > 10 * 1024 * 1024
      )
        throw new Error("PNG・JPEG・WebPの10MiB以下の画像を選んでください。");

      const bitmap = await createImageBitmap(file);
      try {
        if (bitmap.width * bitmap.height > 20_000_000)
          throw new Error("画像は20メガピクセル以下にしてください。");

        const canvas = document.createElement("canvas");
        const ratio = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
        canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
        canvas
          .getContext("2d")!
          .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        if (version === uploadVersion.current) {
          setImage(canvas.toDataURL("image/png"));
          setMessage("");
        }
      } finally {
        bitmap.close();
      }
    } catch (error) {
      if (version === uploadVersion.current)
        setMessage(
          error instanceof Error
            ? error.message
            : "画像を読み込めませんでした。",
        );
    }
  }

  /** @brief 操作時点の背景を固定し同じ配布画像を各形式へ出力する */
  async function output(kind: "png" | "svg" | "print") {
    setBusy(true);
    setMessage("");
    try {
      if (kind === "print") {
        printImage.current!.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
        await printImage.current!.decode();
        window.print();
      } else {
        const adapter = await exporter();
        adapter.save(
          kind === "png"
            ? await adapter.png(svg, width)
            : new Blob([svg], { type: "image/svg+xml" }),
          `pandd-track-${encodeCommand(id)}.${kind}`,
        );
      }
    } catch {
      setMessage("出力できませんでした。再試行してください。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="distribution-card">
      <label>
        コードの背景
        <select
          value={mode}
          onChange={
            /** @brief 背景の種類を選択する */ (event) =>
              setMode(event.target.value)
          }
        >
          <option value="color">背景色</option>
          <option value="image">画像</option>
          <option value="webgl">WebGL</option>
        </select>
      </label>
      <label>
        背景色
        <input
          type="color"
          value={color}
          onChange={
            /** @brief 配布画像のベース色を選ぶ */ (event) =>
              setColor(event.target.value)
          }
        />
      </label>
      {mode === "image" && (
        <label>
          背景画像
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={
              /** @brief 選択画像を端末内で読み込む */ (event) =>
                void selectImage(event.target.files?.[0])
            }
          />
        </label>
      )}
      {mode === "webgl" && (
        <div
          style={{ position: "relative", width: "100%", aspectRatio: "5 / 3" }}
        >
          <WebGLBackground
            settings={webgl ?? { fragmentShader: DEFAULT_FRAGMENT_SHADER }}
            onFrame={onFrame}
          />
        </div>
      )}
      <img
        className="command-image"
        src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
        alt={`${title}の配布コード`}
      />
      <p className="hint">
        PandD Musicの「コードを読み取る」から曲を開けます。選んだ背景は技コードの枠内に入り、保存・印刷にも反映されます。記号とマーカーの直下、外周の読み取り余白は白く保ちます。WebGLは出力時の静止画です。
      </p>
      <label>
        PNG保存幅
        <select
          value={width}
          onChange={
            /** @brief 出力解像度を選ぶ */ (event) =>
              setWidth(Number(event.target.value))
          }
        >
          <option value={1200}>1200px</option>
          <option value={1600}>1600px</option>
          <option value={2400}>2400px</option>
        </select>
      </label>
      <div className="command-actions">
        {(
          [
            ["png", "PNG保存"],
            ["svg", "SVG保存"],
            ["print", "曲名付きで印刷"],
          ] as const
        ).map(
          /** @brief 共通の配布画像を出力する */ ([kind, label]) => (
            <button
              key={kind}
              type="button"
              disabled={busy || !ready}
              onClick={
                /** @brief 選択形式で保存または印刷する */ () =>
                  void output(kind)
              }
            >
              {label}
            </button>
          ),
        )}
      </div>
      <p role="status">{message}</p>
      {createPortal(
        <article className="command-print-sheet" aria-hidden="true">
          <img ref={printImage} alt="" />
          <p className="command-print-url">{url}</p>
        </article>,
        document.body,
      )}
    </div>
  );
}
