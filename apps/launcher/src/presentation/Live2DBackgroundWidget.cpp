#include "presentation/Live2DBackgroundWidget.h"

#include "presentation/live2d/Live2DModel.h"

#include <QApplication>
#include <QFutureWatcher>
#include <QHideEvent>
#include <QOpenGLContext>
#include <QOpenGLFunctions>
#include <QPainter>
#include <QShowEvent>
#include <QSurfaceFormat>
#include <QtConcurrent>

#include <algorithm>

namespace pandd {
Live2DBackgroundWidget::Live2DBackgroundWidget(QWidget* parent) : QOpenGLWidget(parent) {
    // Cubismが対応するOpenGL互換profileとdepthおよびstencil bufferを要求する
    QSurfaceFormat format;
    format.setRenderableType(QSurfaceFormat::OpenGL);
    format.setVersion(2, 1);
    format.setProfile(QSurfaceFormat::NoProfile);
    format.setDepthBufferSize(24);
    format.setStencilBufferSize(8);
    setFormat(format);
    setFocusPolicy(Qt::NoFocus);
    setAttribute(Qt::WA_TransparentForMouseEvents);
    // 背景を操作対象から外しanimation更新を約30fpsへ制限する
    timer_.setInterval(34);
    timer_.setTimerType(Qt::PreciseTimer);
    connect(&timer_, &QTimer::timeout, this, qOverload<>(&Live2DBackgroundWidget::update));
    qApp->installEventFilter(this);
}

Live2DBackgroundWidget::~Live2DBackgroundWidget() {
    // 実行中workerへ取消を通知してcontext破棄callbackを解除する
    if (canceled_) {
        canceled_->store(true);
    }
    if (context()) {
        disconnect(context(), nullptr, this, nullptr);
    }
    releaseGraphics();
}

void Live2DBackgroundWidget::setHero(const QPixmap& hero) {
    hero_ = hero;
    scaledHero_ = {};
    scaledSize_ = {};
    update();
}

void Live2DBackgroundWidget::clearHero() { setHero({}); }

void Live2DBackgroundWidget::setFocalPoint(double x, double y) {
    focalX_ = std::clamp(x, 0.0, 1.0);
    focalY_ = std::clamp(y, 0.0, 1.0);
    update();
}

void Live2DBackgroundWidget::setModel(std::optional<Live2DAsset> asset) {
    if (asset_ == asset) {
        return;
    }
    // 前の選択に属する非同期処理とanimationを無効化する
    timer_.stop();
    clock_.invalidate();
    if (canceled_) {
        canceled_->store(true);
    }
    ++requestId_;
    prepared_.reset();
    loading_ = false;
    // GPU資源をcurrent context上で解放する
    if (model_) {
        makeCurrent();
        model_.reset();
        doneCurrent();
    }
    asset_ = std::move(asset);
    startModelLoad();
    update();
}

void Live2DBackgroundWidget::setGameRunning(bool running) {
    gameRunning_ = running;
    refreshAnimation();
}

bool Live2DBackgroundWidget::animationRunning() const { return timer_.isActive(); }
bool Live2DBackgroundWidget::modelLoaded() const { return model_ != nullptr; }

void Live2DBackgroundWidget::initializeGL() {
    graphicsReady_ = true;
    connect(context(), &QOpenGLContext::aboutToBeDestroyed, this,
            &Live2DBackgroundWidget::releaseGraphics, Qt::DirectConnection);
    startModelLoad();
}

void Live2DBackgroundWidget::releaseGraphics() {
    timer_.stop();
    clock_.invalidate();
    if (model_) {
        makeCurrent();
        model_.reset();
        doneCurrent();
    }
    graphicsReady_ = false;
}

// QObject parent ownership and the finished callback jointly manage each watcher lifetime.
// NOLINTBEGIN(clang-analyzer-cplusplus.NewDeleteLeaks)
void Live2DBackgroundWidget::startModelLoad() {
    if (!asset_ || prepared_ || loading_ || model_) {
        return;
    }
    // CPU専用の素材検証と復号だけをworkerへ移す
    loading_ = true;
    canceled_ = std::make_shared<std::atomic_bool>(false);
    auto* watcher = new QFutureWatcher<Live2DModelData>(this);
    const auto id = requestId_;
    connect(watcher, &QFutureWatcher<Live2DModelData>::finished, this, [this, watcher, id] {
        watcher->deleteLater();
        if (id != requestId_) {
            return;
        }
        loading_ = false;
        // 現在の選択に対応する結果だけを採用する
        auto modelData = watcher->result();
        if (!modelData.error.isEmpty()) {
            qWarning().noquote() << "Live2D background:" << modelData.error;
            emit backgroundError(modelData.error);
            return;
        }
        prepared_ = std::move(modelData);
        update();
    });
    watcher->setFuture(QtConcurrent::run(
        [asset = *asset_, canceled = canceled_] { return prepareLive2DModel(asset, *canceled); }));
}
// NOLINTEND(clang-analyzer-cplusplus.NewDeleteLeaks)

void Live2DBackgroundWidget::loadPendingModel() {
    if (!prepared_ || !asset_) {
        return;
    }
    auto modelData = std::move(*prepared_);
    prepared_.reset();
    // paintGL内のcurrent contextでGPU資源を構築する
    auto model = std::make_unique<Live2DModel>();
    QString error;
    const auto id = requestId_;
    if (!model->load(modelData, error)) {
        qWarning().noquote() << "Live2D background:" << error;
        // paintGL内の再入描画やdialog生成を避けて通知をqueueへ送る
        QMetaObject::invokeMethod(
            this,
            [this, error, id] {
                if (id == requestId_) {
                    emit backgroundError(error);
                }
            },
            Qt::QueuedConnection);
        return;
    }
    model_ = std::move(model);
    refreshAnimation();
    QMetaObject::invokeMethod(
        this,
        [this, id] {
            if (id == requestId_ && model_) {
                emit modelReady();
            }
        },
        Qt::QueuedConnection);
}

void Live2DBackgroundWidget::paintGL() {
    // CPU側で準備済みの選択モデルを描画開始前にGPUへ転送する
    loadPendingModel();
    QPainter painter(this);
    painter.fillRect(rect(), QColor(20, 22, 27));
    // 焦点を保ったcover形式でヒーロー画像を描画する
    if (!hero_.isNull()) {
        if (scaledSize_ != size()) {
            scaledHero_ =
                hero_.scaled(size(), Qt::KeepAspectRatioByExpanding, Qt::SmoothTransformation);
            scaledSize_ = size();
        }
        const QPoint origin(-static_cast<int>((scaledHero_.width() - width()) * focalX_),
                            -static_cast<int>((scaledHero_.height() - height()) * focalY_));
        painter.drawPixmap(origin, scaledHero_);
    }
    // QPainterからnative OpenGL描画へ切り替えてCubismモデルを合成する
    if (model_ && asset_) {
        painter.beginNativePainting();
        auto* functions = context()->functions();
        functions->glBindFramebuffer(GL_FRAMEBUFFER, defaultFramebufferObject());
        const auto pixelWidth = qRound(width() * devicePixelRatioF());
        const auto pixelHeight = qRound(height() * devicePixelRatioF());
        functions->glViewport(0, 0, pixelWidth, pixelHeight);
        if (timer_.isActive()) {
            const float seconds =
                clock_.isValid() ? std::min(static_cast<float>(clock_.restart()) / 1000.F, 0.1F)
                                 : 0.F;
            if (!clock_.isValid()) {
                clock_.start();
            }
            model_->update(seconds);
        }
        model_->draw(pixelWidth, pixelHeight, asset_->centerX, asset_->centerY, asset_->scale);
        functions->glBindFramebuffer(GL_FRAMEBUFFER, defaultFramebufferObject());
        functions->glViewport(0, 0, pixelWidth, pixelHeight);
        painter.endNativePainting();
    }
    // 前景操作の可読性を保つため下端へ向けて陰影を強める
    QLinearGradient gradient(0, 0, 0, height());
    gradient.setColorAt(0.0, QColor(8, 12, 18, 80));
    gradient.setColorAt(0.55, QColor(8, 12, 18, 130));
    gradient.setColorAt(1.0, QColor(8, 12, 18, 245));
    painter.fillRect(rect(), gradient);
}

void Live2DBackgroundWidget::refreshAnimation() {
    const bool run = graphicsReady_ && model_ && isVisible() && window()->isVisible() &&
                     !window()->isMinimized() && !gameRunning_;
    if (run == timer_.isActive()) {
        return;
    }
    clock_.invalidate();
    if (run) {
        timer_.start();
        update();
    } else {
        timer_.stop();
    }
}

void Live2DBackgroundWidget::showEvent(QShowEvent* event) {
    QOpenGLWidget::showEvent(event);
    refreshAnimation();
    QTimer::singleShot(0, this, [this] {
        if (isVisible() && !isValid()) {
            emit backgroundError(tr("背景のOpenGL描画を初期化できませんでした"));
        }
    });
}

void Live2DBackgroundWidget::hideEvent(QHideEvent* event) {
    QOpenGLWidget::hideEvent(event);
    timer_.stop();
    clock_.invalidate();
}

bool Live2DBackgroundWidget::eventFilter(QObject* watched, QEvent* event) {
    if (watched == window() && (event->type() == QEvent::WindowStateChange ||
                                event->type() == QEvent::Show || event->type() == QEvent::Hide)) {
        refreshAnimation();
    }
    return QOpenGLWidget::eventFilter(watched, event);
}
} // namespace pandd
