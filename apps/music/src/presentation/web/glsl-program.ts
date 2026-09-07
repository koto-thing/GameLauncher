export const DEFAULT_FRAGMENT_SHADER = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    float wave = 0.5 + 0.5 * sin(uv.y * 12.0 + sin(uv.x * 8.0 + iTime));
    vec3 color = mix(vec3(0.06, 0.08, 0.18), vec3(0.8, 0.2, 0.5), wave);
    fragColor = vec4(color, 1.0);
}`;

/** @brief 公開と編集で共通のGLSL契約をコンパイルし、エラー時はGPU資源を解放する */
export function createBackgroundProgram(
  gl: WebGLRenderingContext,
  source: string,
): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("WebGLプログラムを作成できませんでした。");
  const shaders: WebGLShader[] = [];
  try {
    for (const [type, code] of [
      [
        gl.VERTEX_SHADER,
        "attribute vec2 position; void main(){gl_Position=vec4(position,0.,1.);}",
      ],
      [
        gl.FRAGMENT_SHADER,
        `precision highp float;
uniform vec3 iResolution;
uniform float iTime;
#line 1
${source}
void main(){mainImage(gl_FragColor,gl_FragCoord.xy);}`,
      ],
    ] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("シェーダーを作成できませんでした。");
      shaders.push(shader);
      gl.shaderSource(shader, code);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(
          gl.getShaderInfoLog(shader) || "GLSLのコンパイルに失敗しました。",
        );
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(
        gl.getProgramInfoLog(program) || "GLSLのリンクに失敗しました。",
      );
    return program;
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  } finally {
    for (const shader of shaders) gl.deleteShader(shader);
  }
}
