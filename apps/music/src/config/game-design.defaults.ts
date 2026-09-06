import type { GameDesign } from "../domain/models";

// 未設定作品はサイト標準色。カスタマイズを始めるときだけこの値を下書きへ入れる。
export const GAME_DESIGN_DEFAULTS: Readonly<GameDesign> = {
  backgroundColor: "#fff4f6",
  backgroundAssetId: null,
  backgroundMode: "cover",
};
