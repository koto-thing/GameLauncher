export type Point = [number, number];
/** @brief 4対応点の射影変換を消去法で解き、台形を正規位置へ戻す */
export function homography(
  from: readonly (readonly number[])[],
  to: readonly Point[],
): number[] {
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i],
      [u, v] = to[i];
    a.push(
      [x, y, 1, 0, 0, 0, -u * x, -u * y, u],
      [0, 0, 0, x, y, 1, -v * x, -v * y, v],
    );
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++)
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const divisor = a[col][col];
    if (Math.abs(divisor) < 1e-9) throw new Error("四隅を確定できません。");
    for (let j = col; j < 9; j++) a[col][j] /= divisor;
    for (let row = 0; row < 8; row++)
      if (row !== col) {
        const factor = a[row][col];
        for (let j = col; j < 9; j++) a[row][j] -= factor * a[col][j];
      }
  }
  return a.map(/** @brief 解の8係数を取り出す */ (row) => row[8]);
}

/** @brief 正規座標を撮影画像内の座標へ射影する */
export function project(h: number[], x: number, y: number): Point {
  const d = h[6] * x + h[7] * y + 1;
  return [(h[0] * x + h[1] * y + h[2]) / d, (h[3] * x + h[4] * y + h[5]) / d];
}

/** @brief 三点の向きで鏡像や退化した四隅を判別する */
export function cross(a: Point, b: Point, c: Point): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** @brief 連結図形の外周を凸包へ整理し、小さな段差を除いて四隅を得る */
export function quadrilateral(points: Point[]): Point[] {
  points.sort(
    /** @brief 座標順に走査して凹凸を取り除く */ (a, b) =>
      a[0] - b[0] || a[1] - b[1],
  );
  const low: Point[] = [],
    high: Point[] = [];
  for (const p of points) {
    while (low.length >= 2 && cross(low.at(-2)!, low.at(-1)!, p) <= 0)
      low.pop();
    low.push(p);
  }
  for (const p of points.reverse()) {
    while (high.length >= 2 && cross(high.at(-2)!, high.at(-1)!, p) <= 0)
      high.pop();
    high.push(p);
  }
  const hull = low.slice(0, -1).concat(high.slice(0, -1));
  while (hull.length > 4) {
    let smallest = Infinity,
      index = 0;
    for (let i = 0; i < hull.length; i++) {
      const area = Math.abs(
        cross(
          hull[(i + hull.length - 1) % hull.length],
          hull[i],
          hull[(i + 1) % hull.length],
        ),
      );
      if (area < smallest) {
        smallest = area;
        index = i;
      }
    }
    hull.splice(index, 1);
  }
  return hull;
}
