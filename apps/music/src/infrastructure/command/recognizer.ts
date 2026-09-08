import {
  COMMAND_V1,
  COMMAND_ALPHABET,
} from "../../../../../contracts/music/command-code-v1";
import { markerBit } from "../../domain/command-art";
import { decodeCommand } from "../../domain/command-code";
import type {
  PixelFrame,
  Recognition,
  ImageRecognizer,
} from "../../application/scan-command";
import {
  homography,
  project,
  quadrilateral,
  cross,
  type Point,
} from "./geometry";

interface Settings {
  minimumScore: number;
  minimumMargin: number;
}

/** @brief 画素だけから固定v1図形を認識する軽量な端末内デコーダー外部OCRを使わない */
export class CommandRecognizer implements ImageRecognizer {
  lastFailure = "";
  /** @brief 形式互換性に関係しない確信度だけを調整可能にする */
  constructor(private settings: Settings) {}
  /** @brief 四隅・向き・セル確信度・CRCを順番に検査し、曖昧な候補の総当たりは行わない */
  recognize(frame: PixelFrame): Recognition {
    this.lastFailure = "markers";
    const { width: w, height: h, data } = frame;
    if (w < 100 || h < 100 || w * h > 4_000_000 || data.length !== w * h * 4)
      return { kind: "none" };
    const gray = new Uint8Array(w * h),
      histogram = new Uint32Array(256);
    let total = 0;
    for (let i = 0; i < gray.length; i++) {
      const alpha = data[i * 4 + 3] / 255;
      const v = Math.round(
        (data[i * 4] * 0.299 +
          data[i * 4 + 1] * 0.587 +
          data[i * 4 + 2] * 0.114) *
          alpha +
          255 * (1 - alpha),
      );
      gray[i] = v;
      histogram[v]++;
      total += v;
    }
    // 大津の二値化で軽い明るさ変化へ追従する色自体は情報にしない
    let count = 0,
      sum = 0,
      best = -1,
      threshold = 127;
    for (let i = 0; i < 255; i++) {
      count += histogram[i];
      sum += i * histogram[i];
      if (!count || count === gray.length) continue;
      const diff = sum / count - (total - sum) / (gray.length - count);
      const score = count * (gray.length - count) * diff * diff;
      if (score > best) {
        best = score;
        threshold = i;
      }
    }
    const bits = new Uint8Array(w * h);
    for (let i = 0; i < bits.length; i++)
      bits[i] = Number(gray[i] <= threshold);
    /** @brief 射影後の座標を読む画像外は構造検査を失敗させる */
    function sample(t: number[], x: number, y: number): number {
      const [u, v] = project(t, x, y);
      const px = Math.round(u),
        py = Math.round(v);
      return px < 0 || py < 0 || px >= w || py >= h ? -1 : bits[py * w + px];
    }
    const visited = new Uint8Array(w * h),
      queue = new Int32Array(w * h);
    const markers: { id: number; center: Point; quad: Point[] }[] = [];
    for (let start = 0; start < bits.length; start++) {
      if (!bits[start] || visited[start]) continue;
      let head = 0,
        tail = 1,
        minX = w,
        minY = h,
        maxX = 0,
        maxY = 0;
      queue[0] = start;
      visited[start] = 1;
      const boundary: Point[] = [];
      while (head < tail) {
        const index = queue[head++],
          x = index % w,
          y = Math.floor(index / w);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        let edge = false;
        for (const n of [
          x > 0 ? index - 1 : -1,
          x < w - 1 ? index + 1 : -1,
          y > 0 ? index - w : -1,
          y < h - 1 ? index + w : -1,
        ]) {
          if (n < 0 || !bits[n]) {
            edge = true;
            continue;
          }
          if (!visited[n]) {
            visited[n] = 1;
            queue[tail++] = n;
          }
        }
        if (edge) boundary.push([x, y]);
      }
      const bw = maxX - minX + 1,
        bh = maxY - minY + 1;
      if (
        tail < 50 ||
        bw < 12 ||
        bh < 12 ||
        bw > w * 0.3 ||
        bh > h * 0.5 ||
        bw / bh > 2.5 ||
        bh / bw > 2.5 ||
        tail / (bw * bh) < 0.32
      )
        continue;
      const quad = quadrilateral(boundary);
      if (quad.length !== 4) continue;
      try {
        // マーカーの全25点と4回転を確認する上下を決められない候補は採用しない
        const matches: { id: number; quad: Point[] }[] = [];
        for (let rot = 0; rot < 4; rot++) {
          const q = quad.slice(rot).concat(quad.slice(0, rot));
          const t = homography(
            [
              [0, 0],
              [5, 0],
              [5, 5],
              [0, 5],
            ],
            q,
          );
          for (let id = 0; id < 4; id++) {
            let errors = 0;
            for (let y = 0; y < 5; y++)
              for (let x = 0; x < 5; x++)
                if (sample(t, x + 0.5, y + 0.5) !== markerBit(id, x, y))
                  errors++;
            if (errors === 0) matches.push({ id, quad: q });
          }
        }
        if (matches.length !== 1) continue;
        const match = matches[0],
          t = homography(
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
            ],
            match.quad,
          );
        markers.push({ ...match, center: project(t, 0.5, 0.5) });
      } catch {
        continue;
      }
    }
    if (markers.length > 4) return { kind: "multiple" };
    if (
      markers.length !== 4 ||
      new Set(
        markers.map(
          /** @brief マーカーの位置IDの重複を拒否する */ (m) => m.id,
        ),
      ).size !== 4
    )
      return { kind: "none" };
    markers.sort(
      /** @brief 左上・右上・右下・左下の契約順にする */ (a, b) =>
        a.id - b.id,
    );
    const centers = markers.map(
      /** @brief 四隅の中心から射影を求める */ (m) => m.center,
    );
    // 鏡像を許すと右と左の意味が変わるため、幾何学的な向きも必須にする
    if (cross(centers[0], centers[1], centers[2]) <= 0) return { kind: "none" };
    try {
      const t = homography(COMMAND_V1.centers, centers);
      for (let id = 0; id < 4; id++) {
        const [cx, cy] = COMMAND_V1.centers[id];
        for (let y = 0; y < 5; y++)
          for (let x = 0; x < 5; x++)
            if (
              sample(
                t,
                cx - 24 + (x + 0.5) * 9.6,
                cy - 24 + (y + 0.5) * 9.6,
              ) !== markerBit(id, x, y)
            )
              return { kind: "none" };
      }
      // 細い外枠とその外の白余白も要求し、マーカーだけの切り貼りを受理しない
      let border = 0,
        quiet = 0;
      /** @brief 縮小・回転の丸めで細い枠が隣の画素へ移るため、法線方向の3点を調べる */
      function borderPixel(x: number, y: number, vertical: boolean): boolean {
        return [-1.5, 0, 1.5].some(
          /** @brief 太さの内側だけで黒線を探し、欠けた枠の補完はしない */ (
            offset,
          ) =>
            sample(
              t,
              x + (vertical ? offset : 0),
              y + (vertical ? 0 : offset),
            ) === 1,
        );
      }
      for (let i = 0; i < 32; i++) {
        const x = 64 + (672 * (i + 0.5)) / 32,
          y = 64 + (352 * (i + 0.5)) / 32;
        border +=
          Number(borderPixel(x, 64, false)) +
          Number(borderPixel(x, 416, false)) +
          Number(borderPixel(64, y, true)) +
          Number(borderPixel(736, y, true));
        quiet +=
          Number(sample(t, x, 48) === 0) +
          Number(sample(t, x, 432) === 0) +
          Number(sample(t, 48, y) === 0) +
          Number(sample(t, 752, y) === 0);
      }
      if (border < 96 || quiet < 120) {
        this.lastFailure = `border:${border},quiet:${quiet}`;
        return { kind: "none" };
      }
      let code = "";
      for (let cell = 0; cell < 12; cell++) {
        const x0 =
            COMMAND_V1.glyphOrigin +
            (cell % COMMAND_V1.columns) * COMMAND_V1.cellStride,
          y0 =
            COMMAND_V1.glyphOrigin +
            Math.floor(cell / COMMAND_V1.columns) * COMMAND_V1.cellStride;
        const p1 = project(t, x0, y0),
          p2 = project(t, x0 + 64, y0),
          p3 = project(t, x0, y0 + 64);
        if (
          Math.min(
            Math.hypot(p2[0] - p1[0], p2[1] - p1[1]),
            Math.hypot(p3[0] - p1[0], p3[1] - p1[1]),
          ) < 23.5
        ) {
          this.lastFailure = "size";
          return { kind: "none" };
        }
        const scores = COMMAND_V1.glyphs
          .map(
            /** @brief 図形の内部を4点ずつ比較し、印刷境界のにじみへの余裕を確保する */ (
              glyph,
              index,
            ) => {
              let same = 0;
              for (let y = 0; y < 7; y++)
                for (let x = 0; x < 7; x++)
                  for (const dy of [0.3, 0.7])
                    for (const dx of [0.3, 0.7])
                      if (
                        sample(t, x0 + (x + dx) * 8, y0 + (y + dy) * 8) ===
                        Number(glyph[y][x])
                      )
                        same++;
              return { index, score: same / 196 };
            },
          )
          .sort(
            /** @brief 最大確信度と次点の差だけで記号を確定する */ (a, b) =>
              b.score - a.score,
          );
        if (
          scores[0].score < this.settings.minimumScore ||
          scores[0].score - scores[1].score < this.settings.minimumMargin
        ) {
          this.lastFailure = `cell:${cell},score:${scores[0].score},margin:${scores[0].score - scores[1].score}`;
          return { kind: "none" };
        }
        code += COMMAND_ALPHABET[scores[0].index];
      }
      decodeCommand(1, code);
      this.lastFailure = "";
      return { kind: "code", code };
    } catch {
      return { kind: "none" };
    }
  }
}
