import { useRef, useState } from "react";
import type { GameDesign } from "../../domain/models";
import {
  createBackgroundProgram,
  DEFAULT_FRAGMENT_SHADER,
} from "./glsl-program";

/** @brief 入力中のコードを公開用の下書きと分離し、コンパイル成功時だけ適用する */
export function ShaderEditor({
  value,
  onChange,
}: {
  value: GameDesign["webgl"];
  onChange(value: GameDesign["webgl"]): void;
}) {
  const [code, setCode] = useState(
    value?.fragmentShader ?? DEFAULT_FRAGMENT_SHADER,
  );
  const [error, setError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const changed = code !== value?.fragmentShader;
  /** @brief 実際のブラウザーで構文とリンクを検証し、成功したコードだけ反映する */
  function apply() {
    if (!code.trim() || code.length > 16000 || code.includes("\0")) {
      setError("GLSLコードは1〜16000文字で入力してください。");
      return;
    }
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) {
      setError("この端末ではWebGLを利用できません。");
      return;
    }
    try {
      const program = createBackgroundProgram(gl, code);
      gl.deleteProgram(program);
      input.current?.setCustomValidity("");
      setError("");
      onChange({ fragmentShader: code });
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "コンパイルに失敗しました。",
      );
    } finally {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  }
  return (
    <fieldset>
      <legend>GLSL背景</legend>
      <p className="hint">
        WebGL 1 / GLSL ES 1.00。mainImage(out vec4 fragColor, in vec2 fragCoord)
        を記述してください。iTime（秒・float）とiResolution（描画サイズ・vec3）は自動で渡されます。main・uniform宣言は不要です。テクスチャ、iMouse、複数パスには対応していません。
      </p>
      <label>
        フラグメントシェーダー（GLSL）
        <textarea
          ref={input}
          rows={16}
          maxLength={16000}
          value={code}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-describedby="shader-help shader-error"
          style={{ fontFamily: "monospace", tabSize: 4, width: "100%" }}
          onChange={
            /** @brief 未適用コードのままフォームが保存されるのを防ぐ */ (
              event,
            ) => {
              setCode(event.target.value);
              setError("");
              event.target.setCustomValidity(
                event.target.value === value?.fragmentShader
                  ? ""
                  : "GLSLをコンパイルして適用するか、編集を取り消してください。",
              );
            }
          }
        />
      </label>
      <p id="shader-help" className="hint">
        {code.length} /
        16000文字。アルファ値で背景色・画像に重ねられます。動きを抑える端末設定ではiTimeを0に固定します。
      </p>
      <button type="button" onClick={apply}>
        コンパイルして適用
      </button>
      <button
        type="button"
        onClick={
          /** @brief 入力を適用済みコードへ戻す */ () => {
            setCode(value?.fragmentShader ?? DEFAULT_FRAGMENT_SHADER);
            setError("");
            input.current?.setCustomValidity("");
          }
        }
      >
        編集を取り消す
      </button>
      {value && (
        <button
          type="button"
          onClick={
            /** @brief GLSL背景を下書きから外す */ () => onChange(undefined)
          }
        >
          GLSL背景を外す
        </button>
      )}
      <p role="status">
        {value && !changed
          ? "GLSL背景を適用済みです。下書きを保存し、作品を公開すると反映されます。"
          : "コードをコンパイルするとプレビューに反映されます。"}
      </p>
      <pre
        id="shader-error"
        role="alert"
        style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
      >
        {error}
      </pre>
    </fieldset>
  );
}
