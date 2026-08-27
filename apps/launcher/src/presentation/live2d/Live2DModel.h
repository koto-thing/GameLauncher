#pragma once

#include <memory>

#include <QString>

namespace pandd {
struct Live2DModelData;

/**
 * @brief Cubism Native 5-r.5を使用するQt向けLive2DモデルAdapter
 *
 * 全methodをGUI threadから呼び出し読込と破棄は互換OpenGL contextをcurrentにして実行する
 */
class Live2DModel final {
  public:
    /** @brief 空のモデルAdapterを構築する */
    Live2DModel();

    /** @brief モデルが所有するCubismとOpenGL資源を解放する */
    ~Live2DModel();

    /** @brief GPU資源を持つモデルの複製を禁止する */
    Live2DModel(const Live2DModel&) = delete;
    /** @brief GPU資源を持つモデルの複製代入を禁止する */
    Live2DModel& operator=(const Live2DModel&) = delete;
    /** @brief GPU資源を持つモデルの移動を禁止する */
    Live2DModel(Live2DModel&&) = delete;
    /** @brief GPU資源を持つモデルの移動代入を禁止する */
    Live2DModel& operator=(Live2DModel&&) = delete;

    /**
     * @brief worker threadで準備したデータからCubismとGPU資源を構築する
     *
     * @param data 検証済みモデルbyte列と復号済みtexture
     * @param error 失敗時の可読エラーを受け取る
     * @return 成功時はtrue
     */
    [[nodiscard]] bool load(const Live2DModelData& data, QString& error);

    /** @brief 指定秒数だけanimation状態を進める */
    void update(float seconds);

    /**
     * @brief 現在のOpenGL targetへモデルを描画する
     *
     * @param pixelWidth 現在targetの物理pixel幅
     * @param pixelHeight 現在targetの物理pixel高
     * @param centerX widget幅で正規化した水平中央位置
     * @param centerY widget高で正規化した垂直中央位置
     * @param scale 全高に合わせたモデルに対する高さ倍率
     */
    void draw(int pixelWidth, int pixelHeight, float centerX, float centerY, float scale);

    /** @brief モデルが読込済みかを返す */
    [[nodiscard]] bool isLoaded() const noexcept;

    /** @brief 現在読込済みのmodel3.json pathを返す */
    [[nodiscard]] QString loadedModelPath() const;

  private:
    class Impl;
    std::unique_ptr<Impl> impl_;
};

} // namespace pandd
