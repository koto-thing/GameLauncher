#pragma once

#include <QPainter>
#include <QPixmap>

#include <algorithm>

namespace pandd {
/** @brief モデル描画方式に依存しないヒーロー画像と陰影を保持する */
class BackgroundArtwork final {
  public:
    /** @brief 画像を置換して拡大縮小キャッシュを無効化する */
    void setHero(const QPixmap& hero) {
        hero_ = hero;
        scaledHero_ = {};
        scaledSize_ = {};
    }

    /** @brief 正規化した切り抜き焦点を保持する */
    void setFocalPoint(double x, double y) {
        focalX_ = std::clamp(x, 0.0, 1.0);
        focalY_ = std::clamp(y, 0.0, 1.0);
    }

    /** @brief cover形式で背景色と画像を描画する */
    void paintHero(QPainter& painter, const QRect& rect) {
        painter.fillRect(rect, QColor(20, 22, 27));
        if (hero_.isNull())
            return;

        // 大きさが変わったときだけ滑らかに拡大縮小する
        if (scaledSize_ != rect.size()) {
            scaledHero_ =
                hero_.scaled(rect.size(), Qt::KeepAspectRatioByExpanding, Qt::SmoothTransformation);
            scaledSize_ = rect.size();
        }
        const QPoint origin(-static_cast<int>((scaledHero_.width() - rect.width()) * focalX_),
                            -static_cast<int>((scaledHero_.height() - rect.height()) * focalY_));
        painter.drawPixmap(rect.topLeft() + origin, scaledHero_);
    }

    /** @brief 前景操作の可読性を保つ陰影を描画する */
    static void paintShade(QPainter& painter, const QRect& rect) {
        QLinearGradient gradient(0, 0, 0, rect.height());
        gradient.setColorAt(0.0, QColor(8, 12, 18, 80));
        gradient.setColorAt(0.55, QColor(8, 12, 18, 130));
        gradient.setColorAt(1.0, QColor(8, 12, 18, 245));
        painter.fillRect(rect, gradient);
    }

  private:
    QPixmap hero_;
    QPixmap scaledHero_;
    QSize scaledSize_;
    double focalX_{0.5};
    double focalY_{0.5};
};
} // namespace pandd
