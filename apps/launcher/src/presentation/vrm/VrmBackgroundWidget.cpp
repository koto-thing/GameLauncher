#include "presentation/vrm/VrmBackgroundWidget.h"

#include <QApplication>
#include <QHideEvent>
#include <QJsonDocument>
#include <QJsonObject>
#include <QPointer>
#include <QResizeEvent>
#include <QShowEvent>
#include <QWebEnginePage>
#include <QWebEngineProfile>
#include <QWebEngineSettings>
#include <QWebEngineUrlRequestInfo>
#include <QWebEngineUrlRequestInterceptor>
#include <QWebEngineView>

namespace pandd {
namespace {
/** @brief 同梱ビューア以外へのアクセスを遮断する */
class BundledRequests final : public QWebEngineUrlRequestInterceptor {
  public:
    /** @brief プロファイルに所有されるフィルタを構築する */
    explicit BundledRequests(QObject* parent) : QWebEngineUrlRequestInterceptor(parent) {}

    /** @brief VRMリソースと埋込画像だけを許可する */
    void interceptRequest(QWebEngineUrlRequestInfo& info) override {
        const auto url = info.requestUrl();
        info.block(!((url.scheme() == "qrc" &&
                      (url.path().startsWith("/vrm/") || url.path().startsWith("/vrm-viewer/"))) ||
                     url.scheme() == "blob" || url.scheme() == "data"));
    }
};
} // namespace

/** @brief 操作を透過する背景ビューを構築する */
VrmBackgroundWidget::VrmBackgroundWidget(QWidget* parent) : QWidget(parent) {
    setAttribute(Qt::WA_TransparentForMouseEvents);
    setFocusPolicy(Qt::NoFocus);
    qApp->installEventFilter(this);
    poll_.setInterval(250);

    // 読込中だけ状態を確認し失敗を通常UIへ通知する
    connect(&poll_, &QTimer::timeout, this, [this] {
        const auto id = requestId_;
        view_->page()->runJavaScript(
            QStringLiteral("window.vrmStatus"),
            [guard = QPointer<VrmBackgroundWidget>(this), id](const QVariant& result) {
                if (!guard || guard->requestId_ != id || !guard->poll_.isActive())
                    return;
                const auto status = result.toMap();
                const auto state = status.value("state").toString();
                if (state == "ready") {
                    guard->poll_.stop();
                    emit guard->modelReady();
                } else if (state == "error" || ++guard->polls_ >= 120) {
                    guard->poll_.stop();
                    emit guard->backgroundError(state == "error"
                                                    ? status.value("message").toString()
                                                    : QStringLiteral("VRM loading timed out"));
                }
            });
    });
}

/** @brief メンバー破棄前に非同期通知と描画資源を解放する */
VrmBackgroundWidget::~VrmBackgroundWidget() {
    ++requestId_;
    poll_.stop();
    delete view_;
}

/** @brief 選択したモデルに必要な描画環境だけを起動する */
void VrmBackgroundWidget::setModel(std::optional<VrmAsset> asset) {
    if (asset_ == asset)
        return;
    asset_ = std::move(asset);
    ++requestId_;
    poll_.stop();
    if (!asset_) {
        // ページ破棄で進行中の読込とGPU資源も解放する
        delete view_;
        view_ = nullptr;
        pageReady_ = false;
        hide();
        return;
    }

    if (!view_) {
        view_ = new QWebEngineView(this);
        auto* profile = new QWebEngineProfile(view_);
        profile->setUrlRequestInterceptor(new BundledRequests(profile));
        view_->setPage(new QWebEnginePage(profile, view_));
        profile->setParent(view_->page());
        view_->page()->setBackgroundColor(Qt::transparent);
        view_->settings()->setAttribute(QWebEngineSettings::LocalContentCanAccessRemoteUrls, false);
        view_->settings()->setAttribute(QWebEngineSettings::LocalContentCanAccessFileUrls, false);
        view_->setContextMenuPolicy(Qt::NoContextMenu);
        view_->setFocusPolicy(Qt::NoFocus);
        view_->setGeometry(rect());
        connect(view_, &QWebEngineView::loadFinished, this, [this](bool ok) {
            pageReady_ = ok;
            if (ok)
                loadModel();
            else
                emit backgroundError(QStringLiteral("Cannot load the bundled VRM viewer"));
        });
        connect(view_->page(), &QWebEnginePage::renderProcessTerminated, this,
                [this](QWebEnginePage::RenderProcessTerminationStatus, int) {
                    poll_.stop();
                    pageReady_ = false;
                    emit backgroundError(QStringLiteral("VRM renderer stopped unexpectedly"));
                });
        view_->load(QUrl(QStringLiteral("qrc:/vrm-viewer/index.html")));
        view_->show();
    } else if (pageReady_) {
        loadModel();
    }
    show();
}

/** @brief JSONとして安全にモデルURLと配置を渡す */
void VrmBackgroundWidget::loadModel() {
    if (!asset_ || !pageReady_)
        return;
    QUrl url;
    url.setScheme(QStringLiteral("qrc"));
    url.setPath(asset_->modelPath.mid(1));
    const QJsonObject object{{"url", url.toString()},
                             {"centerX", asset_->centerX},
                             {"centerY", asset_->centerY},
                             {"scale", asset_->scale}};
    const auto json = QString::fromUtf8(QJsonDocument(object).toJson(QJsonDocument::Compact));
    view_->page()->runJavaScript(QStringLiteral("window.vrmViewer?.selectModel(%1)").arg(json));
    polls_ = 0;
    poll_.start();
    refreshAnimation();
}

/** @brief ゲームの実行状態を反映する */
void VrmBackgroundWidget::setGameRunning(bool running) {
    gameRunning_ = running;
    refreshAnimation();
}

/** @brief 可視状態のときだけアニメーションを動かす */
void VrmBackgroundWidget::refreshAnimation() {
    if (!view_ || !pageReady_)
        return;
    const bool run =
        isVisible() && window()->isVisible() && !window()->isMinimized() && !gameRunning_;
    view_->page()->runJavaScript(run ? QStringLiteral("window.vrmViewer?.setRunning(true)")
                                     : QStringLiteral("window.vrmViewer?.setRunning(false)"));
}

/** @brief ヒーロー画像を置換して再描画する */
void VrmBackgroundWidget::setHero(const QPixmap& hero) {
    artwork_.setHero(hero);
    update();
}

/** @brief 切り抜き焦点を変更して再描画する */
void VrmBackgroundWidget::setFocalPoint(double x, double y) {
    artwork_.setFocalPoint(x, y);
    update();
}

/** @brief 静止背景にはラスタ描画を使い別のOpenGLWidgetとの同時合成を避ける */
void VrmBackgroundWidget::paintEvent(QPaintEvent*) {
    QPainter painter(this);
    artwork_.paintHero(painter, rect());
    BackgroundArtwork::paintShade(painter, rect());
}

/** @brief ビューの大きさを同期する */
void VrmBackgroundWidget::resizeEvent(QResizeEvent* event) {
    QWidget::resizeEvent(event);
    if (view_)
        view_->setGeometry(rect());
}

/** @brief 表示時のアニメーション状態を同期する */
void VrmBackgroundWidget::showEvent(QShowEvent* event) {
    QWidget::showEvent(event);
    refreshAnimation();
}

/** @brief 非表示時のアニメーションを停止する */
void VrmBackgroundWidget::hideEvent(QHideEvent* event) {
    QWidget::hideEvent(event);
    refreshAnimation();
}

/** @brief ウィンドウの可視状態変更を反映する */
bool VrmBackgroundWidget::eventFilter(QObject* watched, QEvent* event) {
    if (watched == window() && (event->type() == QEvent::WindowStateChange ||
                                event->type() == QEvent::Show || event->type() == QEvent::Hide)) {
        refreshAnimation();
    }
    return QWidget::eventFilter(watched, event);
}
} // namespace pandd
