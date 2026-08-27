#pragma once

#include "presentation/live2d/Live2DAssetCatalog.h"

#include <QWidget>

class QPixmap;
namespace pandd {
class Live2DBackgroundWidget;

/** @brief 合成背景の上へゲーム詳細操作を重ねる */
class GameDetailPage final : public QWidget {
    Q_OBJECT
  public:
    /** @brief 透明な操作領域の背面へ合成背景を構築する */
    explicit GameDetailPage(QWidget* parent = nullptr);
    /** @brief 通常のQt操作部品を配置する領域を返す */
    [[nodiscard]] QWidget* contentWidget() const;
    /** @brief 選択ゲームのヒーロー画像を設定または解除する */
    void setHero(const QPixmap& hero);
    /** @brief 前のゲームのヒーロー画像を解除する */
    void clearHero();
    /** @brief カタログの切り抜き焦点を背景へ渡す */
    void setFocalPoint(double x, double y);
    /** @brief 登録済みモデルまたはモデルなしを選択する */
    void setModel(std::optional<Live2DAsset> asset);
    /** @brief ゲーム実行中の背景更新を停止する */
    void setGameRunning(bool running);

  signals:
    /** @brief 致命的でない背景エラーをランチャーの状態領域へ渡す */
    void backgroundError(const QString& message);

  protected:
    /** @brief 背景と操作領域をページ全体へ追従させる */
    void resizeEvent(QResizeEvent* event) override;

  private:
    Live2DBackgroundWidget* background_;
    QWidget* content_;
};
} // namespace pandd
