#include "presentation/GameDetailPage.h"

#include "presentation/Live2DBackgroundWidget.h"

#include <QResizeEvent>

namespace pandd {
GameDetailPage::GameDetailPage(QWidget* parent)
    : QWidget(parent), background_(new Live2DBackgroundWidget(this)), content_(new QWidget(this)) {
    // 背景を操作領域より下へ固定してmouse入力を通常部品へ渡す
    background_->lower();
    content_->setAutoFillBackground(false);
    connect(background_, &Live2DBackgroundWidget::backgroundError, this,
            &GameDetailPage::backgroundError);
}

QWidget* GameDetailPage::contentWidget() const { return content_; }
void GameDetailPage::setHero(const QPixmap& hero) { background_->setHero(hero); }
void GameDetailPage::clearHero() { background_->clearHero(); }
void GameDetailPage::setFocalPoint(double x, double y) { background_->setFocalPoint(x, y); }
void GameDetailPage::setModel(std::optional<Live2DAsset> asset) {
    background_->setModel(std::move(asset));
}
void GameDetailPage::setGameRunning(bool running) { background_->setGameRunning(running); }

void GameDetailPage::resizeEvent(QResizeEvent* event) {
    QWidget::resizeEvent(event);
    // 合成背景と透明操作領域を常にページ全体へ広げる
    background_->setGeometry(rect());
    content_->setGeometry(rect());
}
} // namespace pandd
