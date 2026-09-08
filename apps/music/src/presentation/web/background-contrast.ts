/** @brief sRGBの値を相対輝度の計算に使う線形値へ変換する */
function linear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** @brief 明暗の切替に小さな余裕を持たせ、境界付近のちらつきを抑える */
export function contrastTone(
  pixels: Uint8ClampedArray,
  previous: "light" | "dark",
): "light" | "dark" {
  let luminance = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    luminance +=
      0.2126 * linear(pixels[i] / 255) +
      0.7152 * linear(pixels[i + 1] / 255) +
      0.0722 * linear(pixels[i + 2] / 255);
  }
  luminance /= pixels.length / 4;
  return luminance > 0.21 ? "light" : luminance < 0.15 ? "dark" : previous;
}
