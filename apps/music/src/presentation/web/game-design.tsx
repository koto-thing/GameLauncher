export { GameDesignSurface } from "./design-surface";
import type { GameDesign } from "../../domain/models";
import { GAME_DESIGN_DEFAULTS } from "../../config/game-design.defaults";
import type { ApiError } from "./api-client";
import { Field, imageUploadHint } from "./editor-common";
import { useSite } from "./context";

/** @brief 担当作品の背景を限定された入力で編集し、すぐ隣のプレビューへ反映する。 */
export function GameDesignEditor({
  value,
  onChange,
  onUpload,
  error,
}: {
  value?: GameDesign;
  onChange(value: GameDesign | undefined): void;
  onUpload(file?: File): void;
  error: ApiError | null;
}) {
  const { config } = useSite();
  const design = value ?? GAME_DESIGN_DEFAULTS;
  return (
    <div className="design-editor">
      <h2>作品ページのデザイン</h2>
      <p className="hint">
        作品・曲ページの背景を変更できます。文字と操作部分は読みやすいパネルで表示します。保存後に作品を公開すると反映されます。
      </p>
      <Field label="背景色" name="design" error={error}>
        <input
          type="color"
          value={design.backgroundColor}
          onChange={
            /** @brief 色を変えた時点で作品固有のデザインを有効にする。 */ (
              event,
            ) => onChange({ ...design, backgroundColor: event.target.value })
          }
        />
      </Field>
      <Field label={`背景画像（任意・${imageUploadHint(config?.policy)}）`}>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={
            /** @brief 背景も非公開R2へ通常の画像登録経路で送る。 */ (event) =>
              onUpload(event.target.files?.[0])
          }
        />
      </Field>
      <Field label="背景画像の表示方法">
        <select
          value={design.backgroundMode}
          onChange={
            /** @brief 表示方法は許可された3種類だけを選べる。 */ (event) =>
              onChange({
                ...design,
                backgroundMode: event.target
                  .value as GameDesign["backgroundMode"],
              })
          }
        >
          <option value="cover">画面を覆う</option>
          <option value="contain">画像全体を表示</option>
          <option value="tile">タイル状に繰り返す</option>
        </select>
      </Field>
      {design.backgroundAssetId && (
        <button
          type="button"
          onClick={
            /** @brief 素材を削除せず下書きから背景参照を外す。 */ () =>
              onChange({ ...design, backgroundAssetId: null })
          }
        >
          背景画像を外す
        </button>
      )}
      {value && (
        <button
          type="button"
          onClick={
            /** @brief 次回公開時にサイト標準デザインへ戻す。 */ () =>
              onChange(undefined)
          }
        >
          サイト標準に戻す
        </button>
      )}
      <p className="hint">
        背景は装飾用です。画像中の重要な情報は作品紹介にも記載してください。
      </p>
    </div>
  );
}
