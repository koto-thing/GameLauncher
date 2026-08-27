#pragma once

#include <memory>

#include <QString>

namespace pandd {

/**
 * @brief Live2D Cubism Framework共有runtime
 *
 * acquireでinstanceを取得しGUI thread上で複数のLive2DModelから共有する
 */
class CubismRuntime final {
  public:
    /** @brief runtimeを破棄してCubism Frameworkを終了する */
    ~CubismRuntime();

    /** @brief 共有runtimeの複製を禁止する */
    CubismRuntime(const CubismRuntime&) = delete;
    /** @brief 共有runtimeの複製代入を禁止する */
    CubismRuntime& operator=(const CubismRuntime&) = delete;
    /** @brief 共有runtimeの移動を禁止する */
    CubismRuntime(CubismRuntime&&) = delete;
    /** @brief 共有runtimeの移動代入を禁止する */
    CubismRuntime& operator=(CubismRuntime&&) = delete;

    /**
     * @brief 共有runtime instanceを取得する
     *
     * @param error 失敗時の可読エラーを受け取る
     * @return 共有runtime instanceまたは失敗時のnull
     */
    static std::shared_ptr<CubismRuntime> acquire(QString& error);

    /** @brief Framework初期化が成功したかを返す */
    [[nodiscard]] bool isInitialized() const noexcept;

    /** @brief runtimeが収集した直近のCubism診断を返して消去する */
    [[nodiscard]] QString takeDiagnostics();

  private:
    /** @brief 未初期化のruntimeを構築する */
    CubismRuntime();

    /** @brief Cubism Frameworkを初期化する */
    bool initialize(QString& error);

    class Impl;
    std::unique_ptr<Impl> impl_;
};

} // namespace pandd
