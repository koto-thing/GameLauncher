import {
  MusicError,
  type DomainPolicy,
  type GameDesign,
  type GameContent,
  type TrackContent,
  type LoopRegion,
  type Principal,
  type Asset,
  type RepeatMode,
} from "./models";

/** @brief UIとAPIで共有する入力失敗を通知する。 @param condition 成立すべき条件。 @param message 修正方法。 @param field 項目名。 */
export function requireValue(
  condition: unknown,
  message: string,
  field?: string,
): asserts condition {
  // 真偽を曖昧にしたまま公開処理へ進めない。
  if (!condition) throw new MusicError("INVALID", message, field);
}
/** @brief 作品担当または運営だけに編集を許可する。 @param actor 現在の所属。 @param gameId 対象作品。 */
export function authorize(
  actor: Principal | null,
  gameId?: string,
): asserts actor is Principal {
  // 毎リクエストで取得した所属を使い、古いセッションの権限を信用しない。
  if (!actor)
    throw new MusicError("UNAUTHENTICATED", "投稿者ログインが必要です。");
  if (!actor.admin && (!gameId || !actor.gameIds.includes(gameId)))
    throw new MusicError("FORBIDDEN", "この操作の権限がありません。");
}
/** @brief 未知のJSONを検証可能なオブジェクトに限定する。 @param value 外部入力。 @returns オブジェクト。 */
export function record(value: unknown): Record<string, unknown> {
  requireValue(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "入力形式が不正です。",
  );
  return value as Record<string, unknown>;
}
/** @brief プレーンテキストの長さを検証する。 @param value 入力。 @param max 上限文字数。 @param field 項目。 @param required 空欄禁止。 @returns 整形した文字列。 */
export function textValue(
  value: unknown,
  max: number,
  field: string,
  required = false,
): string {
  // HTMLは受け付けず、Reactのエスケープも重ねて利用する。
  requireValue(
    typeof value === "string" &&
      value.length <= max &&
      !/[<>]/u.test(value) &&
      !value.includes(String.fromCharCode(0)),
    `${field}は${max}文字以内のテキストにしてください。`,
    field,
  );
  requireValue(
    !required || value.trim().length > 0,
    `${field}を入力してください。`,
    field,
  );
  return value.trim();
}
/** @brief 外部リンクをHTTPSに限定する。 @param value URL。 @returns 検証済みURLまたは空文字。 */
export function safeUrl(value: unknown, maxCharacters: number): string {
  const url = textValue(value, maxCharacters, "URL");
  if (!url) return "";
  try {
    const parsed = new URL(url);
    requireValue(
      parsed.protocol === "https:" && !parsed.username && !parsed.password,
      "リンクはHTTPSで指定してください。",
      "URL",
    );
  } catch {
    throw new MusicError(
      "INVALID",
      "有効なHTTPS URLを指定してください。",
      "URL",
    );
  }
  return url;
}
/** @brief Asset IDをパスや任意文字列として解釈させない。 @param value IDまたはnull。 @returns ID。 */
export function assetId(value: unknown): string | null {
  if (value === null || value === "") return null;
  requireValue(
    typeof value === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(value),
    "素材IDが不正です。",
  );
  return value;
}
/** @brief 秒単位のループを不変の値として検証する。 @param startSeconds 開始秒。 @param endSeconds 終了秒。 @param durationSeconds 検証済み音源長。 @param minimumLengthSeconds 最短区間。 @returns 有効な区間。 */
export function createLoopRegion(
  startSeconds: number,
  endSeconds: number,
  durationSeconds: number,
  minimumLengthSeconds: number,
): LoopRegion {
  // NaNやInfinityを範囲比較前に排除する。
  requireValue(
    [startSeconds, endSeconds, durationSeconds, minimumLengthSeconds].every(
      Number.isFinite,
    ),
    "ループ値は有限の数値にしてください。",
    "loop",
  );
  requireValue(
    minimumLengthSeconds > 0 &&
      durationSeconds > 0 &&
      startSeconds >= 0 &&
      endSeconds <= durationSeconds &&
      endSeconds > startSeconds &&
      endSeconds - startSeconds >= minimumLengthSeconds - 1e-9,
    "ループは0≦開始＜終了≦音源長、最短区間以上にしてください。",
    "loop",
  );
  return Object.freeze({ startSeconds, endSeconds });
}
/** @brief 初期値の設定ミスを起動時に検出する。 @param policy 注入する業務ルール。 */
export function validatePolicy(policy: DomainPolicy): void {
  for (const section of Object.values(policy))
    for (const value of Object.values(section))
      requireValue(
        typeof value === "number" && Number.isFinite(value) && value > 0,
        "業務設定値が不正です。",
      );
}
/** @brief 作品下書きを安全なモデルへ変換する。 @param input JSON。 @param policy ルール。 @returns 作品内容。 */
export function gameContent(input: unknown, policy: DomainPolicy): GameContent {
  const value = record(input);
  return {
    title: textValue(value.title, policy.text.titleMax, "title", true),
    description: textValue(
      value.description,
      policy.text.descriptionMax,
      "description",
    ),
    imageAssetId: assetId(value.imageAssetId),
    imageAlt: textValue(value.imageAlt, policy.text.imageAltMax, "imageAlt"),
    externalUrl: safeUrl(value.externalUrl, policy.text.urlMax),
    rightsConfirmed: value.rightsConfirmed === true,
    ...(value.design === undefined ? {} : { design: gameDesign(value.design) }),
  };
}
/** @brief 背景の許可された値だけを扱い、任意CSSや外部画像URLを保存させない。 */
export function gameDesign(input: unknown): GameDesign {
  const value = record(input);
  requireValue(
    typeof value.backgroundColor === "string" &&
      /^#[0-9a-fA-F]{6}$/.test(value.backgroundColor),
    "背景色は6桁のカラーコードで指定してください。",
    "design",
  );
  requireValue(
    value.backgroundMode === "cover" ||
      value.backgroundMode === "contain" ||
      value.backgroundMode === "tile",
    "背景画像の表示方法が不正です。",
    "design",
  );
  return {
    backgroundColor: value.backgroundColor.toLowerCase(),
    backgroundAssetId: assetId(value.backgroundAssetId),
    backgroundMode: value.backgroundMode,
  };
}
/** @brief 曲下書きを検証し、未知のフィールドを捨てる。 @param input JSON。 @param policy ルール。 @returns 曲内容。 */
export function trackContent(
  input: unknown,
  policy: DomainPolicy,
): TrackContent {
  const value = record(input);
  requireValue(
    Array.isArray(value.credits) &&
      value.credits.length <= policy.text.creditMax,
    "クレジット人数が上限を超えています。",
    "credits",
  );
  const credits = value.credits.map(
    /** @brief 公開名と役割だけを保存する。 */ (item: unknown) => {
      const credit = record(item);
      return {
        name: textValue(
          credit.name,
          policy.text.creditNameMax,
          "credit.name",
          true,
        ),
        role: textValue(
          credit.role,
          policy.text.creditRoleMax,
          "credit.role",
          true,
        ),
      };
    },
  );
  let loop: LoopRegion | null = null;
  if (value.loop !== null) {
    const region = record(value.loop);
    requireValue(
      typeof region.startSeconds === "number" &&
        typeof region.endSeconds === "number",
      "ループ値が不正です。",
      "loop",
    );
    loop = createLoopRegion(
      region.startSeconds,
      region.endSeconds,
      policy.media.maxAudioDurationSeconds,
      policy.loop.minimumLengthSeconds,
    );
  }
  return {
    title: textValue(value.title, policy.text.titleMax, "title", true),
    credits,
    comment: textValue(value.comment, policy.text.descriptionMax, "comment"),
    audioAssetId: assetId(value.audioAssetId),
    imageAssetId: assetId(value.imageAssetId),
    imageAlt: textValue(value.imageAlt, policy.text.imageAltMax, "imageAlt"),
    loop,
    rightsConfirmed: value.rightsConfirmed === true,
  };
}
/** @brief 別作品・未検証・用途違いの素材を公開参照から排除する。 @param asset 素材。 @param gameId 作品。 @param kind 用途。 */
export function validateAsset(
  asset: Asset | null,
  gameId: string,
  kind: Asset["kind"],
): asserts asset is Asset {
  requireValue(
    asset &&
      asset.gameId === gameId &&
      asset.status === "verified" &&
      asset.kind === kind,
    "同じ作品の検証済み素材を指定してください。",
    kind === "audio" ? "audioAssetId" : "imageAssetId",
  );
}
/** @brief 音声クロックの経過を音源内の位置に変換する。 @param offsetSeconds 再開位置。 @param elapsedSeconds 音声クロックの経過秒。 @param durationSeconds 長さ。 @param region ループ区間。 @returns 音源内の秒数。 */
export function playbackPosition(
  offsetSeconds: number,
  elapsedSeconds: number,
  durationSeconds: number,
  region: LoopRegion | null,
): number {
  const position = Math.max(0, offsetSeconds + elapsedSeconds);
  // 最初だけイントロを含め、以降は区間の余りを使ってドリフトを避ける。
  if (region && position >= region.endSeconds)
    return (
      region.startSeconds +
      ((position - region.endSeconds) %
        (region.endSeconds - region.startSeconds))
    );
  return Math.min(position, durationSeconds);
}
/** @brief ループ終了以後の操作位置を開始へ正規化する。 @param seconds 要求位置。 @param duration 音源長。 @param region 区間。 @returns 実際の位置。 */
export function seekPosition(
  seconds: number,
  duration: number,
  region: LoopRegion | null,
): number {
  const bounded = Math.min(
    Math.max(Number.isFinite(seconds) ? seconds : 0, 0),
    duration,
  );
  return region && bounded >= region.endSeconds ? region.startSeconds : bounded;
}
/** @brief 再生キューの次の曲を決める。 @param queue 曲ID列。 @param current 現在の曲。 @param direction 移動方向。 @param repeat 排他的モード。 @param automatic 自然終端か。 @returns 次のIDまたは停止。 */
export function nextTrack(
  queue: readonly string[],
  current: string,
  direction: 1 | -1,
  repeat: RepeatMode,
  automatic: boolean,
): string | null {
  if (!queue.length) return null;
  if (automatic && repeat === "track") return current;
  const index = queue.indexOf(current) + direction;
  if (index >= 0 && index < queue.length) return queue[index];
  return repeat === "queue"
    ? queue[(index + queue.length) % queue.length]
    : null;
}
/** @brief 現在の曲を固定し残りをFisher–Yatesで並べ替える。 @param queue 基本順。 @param current 現在曲。 @param random テストで差し替える乱数。 @returns 再生順。 */
export function shuffledQueue(
  queue: readonly string[],
  current: string,
  random: () => number,
): string[] {
  const rest = queue.filter(
    /** @brief 現在曲を先頭へ保持する。 */ (id) => id !== current,
  );
  for (let index = rest.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [rest[index], rest[target]] = [rest[target], rest[index]];
  }
  return queue.includes(current) ? [current, ...rest] : rest;
}
