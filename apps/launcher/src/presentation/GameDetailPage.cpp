#include "presentation/GameDetailPage.h"

#include "presentation/Live2DBackgroundWidget.h"

#include <QResizeEvent>

namespace pandd {

/** @brief 合成背景の上へゲーム詳細操作を重ねる */
GameDetailPage::GameDetailPage(QWidget* parent)
    : QWidget(parent), background_(new Live2DBackgroundWidget(this)), content_(new QWidget(this)) {
    // 背景を操作領域より下へ固定してmouse入力を通常部品へ渡す
    background_->lower();
    content_->setAutoFillBackground(false);
    connect(background_, &Live2DBackgroundWidget::backgroundError, this,
            &GameDetailPage::backgroundError);
}

/** @brief 通常のQt操作部品を配置する領域を返す */
QWidget* GameDetailPage::contentWidget() const {
    // 背景より前面にある操作領域を返す
    return content_;
}

/** @brief 選択ゲームのヒーロー画像を設定する */
void GameDetailPage::setHero(const QPixmap& hero) {
    // 背景widgetへ画像を渡す
    background_->setHero(hero);
}

/** @brief 選択ゲームのヒーロー画像を解除する */
void GameDetailPage::clearHero() {
    // 背景widgetへ空画像を渡す
    background_->clearHero();
}

/** @brief ヒーロー画像の切り抜き焦点を設定する */
void GameDetailPage::setFocalPoint(double x, double y) {
    // 背景widgetへ焦点を渡す
    background_->setFocalPoint(x, y);
}

/** @brief 登録済みモデルまたはモデルなしを選択する */
void GameDetailPage::setModel(std::optional<Live2DAsset> asset) {
    // 背景widgetへモデル選択を渡す
    background_->setModel(std::move(asset));
}

/** @brief ゲーム実行中の背景更新を停止する */
void GameDetailPage::setGameRunning(bool running) {
    // 背景widgetへゲーム実行状態を渡す
    background_->setGameRunning(running);
}

/** @brief 背景と操作領域をページ全体へ追従させる */
void GameDetailPage::resizeEvent(QResizeEvent* event) {
    QWidget::resizeEvent(event);
    // 合成背景と透明操作領域を常にページ全体へ広げる
    background_->setGeometry(rect());
    content_->setGeometry(rect());
}
} // namespace pandd
