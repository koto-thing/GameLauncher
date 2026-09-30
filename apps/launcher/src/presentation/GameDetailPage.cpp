#include "presentation/GameDetailPage.h"

#include "presentation/Live2DBackgroundWidget.h"
#include "presentation/vrm/VrmBackgroundWidget.h"

#include <QResizeEvent>

namespace pandd {

/** @brief 合成背景の上へゲーム詳細操作を重ねる */
GameDetailPage::GameDetailPage(QWidget* parent)
    : QWidget(parent), background_(new Live2DBackgroundWidget(this)),
      vrmBackground_(new VrmBackgroundWidget(this)), content_(new QWidget(this)) {
    // 背景を操作領域より下へ固定してmouse入力を通常部品へ渡す
    background_->lower();
    vrmBackground_->hide();
    content_->setAutoFillBackground(false);
    connect(background_, &Live2DBackgroundWidget::backgroundError, this,
            &GameDetailPage::backgroundError);
    connect(vrmBackground_, &VrmBackgroundWidget::backgroundError, this,
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
    vrmBackground_->setHero(hero);
}

/** @brief 選択ゲームのヒーロー画像を解除する */
void GameDetailPage::clearHero() {
    // 背景widgetへ空画像を渡す
    background_->clearHero();
    vrmBackground_->setHero({});
}

/** @brief ヒーロー画像の切り抜き焦点を設定する */
void GameDetailPage::setFocalPoint(double x, double y) {
    // 背景widgetへ焦点を渡す
    background_->setFocalPoint(x, y);
    vrmBackground_->setFocalPoint(x, y);
}

/** @brief 登録済みモデルまたはモデルなしを選択する */
void GameDetailPage::setModel(std::optional<Live2DAsset> live2d, std::optional<VrmAsset> vrm) {
    // 重複登録は設定ミスとして扱いモデルを表示しない
    if (live2d && vrm) {
        background_->setModel(std::nullopt);
        vrmBackground_->setModel(std::nullopt);
        background_->show();
        emit backgroundError(tr("同じゲームにLive2DとVRMの両方が登録されています"));
        return;
    }

    background_->setVisible(!vrm.has_value());
    background_->setModel(std::move(live2d));
    vrmBackground_->setModel(std::move(vrm));
    content_->raise();
}

/** @brief ゲーム実行中の背景更新を停止する */
void GameDetailPage::setGameRunning(bool running) {
    // 背景widgetへゲーム実行状態を渡す
    background_->setGameRunning(running);
    vrmBackground_->setGameRunning(running);
}

/** @brief 背景と操作領域をページ全体へ追従させる */
void GameDetailPage::resizeEvent(QResizeEvent* event) {
    QWidget::resizeEvent(event);
    // 合成背景と透明操作領域を常にページ全体へ広げる
    background_->setGeometry(rect());
    vrmBackground_->setGeometry(rect());
    content_->setGeometry(rect());
}
} // namespace pandd
