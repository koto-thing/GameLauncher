import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import { createBackgroundProgram } from "./glsl-program";
import type { GameDesign } from "../../domain/models";

export interface WebGLSnapshot {
  capture(): string;
}

/** @brief 装飾用シェーダーを描画し、非表示時の停止とGPU資源の解放を行う */
export function WebGLBackground({
  settings,
  onFrame,
  snapshotRef,
}: {
  settings: NonNullable<GameDesign["webgl"]>;
  onFrame?(canvas: HTMLCanvasElement): void;
  snapshotRef?: Ref<WebGLSnapshot>;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const capture = useRef<(() => string) | null>(null);

  useImperativeHandle(
    snapshotRef,
    /** @brief 描画直後のバッファからPNGを取得する */ () => ({
      /** @brief 描画できない状態では空画像の保存を防ぐ */
      capture() {
        if (!capture.current)
          throw new Error("WebGLの描画準備ができていません。");

        return capture.current();
      },
    }),
    [],
  );

  const [generation, setGeneration] = useState(0);
  useEffect(
    /** @brief GPUコンテキストの復旧時にプログラムを作り直す */ () => {
      const canvas = ref.current!;
      /** @brief ブラウザーにコンテキスト復旧を許可する */
      function lost(event: Event) {
        event.preventDefault();
      }
      /** @brief 復旧済みコンテキストの描画を再初期化する */
      function restored() {
        setGeneration(/** @brief 再初期化世代を進める */ (value) => value + 1);
      }
      canvas.addEventListener("webglcontextlost", lost);
      canvas.addEventListener("webglcontextrestored", restored);
      return /** @brief 復旧イベントの購読を解除する */ () => {
        canvas.removeEventListener("webglcontextlost", lost);
        canvas.removeEventListener("webglcontextrestored", restored);
      };
    },
    [],
  );
  useEffect(
    /** @brief 設定ごとに描画を開始し、破棄時にイベントと資源を解放する */ () => {
      const canvas = ref.current;
      if (!canvas) return;
      const gl = canvas.getContext("webgl", {
        alpha: true,
        premultipliedAlpha: false,
        antialias: false,
        depth: false,
      });
      if (!gl) {
        onFrame?.(canvas);
        return;
      }
      let program: WebGLProgram;
      try {
        program = createBackgroundProgram(gl, settings.fragmentShader);
      } catch {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        onFrame?.(canvas);
        return;
      }
      const buffer = gl.createBuffer();
      let frame = 0;
      /** @brief 作成済みのGPU資源を破棄する */
      function dispose() {
        capture.current = null;
        cancelAnimationFrame(frame);
        gl!.deleteBuffer(buffer);
        gl!.deleteProgram(program);
      }
      if (!program || !buffer) {
        dispose();
        return;
      }
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW,
      );
      const position = gl.getAttribLocation(program, "position");
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      const resolution = gl.getUniformLocation(program, "iResolution");
      const time = gl.getUniformLocation(program, "iTime");
      const motion = matchMedia("(prefers-reduced-motion: reduce)");
      let visible = true;
      let elapsed = 0;
      let previous = 0;
      let sampledAt = -Infinity;
      /** @brief 解像度を制限し、動きを抑える設定では静止画を描く */
      function draw(now: number) {
        const ratio = Math.min(
          1,
          1920 / Math.max(1, canvas!.clientWidth),
          1080 / Math.max(1, canvas!.clientHeight),
        );
        const width = Math.max(1, Math.round(canvas!.clientWidth * ratio));
        const height = Math.max(1, Math.round(canvas!.clientHeight * ratio));
        if (canvas!.width !== width || canvas!.height !== height) {
          canvas!.width = width;
          canvas!.height = height;
        }
        gl!.viewport(0, 0, width, height);
        gl!.uniform3f(resolution, width, height, 1);
        if (previous) elapsed += Math.min(now - previous, 100) / 1000;
        previous = now;
        gl!.uniform1f(time, motion.matches ? 0 : elapsed);
        gl!.drawArrays(gl!.TRIANGLES, 0, 6);
        capture.current =
          /** @brief 現在の時刻とサイズで再描画して破棄前に画像化する */ () => {
            if (gl!.isContextLost())
              throw new Error(
                "WebGLが停止しています。復旧後に再試行してください。",
              );

            gl!.drawArrays(gl!.TRIANGLES, 0, 6);

            return canvas!.toDataURL("image/png");
          };
        if (onFrame && now - sampledAt >= 1000) {
          onFrame(canvas!);
          sampledAt = now;
        }
        if (
          visible &&
          !document.hidden &&
          !motion.matches &&
          !gl!.isContextLost()
        )
          frame = requestAnimationFrame(draw);
      }
      /** @brief 可視性やサイズの変化で描画を再評価する */
      function refresh() {
        cancelAnimationFrame(frame);
        previous = 0;
        if (visible && !document.hidden) frame = requestAnimationFrame(draw);
      }
      const resize = new ResizeObserver(refresh);
      resize.observe(canvas);
      const observer = new IntersectionObserver(
        /** @brief 画面外の描画を停止する */ (entries) => {
          visible = entries[0].isIntersecting;
          refresh();
        },
      );
      observer.observe(canvas);
      document.addEventListener("visibilitychange", refresh);
      motion.addEventListener("change", refresh);
      refresh();
      return /** @brief アンマウント時にすべての監視を解除する */ () => {
        resize.disconnect();
        observer.disconnect();
        document.removeEventListener("visibilitychange", refresh);
        motion.removeEventListener("change", refresh);
        dispose();
      };
    },
    [settings.fragmentShader, generation, onFrame],
  );
  return (
    <canvas
      ref={ref}
      className="game-backdrop"
      aria-hidden="true"
      style={{ width: "100%", height: "100%", pointerEvents: "none" }}
    />
  );
}
