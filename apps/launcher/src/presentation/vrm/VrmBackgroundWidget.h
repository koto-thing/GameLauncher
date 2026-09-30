#pragma once

#include "presentation/BackgroundArtwork.h"

#include "presentation/vrm/VrmAssetCatalog.h"

#include <QTimer>
#include <QWidget>

class QWebEngineView;

namespace pandd {
/** @brief 同梱WebGLビューアでVRMを透明背景に描画する */
class VrmBackgroundWidget final : public QWidget {
    Q_OBJECT
  public:
    /** @brief VRMを選択するまでWebEngineの起動を遅延する */
    explicit VrmBackgroundWidget(QWidget* parent = nullptr);

    /** @brief JavaScriptコールバックを無効化してビューを解放する */
    ~VrmBackgroundWidget() override;

    /** @brief モデルを置換し空選択なら描画資源を解放する */
    void setModel(std::optional<VrmAsset> asset);

    /** @brief ゲーム実行中は背景アニメーションを停止する */
    void setGameRunning(bool running);

    /** @brief ヒーロー画像を置換する */
    void setHero(const QPixmap& hero);

    /** @brief 背景画像の切り抜き焦点を設定する */
    void setFocalPoint(double x, double y);

  signals:
    /** @brief 読込または描画失敗を通知する */
    void backgroundError(const QString& message);

    /** @brief モデルの初回描画完了を通知する */
    void modelReady();

  protected:
    /** @brief VRMの背面にヒーロー画像を描画する */
    void paintEvent(QPaintEvent* event) override;

    /** @brief ビューを背景領域へ合わせる */
    void resizeEvent(QResizeEvent* event) override;

    /** @brief 表示開始時に更新状態を同期する */
    void showEvent(QShowEvent* event) override;

    /** @brief 非表示時に更新を停止する */
    void hideEvent(QHideEvent* event) override;

    /** @brief 親ウィンドウの最小化を検出する */
    bool eventFilter(QObject* watched, QEvent* event) override;

  private:
    /** @brief 現在選択したモデルをビューアへ渡す */
    void loadModel();

    /** @brief 表示状態とゲーム実行状態をビューアへ渡す */
    void refreshAnimation();

    QWebEngineView* view_{nullptr};
    BackgroundArtwork artwork_;
    std::optional<VrmAsset> asset_;
    QTimer poll_;
    quint64 requestId_{0};
    int polls_{0};
    bool pageReady_{false};
    bool gameRunning_{false};
};
} // namespace pandd
