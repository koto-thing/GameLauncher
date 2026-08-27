#pragma once

#include "presentation/live2d/Live2DAssetCatalog.h"
#include "presentation/live2d/Live2DModelData.h"

#include <QElapsedTimer>
#include <QOpenGLWidget>
#include <QPixmap>
#include <QTimer>

#include <memory>

namespace pandd {
class Live2DModel;

/** @brief ヒーロー画像と単一Cubismモデルと可読性用陰影を合成する */
class Live2DBackgroundWidget final : public QOpenGLWidget {
    Q_OBJECT
  public:
    /** @brief 30fps上限の操作不能な背景を構築する */
    explicit Live2DBackgroundWidget(QWidget* parent = nullptr);
    /** @brief 非同期読込とOpenGL資源を安全に解放する */
    ~Live2DBackgroundWidget() override;
    /** @brief 現在のモデルを再読込せずヒーロー画像を置換する */
    void setHero(const QPixmap& hero);
    /** @brief 置換画像の読込中に前のゲーム画像を解除する */
    void clearHero();
    /** @brief ヒーロー画像の正規化済み切り抜き焦点を設定する */
    void setFocalPoint(double x, double y);
    /** @brief モデルを選択し空選択の場合は前のモデルを解放する */
    void setModel(std::optional<Live2DAsset> asset);
    /** @brief ゲーム実行中の更新を停止する */
    void setGameRunning(bool running);
    /** @brief モデルの定期更新が動作中かを返す */
    [[nodiscard]] bool animationRunning() const;
    /** @brief 描画検証用にモデル読込済み状態を返す */
    [[nodiscard]] bool modelLoaded() const;

  signals:
    /** @brief ゲーム導入状態を変えず背景だけの失敗を通知する */
    void backgroundError(const QString& message);
    /** @brief モデル読込完了を描画検証へ通知する */
    void modelReady();

  protected:
    /** @brief OpenGL描画準備を完了して保留中のモデル読込を開始する */
    void initializeGL() override;
    /** @brief ヒーロー画像とモデルと陰影を順に描画する */
    void paintGL() override;
    /** @brief 表示開始時にアニメーション状態を更新する */
    void showEvent(QShowEvent* event) override;
    /** @brief 非表示時にアニメーションを停止する */
    void hideEvent(QHideEvent* event) override;
    /** @brief 親ウィンドウの表示状態変化をアニメーションへ反映する */
    bool eventFilter(QObject* watched, QEvent* event) override;

  private:
    /** @brief 現在のOpenGL資源を解放する */
    void releaseGraphics();
    /** @brief 可視性とゲーム実行状態からアニメーション動作を決める */
    void refreshAnimation();
    /** @brief CPU側で準備済みのモデルをOpenGLへ読み込む */
    void loadPendingModel();
    /** @brief モデル素材の検証と読込をワーカースレッドで開始する */
    void startModelLoad();
    QPixmap hero_;
    QPixmap scaledHero_;
    QSize scaledSize_;
    double focalX_{0.5};
    double focalY_{0.5};
    std::optional<Live2DAsset> asset_;
    std::unique_ptr<Live2DModel> model_;
    QTimer timer_;
    QElapsedTimer clock_;
    std::optional<Live2DModelData> prepared_;
    std::shared_ptr<std::atomic_bool> canceled_;
    quint64 requestId_{0};
    bool loading_{false};
    bool graphicsReady_{false};
    bool gameRunning_{false};
};
} // namespace pandd
