#include "presentation/LauncherWindow.h"
#include "presentation/GameDetailPage.h"

#include "infrastructure/FileLogger.h"
#include "presentation/LocalizationManager.h"

#include "infrastructure/EditionProfile.h"
#include <QAbstractButton>
#include <QAction>
#include <QApplication>
#include <QBitmap>
#include <QBuffer>
#include <QCheckBox>
#include <QClipboard>
#include <QCloseEvent>
#include <QComboBox>
#include <QDateTime>
#include <QDesktopServices>
#include <QDialog>
#include <QDialogButtonBox>
#include <QDir>
#include <QEasingCurve>
#include <QFile>
#include <QFileDialog>
#include <QFontMetrics>
#include <QFormLayout>
#include <QFrame>
#include <QFutureWatcher>
#include <QHBoxLayout>
#include <QIcon>
#include <QImageReader>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QMenu>
#include <QMessageBox>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QPaintEvent>
#include <QPainter>
#include <QPainterPath>
#include <QProgressBar>
#include <QPropertyAnimation>
#include <QPushButton>
#include <QRandomGenerator>
#include <QRegion>
#include <QResizeEvent>
#include <QSpinBox>
#include <QStackedWidget>
#include <QStandardPaths>
#include <QStatusBar>
#include <QStyledItemDelegate>
#include <QSysInfo>
#include <QSystemTrayIcon>
#include <QTabWidget>
#include <QTextBrowser>
#include <QTextLayout>
#include <QTextOption>
#include <QTimer>
#include <QToolButton>
#include <QVBoxLayout>
#include <QWebEngineView>
#include <QtConcurrentRun>

#include <algorithm>
#include <memory>
#include <random>

namespace pandd {
namespace {

/** @brief 完了通知を出す準備処理からの遷移かを返す */
bool completesGamePreparation(InstallState previous) {
    switch (previous) {
    case InstallState::Downloading:
    case InstallState::Verifying:
    case InstallState::Installing:
    case InstallState::Repairing:
        return true;
    default:
        return false;
    }
}

/** @brief byte列を画像として復号し寸法上限を検証する */
QImage decodeImage(const QByteArray& data, int maximumDimension) {
    QBuffer buffer;
    buffer.setData(data);
    buffer.open(QIODevice::ReadOnly);
    QImageReader reader(&buffer);
    reader.setDecideFormatFromContent(true);
    const auto dimensions = reader.size();
    if (!dimensions.isValid() || dimensions.width() > maximumDimension ||
        dimensions.height() > maximumDimension) {
        return {};
    }
    return reader.read();
}

} // namespace

/** @brief 表示幅を超えたタイトルを末尾省略するラベル */
class ElidedLabel final : public QLabel {
  public:
    using QLabel::QLabel;

    /** @brief 完全な文字列を保持し、表示幅に応じて描画文字列を更新する */
    void setFullText(const QString& text) {
        fullText_ = text;
        setToolTip(fullText_);
        updateDisplayedText();
    }

    /** @brief 省略前の完全な文字列を返す */
    [[nodiscard]] const QString& fullText() const {
        // 省略前の文字列を返す
        return fullText_;
    }

  protected:
    /** @brief resize後に表示文字列を更新する */
    void resizeEvent(QResizeEvent* event) override {
        QLabel::resizeEvent(event);
        updateDisplayedText();
    }

  private:
    /** @brief 現在のlabel幅に合わせて文字列を省略する */
    void updateDisplayedText() {
        setText(QFontMetrics(font()).elidedText(fullText_, Qt::ElideRight, width()));
    }

    QString fullText_;
};

/** @brief 割り当てられた高さに収まる行数まで表示し、最終行を末尾省略する複数行ラベル */
class ClampedTextLabel final : public QLabel {
  public:
    /**
     * @brief 内容の長さで周囲のlayoutを押し広げない複数行ラベルを作る
     * @param parent 親widget
     */
    explicit ClampedTextLabel(QWidget* parent = nullptr) : QLabel(parent) {
        // 行分割は自前で行い、大きさはlayoutの割り当てに従う
        setWordWrap(false);
        setAlignment(Qt::AlignLeft | Qt::AlignTop);
        setSizePolicy(QSizePolicy::Ignored, QSizePolicy::Ignored);
    }

    /**
     * @brief 完全な文字列を保持し、表示領域に応じて描画文字列を更新する
     * @param text 表示する完全な文字列
     */
    void setFullText(const QString& text) {
        fullText_ = text;
        setToolTip(fullText_);
        updateDisplayedText();
    }

  protected:
    /**
     * @brief resize後に表示文字列を更新する
     * @param event resize event
     */
    void resizeEvent(QResizeEvent* event) override {
        QLabel::resizeEvent(event);
        updateDisplayedText();
    }

    /**
     * @brief stylesheetによるfont変更後に表示文字列を更新する
     * @param event 変更event
     */
    void changeEvent(QEvent* event) override {
        QLabel::changeEvent(event);
        if (event->type() == QEvent::FontChange) {
            updateDisplayedText();
        }
    }

  private:
    /** @brief 現在の幅で折り返し、高さに収まらない行を最終行の省略記号へまとめる */
    void updateDisplayedText() {
        // 改行を保ったまま現在の幅で行へ分割する
        auto text = fullText_;
        text.replace(QLatin1Char('\n'), QChar::LineSeparator);
        QTextLayout layout(text, font());
        QTextOption option;
        option.setWrapMode(QTextOption::WrapAtWordBoundaryOrAnywhere);
        layout.setTextOption(option);
        QList<QTextLine> lines;
        layout.beginLayout();
        for (auto line = layout.createLine(); line.isValid(); line = layout.createLine()) {
            line.setLineWidth(width());
            lines.append(line);
        }
        layout.endLayout();

        // 収まる行数を超える分は最終行へまとめて末尾を省略する
        const QFontMetrics metrics(font());
        const auto maximumLines =
            std::max<qsizetype>(1, height() / std::max(1, metrics.lineSpacing()));
        QStringList visible;
        for (qsizetype index = 0; index < lines.size() && index < maximumLines; ++index) {
            const auto& line = lines.at(index);
            const auto isLastVisible = index == maximumLines - 1 && lines.size() > maximumLines;
            auto lineText = isLastVisible ? text.mid(line.textStart())
                                          : text.mid(line.textStart(), line.textLength());
            lineText.replace(QChar::LineSeparator, QLatin1Char(' '));
            visible.append(isLastVisible
                               ? metrics.elidedText(lineText.trimmed(), Qt::ElideRight, width())
                               : lineText.trimmed());
        }
        setText(visible.join(QLatin1Char('\n')));
    }

    QString fullText_;
};

/** @brief 元画像の縦横比を保って表示領域内へ収めるラベル */
class AspectRatioPixmapLabel final : public QLabel {
  public:
    using QLabel::QLabel;

    /** @brief 元画像を保持して現在の表示領域へ反映する */
    void setSourcePixmap(const QPixmap& pixmap) {
        sourcePixmap_ = pixmap;
        updatePixmap();
    }

  protected:
    /** @brief resize後の表示領域へ元画像を再調整する */
    void resizeEvent(QResizeEvent* event) override {
        QLabel::resizeEvent(event);
        updatePixmap();
    }

  private:
    /** @brief 元画像を変形せず表示領域内へ最大化する */
    void updatePixmap() {
        if (sourcePixmap_.isNull() || size().isEmpty()) {
            QLabel::clear();
            return;
        }

        QLabel::setPixmap(
            sourcePixmap_.scaled(size(), Qt::KeepAspectRatio, Qt::SmoothTransformation));
    }

    QPixmap sourcePixmap_;
};

constexpr int gameThumbnailWidth = 196;
constexpr int gameThumbnailHeight = 110;
constexpr int gameCardWidth = 212;
constexpr int gameCardHeight = 146;

/**
 * @brief 既定配色またはエディション指定のアクセント色を返す
 * @return 選択状態や主要操作に使うアクセント色
 */
QColor accentColor() {
    // エディション版は配布物のアクセント色へ置き換える
    const auto& edition = EditionProfile::current();
    return QColor(edition.enabled() ? edition.accent() : QStringLiteral("#e60012"));
}

/**
 * @brief 単色SVGアイコンを指定色で塗り、通常時と選択時の状態を持つiconを作る
 * @param resourcePath currentColorで描かれたSVGのresource path
 * @param normal 通常時の色
 * @param checked 選択時の色
 * @return 2つの状態を持つicon
 */
QIcon tintedIcon(const QString& resourcePath, const QColor& normal, const QColor& checked) {
    // SVGを読み込み、currentColorを状態ごとの色へ置換して高解像度で描画する
    QFile file(resourcePath);
    if (!file.open(QIODevice::ReadOnly)) {
        return {};
    }
    const auto source = file.readAll();
    auto render = [&source](const QColor& color) {
        auto svg = source;
        svg.replace("currentColor", color.name().toLatin1());
        QBuffer buffer(&svg);
        buffer.open(QIODevice::ReadOnly);
        QImageReader reader(&buffer, "svg");
        reader.setScaledSize(QSize(48, 48));
        return QPixmap::fromImage(reader.read());
    };

    QIcon icon;
    icon.addPixmap(render(normal), QIcon::Normal, QIcon::Off);
    icon.addPixmap(render(checked), QIcon::Normal, QIcon::On);
    return icon;
}

/** @brief 16:9画像の下へタイトルを置いてゲームカードを描画する */
class GameCardDelegate final : public QStyledItemDelegate {
  public:
    using QStyledItemDelegate::QStyledItemDelegate;

    /**
     * @brief 固定寸法のゲームカードを描画する
     * @param painter 描画先
     * @param option 描画領域と選択状態
     * @param index 描画するゲーム項目
     */
    void paint(QPainter* painter, const QStyleOptionViewItem& option,
               const QModelIndex& index) const override {
        const QRect card(option.rect.left() + 8, option.rect.top() + 4, gameThumbnailWidth,
                         gameThumbnailHeight);
        const auto selected = option.state.testFlag(QStyle::State_Selected);
        const auto hovered = option.state.testFlag(QStyle::State_MouseOver);
        const auto icon = index.data(Qt::DecorationRole).value<QIcon>();

        // 角丸に切り抜いたサムネイルを描画する
        painter->save();
        painter->setRenderHint(QPainter::Antialiasing);
        QPainterPath clip;
        clip.addRoundedRect(card, 10, 10);
        painter->setClipPath(clip);
        painter->fillRect(card, option.palette.color(QPalette::Base));
        icon.paint(painter, card, Qt::AlignCenter, QIcon::Normal, QIcon::On);
        painter->setClipping(false);

        // 選択中とhover中はアクセント色の太枠で囲む
        painter->setPen(
            QPen(selected || hovered ? accentColor() : option.palette.color(QPalette::Mid),
                 selected || hovered ? 3 : 1));
        painter->setBrush(Qt::NoBrush);
        const auto inset = selected || hovered ? 1.5 : 0.5;
        painter->drawRoundedRect(QRectF(card).adjusted(inset, inset, -inset, -inset), 10, 10);

        // 画像を隠さないようタイトルはサムネイルの下へ置く
        auto font = option.font;
        font.setPixelSize(13);
        font.setWeight(QFont::Bold);
        painter->setFont(font);
        painter->setPen(option.palette.color(QPalette::Text));
        const QRect titleArea(card.left() + 2, card.bottom() + 6, card.width() - 4, 22);
        const auto title = QFontMetrics(font).elidedText(index.data().toString(), Qt::ElideRight,
                                                         titleArea.width());
        painter->drawText(titleArea, Qt::AlignLeft | Qt::AlignVCenter, title);
        painter->restore();
    }

    /** @brief 一覧layoutへ固定カード寸法を返す */
    QSize sizeHint(const QStyleOptionViewItem&, const QModelIndex&) const override {
        return {gameCardWidth, gameCardHeight};
    }
};

/** @brief 一覧用画像を中央基準で16:9に切り抜く */
QPixmap cardThumbnail(const QPixmap& source) {
    if (source.isNull()) {
        return {};
    }

    const auto scaled = source.scaled(gameThumbnailWidth, gameThumbnailHeight,
                                      Qt::KeepAspectRatioByExpanding, Qt::SmoothTransformation);
    const auto x = std::max(0, (scaled.width() - gameThumbnailWidth) / 2);
    const auto y = std::max(0, (scaled.height() - gameThumbnailHeight) / 2);
    return scaled.copy(x, y, gameThumbnailWidth, gameThumbnailHeight);
}

/** @brief 一覧を同一寸法の16:9カード表示に設定する */
void configureGameCardList(QListWidget* list) {
    list->setViewMode(QListView::IconMode);
    list->setItemDelegate(new GameCardDelegate(list));
    list->setIconSize(QSize(gameThumbnailWidth, gameThumbnailHeight));
    list->setGridSize(QSize(gameCardWidth, gameCardHeight));
    list->setItemAlignment(Qt::AlignLeft | Qt::AlignVCenter);
    list->setMovement(QListView::Static);
    list->setResizeMode(QListView::Adjust);
}

/** @brief ViewModelへ接続してランチャーwindowを構築する */
LauncherWindow::LauncherWindow(LauncherViewModel& viewModel, bool initialize, QWidget* parent)
    : QMainWindow(parent), viewModel_(viewModel) {
    buildUi();
    connectViewModel();
    if (initialize) {
        viewModel_.initialize();
    }
}

/** @brief close-to-tray設定に従ってwindowを閉じる */
void LauncherWindow::closeEvent(QCloseEvent* event) {
    if (viewModel_.settings().closeToTray && QSystemTrayIcon::isSystemTrayAvailable()) {
        hide();
        event->ignore();
        return;
    }
    QMainWindow::closeEvent(event);
}

/** @brief sidebarと各pageとsystem trayを構築する */
void LauncherWindow::buildUi() {
    // windowの基本サイズとthemeを設定する
    setWindowTitle(tr("PandD Game Launcher"));
    const auto& edition = EditionProfile::current();
    const auto logoPath =
        edition.enabled() ? edition.asset("logo.png") : QStringLiteral(":/images/PandDLogo.png");
    const QIcon logoIcon(logoPath);
    setWindowIcon(logoIcon);
    setMinimumSize(960, 600);
    resize(1280, 720);

    auto* central = new QWidget(this);
    auto* layout = new QHBoxLayout(central);
    layout->setContentsMargins(0, 0, 0, 0);
    layout->setSpacing(0);

    // 主要ナビゲーションとゲーム一覧への導線を持つ固定サイドバー
    auto* sidebar = new QFrame(central);
    sidebar->setObjectName("sidebar");
    sidebar->setFixedWidth(190);
    auto* sidebarLayout = new QVBoxLayout(sidebar);
    sidebarLayout->setContentsMargins(12, 8, 12, 16);
    sidebarLayout->setSpacing(4);
    auto* brand = new QLabel(sidebar);
    const QPixmap sourceLogo(logoPath);
    const auto visibleLogoBounds = QRegion(sourceLogo.mask()).boundingRect();
    const auto visibleLogo =
        visibleLogoBounds.isValid() ? sourceLogo.copy(visibleLogoBounds) : sourceLogo;
    brand->setPixmap(visibleLogo.scaled(166, 68, Qt::KeepAspectRatio, Qt::SmoothTransformation));
    brand->setFixedHeight(84);
    brand->setAlignment(Qt::AlignCenter);
    sidebarLayout->addWidget(brand);

    // 各ナビゲーション項目へ線画アイコンを付ける
    auto createNavButton = [this, sidebar](const QString& text, const QString& icon) {
        auto* button = new QPushButton(text, sidebar);
        button->setObjectName("nav");
        button->setCheckable(true);
        button->setIconSize(QSize(20, 20));
        themedIconButtons_.emplace_back(button, icon);
        return button;
    };
    homeButton_ = createNavButton(tr("トップ"), QStringLiteral(":/icons/home.svg"));
    discoverButton_ = createNavButton(tr("さがす"), QStringLiteral(":/icons/search.svg"));
    sidebarLayout->addWidget(homeButton_);
    sidebarLayout->addWidget(discoverButton_);
    sidebarLayout->addStretch(1);
    auto* divider = new QFrame(sidebar);
    divider->setObjectName("divider");
    divider->setFixedHeight(1);
    sidebarLayout->addWidget(divider);
    sidebarLayout->addSpacing(4);
    libraryButton_ = createNavButton(tr("ゲーム一覧"), QStringLiteral(":/icons/library.svg"));
    libraryButton_->setAccessibleName(tr("所持ゲーム一覧を開く"));
    sidebarLayout->addWidget(libraryButton_);
    auto* version = new QLabel(
        QStringLiteral("LAUNCHER v%1").arg(QCoreApplication::applicationVersion()), sidebar);
    version->setObjectName("version");
    sidebarLayout->addWidget(version);
    navigationIndicator_ = new QFrame(sidebar);
    navigationIndicator_->setObjectName("navigationIndicator");
    navigationIndicator_->setAttribute(Qt::WA_TransparentForMouseEvents);
    navigationIndicator_->hide();
    navigationIndicatorAnimation_ = new QPropertyAnimation(navigationIndicator_, "geometry", this);
    navigationIndicatorAnimation_->setDuration(180);
    navigationIndicatorAnimation_->setEasingCurve(QEasingCurve::OutCubic);
    layout->addWidget(sidebar);

    pages_ = new QStackedWidget(central);
    pages_->addWidget(createHomePage());
    pages_->addWidget(createDiscoverPage());
    pages_->addWidget(createLibraryPage());
    pages_->addWidget(createDetailPage());
    layout->addWidget(pages_, 1);
    setCentralWidget(central);

    // 通知領域から必ず復帰または終了できる導線を提供
    trayIcon_ = new QSystemTrayIcon(logoIcon, this);
    imageNetwork_ = new QNetworkAccessManager(this);
    auto* trayMenu = new QMenu(this);
    trayMenu->addAction(tr("ランチャーを表示"), this, [this] {
        showNormal();
        raise();
        activateWindow();
    });
    trayMenu->addAction(tr("終了"), qApp, &QApplication::quit);
    trayIcon_->setContextMenu(trayMenu);
    trayIcon_->setToolTip(tr("PandD Game Launcher"));
    connect(trayIcon_, &QSystemTrayIcon::activated, this,
            [this](QSystemTrayIcon::ActivationReason reason) {
                if (reason == QSystemTrayIcon::Trigger || reason == QSystemTrayIcon::DoubleClick) {
                    showNormal();
                    raise();
                    activateWindow();
                }
            });
    if (QSystemTrayIcon::isSystemTrayAvailable()) {
        trayIcon_->show();
    }

    // 全pageの部品が揃ってからthemeとアイコン色を適用する
    applyTheme();
    connect(homeButton_, &QPushButton::clicked, this, [this] { navigateTo(0); });
    connect(discoverButton_, &QPushButton::clicked, this, [this] { navigateTo(1); });
    connect(libraryButton_, &QPushButton::clicked, this, [this] {
        navigateTo(2);
        libraryList_->scrollToTop();
        libraryList_->setCurrentItem(nullptr);
    });
    navigateTo(0);
    if (edition.enabled()) {
        setWindowTitle(edition.name());
    }
    QTimer::singleShot(0, this, [this] { updateNavigationIndicator(false); });
}

/** @brief 現在の設定に応じたwidget themeを適用する */
void LauncherWindow::applyTheme() {
    // theme paletteを一度に組み立てる
    // darkはロゴの文字色 #3a3a3a を軸にした青みのないチャコール系で、
    // hoverと選択中はロゴの「a」のピンク #ff6777 を8%・15%重ねた色にする
    const auto dark = viewModel_.settings().darkTheme;
    const auto background = dark ? "#2b2b2b" : "#f5f5f5";
    const auto surface = dark ? "#353535" : "#ffffff";
    const auto text = dark ? "#f5f5f5" : "#242424";
    const auto muted = dark ? "#b0b0b0" : "#676767";
    const auto border = dark ? "#474747" : "#d7d7d7";
    const auto hover = dark ? "#45393a" : "#fff7f8";
    const auto selected = dark ? "#533c3f" : "#fff4f5";
    setStyleSheet(
        QString("QMainWindow,QWidget#page,QDialog{background:%1;color:%3;}"
                "QFrame#sidebar{background:%2;border-right:1px solid %5;}"
                "QLabel,QCheckBox,QRadioButton,QGroupBox,QTabWidget{color:%3;}"
                // 汎用ボタンと入力欄は角丸10pxでそろえる
                "QPushButton{background:%2;color:%3;border:1px solid %5;border-radius:10px;"
                "padding:10px 18px;font-size:14px;font-weight:700;}"
                "QPushButton:hover{border:1px solid #e60012;background:%6;}"
                "QPushButton#account,QPushButton#account:hover{background:transparent;border:0;"
                "padding:0;}"
                "QPushButton#settings{padding:0;border-radius:20px;}"
                "QPushButton#nav{border:0;border-radius:10px;text-align:left;padding:0 14px;"
                "min-height:44px;color:%4;font-size:15px;font-weight:500;}"
                "QPushButton#nav:hover{background:%6;color:%3;}"
                "QPushButton#nav:checked{background:%7;color:%3;font-weight:700;}"
                "QFrame#navigationIndicator{background:#e60012;border-radius:2px;}"
                "QFrame#divider{background:%5;margin:0 4px;}"
                "QLabel#version{color:%4;font-family:'Saira';font-size:11px;font-weight:600;"
                "padding:6px 14px 0;}"
                "QPushButton#primary{background:#e60012;color:white;border:0;font-size:17px;"
                "font-weight:800;min-width:260px;min-height:52px;border-radius:12px;}"
                "QPushButton#primary:hover{background:#c90010;}"
                "QPushButton#primary:disabled{background:%5;color:%4;}"
                "QPushButton#accent{background:#e60012;color:white;border:0;}"
                "QPushButton#accent:hover{background:#c90010;}"
                "QPushButton#ghost{background:rgba(43,43,43,170);color:white;"
                "border:1px solid rgba(255,255,255,40);}"
                "QPushButton#ghost:hover{border-color:#e60012;}"
                "QPushButton#link{background:transparent;border:0;color:#d6d6d6;"
                "text-decoration:underline;font-weight:500;}"
                "QListWidget{background:transparent;border:0;outline:0;color:%3;}"
                "QListWidget::item{background:%2;color:%3;border:1px solid %5;"
                "border-radius:10px;padding:10px;margin:6px;}"
                "QListWidget::item:hover{border:3px solid #e60012;background:%6;}"
                "QListWidget::item:selected{border:3px solid #e60012;background:%7;}"
                "QListWidget#announcements{background:rgba(43,43,43,180);"
                "border:1px solid rgba(255,255,255,26);border-radius:10px;color:white;}"
                "QListWidget#announcements::item,QListWidget#announcements::item:hover,"
                "QListWidget#announcements::item:selected{background:transparent;border:0;"
                "margin:0;padding:6px 12px;color:white;}"
                "QLineEdit,QComboBox,QSpinBox,QTextBrowser{background:%2;color:%3;"
                "border:2px solid %5;border-radius:10px;padding:8px;}"
                "QLineEdit{border-radius:12px;padding:10px 14px;font-size:15px;}"
                "QLineEdit:focus,QComboBox:focus,QSpinBox:focus{border-color:#e60012;}"
                "QTabWidget::pane{border:1px solid %5;background:%2;}"
                "QTabBar::tab{background:%1;color:%3;padding:9px 14px;}"
                "QTabBar::tab:selected{background:#e60012;color:white;}"
                "QScrollBar:vertical{background:transparent;width:10px;margin:2px;}"
                "QScrollBar::handle:vertical{background:%5;border-radius:3px;min-height:32px;}"
                "QScrollBar::add-line,QScrollBar::sub-line{height:0;width:0;}"
                "QScrollBar::add-page,QScrollBar::sub-page{background:transparent;}"
                // 文字サイズは 44 / 28 / 24 / 17 / 15 / 13 / 12 / 11px の段階に限る
                "QLabel#eyebrow{color:#e60012;font-family:'Saira';font-size:12px;"
                "font-weight:600;}"
                "QLabel#pageTitle{font-size:28px;font-weight:800;color:%3;}"
                "QLabel#sectionTitle{font-size:17px;font-weight:700;color:%3;}"
                "QLabel#muted{color:%4;font-size:13px;}"
                "QLabel#empty{color:%4;font-size:15px;background:%2;"
                "border:1px dashed %5;border-radius:14px;padding:28px;}"
                "QLabel#heroTitle{font-size:44px;font-weight:800;color:white;}"
                "QLabel#heroSummary{font-size:15px;color:#e0e0e0;}"
                "QLabel#transfer{font-family:'Saira';font-size:13px;font-weight:500;"
                "color:#c4c4c4;}"
                "QFrame#homePreview{background:%2;border:1px solid %5;border-radius:14px;}"
                "QLabel#homePreviewImage{background:%2;border:1px solid %5;border-radius:14px;}"
                "QLabel#homePreviewTitle{font-size:24px;font-weight:800;color:%3;}"
                "QLabel#homePreviewSummary{font-size:14px;color:%4;}"
                "QProgressBar{border:0;border-radius:3px;background:rgba(255,255,255,40);"
                "max-height:6px;}"
                "QProgressBar::chunk{background:#e60012;border-radius:3px;}")
            .arg(background, surface, text, muted, border, hover, selected));

    // 単色アイコンを現在のthemeの文字色とアクセント色で塗り直す
    for (const auto& [target, path] : themedIconButtons_) {
        const auto icon = tintedIcon(path, QColor(muted), accentColor());
        if (auto* button = qobject_cast<QAbstractButton*>(target)) {
            button->setIcon(icon);
        } else if (auto* action = qobject_cast<QAction*>(target)) {
            action->setIcon(icon);
        }
    }
    const auto& edition = EditionProfile::current();
    if (edition.enabled()) {
        auto sheet = styleSheet();
        sheet.replace("#e60012", edition.accent());
        sheet.replace("#c90010", QColor(edition.accent()).darker(115).name());
        sheet += QString("QWidget#page{background-image:url(\"%1\");background-position:center;"
                         "background-repeat:no-repeat;}")
                     .arg(QDir::fromNativeSeparators(edition.asset("background.png")));
        setStyleSheet(sheet);
    }
}

/**
 * @brief アカウントと設定のボタンをheader行へ追加する
 * @param page ボタンの親page
 * @param row ボタンを追加するheader行
 */
void LauncherWindow::addHeaderActions(QWidget* page, QBoxLayout* row) {
    // アカウントは準備中のため操作を持たない領域として確保する
    auto* account = new QPushButton(page);
    account->setObjectName("account");
    account->setToolTip(tr("アカウント（準備中）"));
    account->setAccessibleName(tr("アカウント（準備中）"));
    account->setFixedSize(40, 40);
    row->addWidget(account, 0, Qt::AlignTop);

    // 設定ボタンのアイコンはthemeに合わせて塗り直す
    auto* settings = new QPushButton(page);
    settings->setObjectName("settings");
    settings->setIconSize(QSize(18, 18));
    settings->setToolTip(tr("設定"));
    settings->setAccessibleName(tr("設定を開く"));
    settings->setFixedSize(40, 40);
    themedIconButtons_.emplace_back(settings, QStringLiteral(":/icons/settings.svg"));
    row->addWidget(settings, 0, Qt::AlignTop);
    connect(settings, &QPushButton::clicked, this, &LauncherWindow::showSettingsDialog);
}

/**
 * @brief 英字ラベル、見出し、補足文、header操作を持つpage headerを作る
 * @param page headerの親page
 * @param eyebrow 見出し上に置く英字ラベル
 * @param title page見出し
 * @param hint 見出し下の補足文。空なら表示しない
 * @return pageのlayoutへ追加するheader layout
 */
QLayout* LauncherWindow::createPageHeader(QWidget* page, const QString& eyebrow,
                                          const QString& title, const QString& hint) {
    // 英字ラベルは字間を広げてアクセント書体で表示する
    auto* titles = new QVBoxLayout();
    titles->setSpacing(2);
    auto* eyebrowLabel = new QLabel(eyebrow, page);
    eyebrowLabel->setObjectName("eyebrow");
    auto eyebrowFont = eyebrowLabel->font();
    eyebrowFont.setLetterSpacing(QFont::AbsoluteSpacing, 2);
    eyebrowLabel->setFont(eyebrowFont);
    titles->addWidget(eyebrowLabel);
    auto* titleLabel = new QLabel(title, page);
    titleLabel->setObjectName("pageTitle");
    titles->addWidget(titleLabel);
    if (!hint.isEmpty()) {
        auto* hintLabel = new QLabel(hint, page);
        hintLabel->setObjectName("muted");
        titles->addSpacing(4);
        titles->addWidget(hintLabel);
    }

    // 見出しを左、header操作を右上へ配置する
    auto* row = new QHBoxLayout();
    row->setSpacing(10);
    row->addLayout(titles);
    row->addStretch();
    addHeaderActions(page, row);
    return row;
}

/** @brief おすすめゲームを表示するhome pageを構築する */
QWidget* LauncherWindow::createHomePage() {
    // page本体とheaderを構築する
    auto* page = new QWidget(this);
    page->setObjectName("page");
    auto* layout = new QVBoxLayout(page);
    layout->setContentsMargins(40, 28, 40, 28);
    layout->setSpacing(20);
    layout->addLayout(
        createPageHeader(page, QStringLiteral("RECOMMENDED"), tr("あなたへのおすすめ"),
                         tr("まだ持っていないゲームから、新しいお気に入りを見つけよう")));

    auto* previewRow = new QHBoxLayout();
    previewRow->setSpacing(20);
    homePreviewImage_ = new AspectRatioPixmapLabel(page);
    homePreviewImage_->setObjectName("homePreviewImage");
    homePreviewImage_->setAlignment(Qt::AlignCenter);
    homePreviewImage_->setMinimumSize(400, 225);
    homePreviewImage_->setAccessibleName(tr("選択中ゲームのサムネイル"));
    previewRow->addWidget(homePreviewImage_, 2);

    auto* information = new QFrame(page);
    information->setObjectName("homePreview");
    auto* informationLayout = new QVBoxLayout(information);
    informationLayout->setContentsMargins(24, 24, 24, 24);
    informationLayout->setSpacing(14);
    homePreviewTitle_ = new QLabel(information);
    homePreviewTitle_->setObjectName("homePreviewTitle");
    homePreviewTitle_->setWordWrap(true);
    homePreviewSummary_ = new ClampedTextLabel(information);
    homePreviewSummary_->setObjectName("homePreviewSummary");
    informationLayout->addWidget(homePreviewTitle_);
    informationLayout->addWidget(homePreviewSummary_, 1);

    // 選択中ゲームの詳細pageへ直接移動する導線
    auto* openDetail = new QPushButton(tr("詳細を見る"), information);
    openDetail->setObjectName("accent");
    openDetail->setAccessibleName(tr("選択中ゲームの詳細を開く"));
    informationLayout->addWidget(openDetail, 0, Qt::AlignLeft);
    connect(openDetail, &QPushButton::clicked, this, [this] {
        if (auto* current = homeList_->currentItem()) {
            showGame(current->data(Qt::UserRole).toString());
        }
    });
    previewRow->addWidget(information, 1);
    layout->addLayout(previewRow, 3);

    homeList_ = new QListWidget(page);
    configureGameCardList(homeList_);
    homeList_->setFlow(QListView::LeftToRight);
    homeList_->setWrapping(false);
    homeList_->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    homeList_->setVerticalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    homeList_->setAccessibleName(tr("おすすめゲーム"));
    homeList_->setFixedHeight(gameCardHeight);
    homeEmpty_ = new QLabel(tr("現在おすすめできる未所持ゲームはありません"), page);
    homeEmpty_->setObjectName("empty");
    homeEmpty_->setAlignment(Qt::AlignCenter);
    auto* recommendations = new QWidget(page);
    auto* recommendationsLayout = new QVBoxLayout(recommendations);
    recommendationsLayout->setContentsMargins(0, 0, 0, 0);
    recommendationsLayout->setSpacing(8);
    recommendationsLayout->addStretch();
    auto* recommendationsTitle = new QLabel(tr("ほかのおすすめ"), recommendations);
    recommendationsTitle->setObjectName("sectionTitle");
    recommendationsLayout->addWidget(recommendationsTitle);
    recommendationsLayout->addWidget(homeList_);
    recommendationsLayout->addWidget(homeEmpty_);
    recommendationsLayout->addStretch();
    layout->addWidget(recommendations, 1);
    connect(homeList_, &QListWidget::currentItemChanged, this, [this](QListWidgetItem* current) {
        if (current) {
            updateHomeSelection(current->data(Qt::UserRole).toString());
        }
    });
    connect(homeList_, &QListWidget::itemActivated, this,
            [this](QListWidgetItem* item) { showGame(item->data(Qt::UserRole).toString()); });
    return page;
}

/** @brief 未所持ゲームを検索するdiscover pageを構築する */
QWidget* LauncherWindow::createDiscoverPage() {
    // page本体と検索欄を構築する
    auto* page = new QWidget(this);
    page->setObjectName("page");
    auto* layout = new QVBoxLayout(page);
    layout->setContentsMargins(40, 28, 40, 28);
    layout->setSpacing(20);
    layout->addLayout(createPageHeader(page, QStringLiteral("DISCOVER"), tr("ゲームをさがす")));
    searchInput_ = new QLineEdit(page);
    searchInput_->setPlaceholderText(tr("ゲーム名やキーワードで検索"));
    searchInput_->setClearButtonEnabled(true);
    searchInput_->setAccessibleName(tr("未所持ゲームを検索"));
    themedIconButtons_.emplace_back(searchInput_->addAction(QIcon(), QLineEdit::LeadingPosition),
                                    QStringLiteral(":/icons/search.svg"));
    layout->addWidget(searchInput_);
    auto* section = new QLabel(tr("まだ持っていないゲーム"), page);
    section->setObjectName("sectionTitle");
    layout->addWidget(section);
    discoverList_ = new QListWidget(page);
    configureGameCardList(discoverList_);
    discoverList_->setAccessibleName(tr("未所持ゲーム一覧"));
    layout->addWidget(discoverList_, 1);
    discoverEmpty_ = new QLabel(page);
    discoverEmpty_->setObjectName("empty");
    discoverEmpty_->setAlignment(Qt::AlignCenter);
    layout->addWidget(discoverEmpty_);
    connect(searchInput_, &QLineEdit::textChanged, this, &LauncherWindow::refreshDiscover);
    connect(discoverList_, &QListWidget::itemActivated, this,
            [this](QListWidgetItem* item) { showGame(item->data(Qt::UserRole).toString()); });
    return page;
}

/** @brief 導入済みゲームを表示するlibrary pageを構築する */
QWidget* LauncherWindow::createLibraryPage() {
    // page本体と一覧を構築する
    auto* page = new QWidget(this);
    page->setObjectName("page");
    auto* layout = new QVBoxLayout(page);
    layout->setContentsMargins(40, 28, 40, 28);
    layout->setSpacing(20);
    layout->addLayout(createPageHeader(page, QStringLiteral("LIBRARY"), tr("ゲーム一覧"),
                                       tr("持っているゲームを選んでプレイ")));
    libraryList_ = new QListWidget(page);
    configureGameCardList(libraryList_);
    libraryList_->setAccessibleName(tr("所持ゲーム一覧"));
    layout->addWidget(libraryList_, 1);
    libraryEmpty_ = new QLabel(
        tr("所持しているゲームはありません\nトップや「さがす」からゲームを見つけましょう"), page);
    libraryEmpty_->setObjectName("empty");
    libraryEmpty_->setAlignment(Qt::AlignCenter);
    layout->addWidget(libraryEmpty_);
    connect(libraryList_, &QListWidget::itemActivated, this,
            [this](QListWidgetItem* item) { showGame(item->data(Qt::UserRole).toString()); });
    return page;
}

/** @brief 選択ゲームのdetail pageと背景を構築する */
QWidget* LauncherWindow::createDetailPage() {
    // 背景widgetと操作領域を構築する
    detailPage_ = new GameDetailPage(this);
    auto* page = detailPage_->contentWidget();
    connect(detailPage_, &GameDetailPage::backgroundError, this, [this](const QString& error) {
        statusBar()->showMessage(tr("モデル背景を表示できません: %1").arg(error), 15000);
    });
    QString registryError;
    if (!live2dAssets_.load(registryError)) {
        qWarning().noquote() << registryError;
        QTimer::singleShot(0, this, [this, registryError] {
            statusBar()->showMessage(tr("Live2D設定を読み込めません: %1").arg(registryError),
                                     15000);
        });
    }
    if (!vrmAssets_.load(registryError)) {
        qWarning().noquote() << registryError;
        QTimer::singleShot(0, this, [this, registryError] {
            statusBar()->showMessage(tr("VRM設定を読み込めません: %1").arg(registryError), 15000);
        });
    }
    auto* layout = new QVBoxLayout(page);
    layout->setContentsMargins(44, 28, 44, 32);
    layout->setSpacing(14);

    // 背景の上に置く操作は半透明のghost styleで統一する
    auto* top = new QHBoxLayout();
    top->setSpacing(10);
    auto* back = new QPushButton(tr("戻る"), page);
    back->setObjectName("ghost");
    back->setIcon(tintedIcon(QStringLiteral(":/icons/back.svg"), Qt::white, Qt::white));
    back->setIconSize(QSize(16, 16));
    top->addWidget(back);
    top->addStretch();
    stagingBadge_ = new QLabel("STAGING", page);
    stagingBadge_->setStyleSheet(
        "background:#b45309;padding:6px 10px;border-radius:5px;font-weight:700;");
    stagingBadge_->setVisible(QString(PANDD_DISTRIBUTION_ENV) == "staging");
    top->addWidget(stagingBadge_);
    addHeaderActions(page, top);
    auto* tools = new QPushButton(tr("ツール"), page);
    tools->setObjectName("ghost");
    top->addWidget(tools);
    layout->addLayout(top);

    layout->addStretch(1);
    heroTitle_ = new ElidedLabel(page);
    heroTitle_->setObjectName("heroTitle");
    layout->addWidget(heroTitle_);
    summary_ = new QLabel(page);
    summary_->setWordWrap(true);
    summary_->setMaximumWidth(650);
    summary_->setObjectName("heroSummary");
    layout->addWidget(summary_);
    playStatisticsLabel_ = new QLabel(page);
    playStatisticsLabel_->setWordWrap(true);
    playStatisticsLabel_->setStyleSheet("font-size:13px;color:#d5dce8;");
    playStatisticsLabel_->setAccessibleName(tr("この端末のプレイ記録"));
    layout->addWidget(playStatisticsLabel_);
    announcements_ = new QListWidget(page);
    announcements_->setObjectName("announcements");
    announcements_->setMaximumWidth(760);
    announcements_->setMaximumHeight(120);
    announcements_->setAccessibleName(tr("お知らせ"));
    layout->addWidget(announcements_);

    // 進捗は数値を上、細いバーを下に置いて主操作ボタンの下端へそろえる
    auto* actionRow = new QHBoxLayout();
    actionRow->setSpacing(24);
    auto* progressLayout = new QVBoxLayout();
    progressLayout->setSpacing(8);
    progressLayout->addStretch();
    progressBar_ = new QProgressBar(page);
    progressBar_->setRange(0, 100);
    progressBar_->setTextVisible(false);
    progressBar_->setFixedHeight(6);
    progressBar_->setVisible(false);
    transferLabel_ = new QLabel(page);
    transferLabel_->setObjectName("transfer");
    progressLayout->addWidget(transferLabel_);
    progressLayout->addWidget(progressBar_);
    actionRow->addLayout(progressLayout, 1);
    primaryButton_ = new QPushButton(tr("ダウンロード"), page);
    primaryButton_->setObjectName("primary");
    primaryButton_->setAccessibleName(tr("選択ゲームの主操作"));
    actionRow->addWidget(primaryButton_);
    layout->addLayout(actionRow);
    locateButton_ = new QPushButton(tr("インストール済みですか？ ゲームの場所を特定"), page);
    locateButton_->setAccessibleName(tr("既存ゲームの場所を選択"));
    locateButton_->setObjectName("link");
    layout->addWidget(locateButton_, 0, Qt::AlignRight);
    if (EditionProfile::current().enabled()) {
        auto* mediaButton = new QPushButton(tr("配布媒体からインストール"), page);
        layout->addWidget(mediaButton, 0, Qt::AlignRight);
        connect(mediaButton, &QPushButton::clicked, this, [this] {
            if (mandatoryUpdate_ || selectedGameId_.isEmpty()) {
                return;
            }
            const auto media =
                QFileDialog::getExistingDirectory(this, tr("配布物の media フォルダーを選択"));
            if (!media.isEmpty()) {
                viewModel_.installFromMedia(selectedGameId_, media);
            }
        });
    }

    connect(back, &QPushButton::clicked, this,
            [this] { navigateTo(selectedGameInstalled() ? 2 : 0); });
    connect(tools, &QPushButton::clicked, this, &LauncherWindow::showToolsMenu);
    connect(primaryButton_, &QPushButton::clicked, this, &LauncherWindow::runPrimaryAction);
    connect(locateButton_, &QPushButton::clicked, this, [this] {
        if (mandatoryUpdate_) {
            return;
        }
        const auto directory =
            QFileDialog::getExistingDirectory(this, tr("既存ゲームのフォルダーを選択"));
        if (!directory.isEmpty()) {
            viewModel_.locateExisting(selectedGameId_, directory);
        }
    });
    return detailPage_;
}

/** @brief ViewModel signalを画面状態と通知へ接続する */
void LauncherWindow::connectViewModel() {
    // snapshot変更と初期読込を画面へ接続する
    connect(&viewModel_, &LauncherViewModel::dataChanged, this, &LauncherWindow::refreshData);
    connect(&viewModel_, &LauncherViewModel::playStatisticsChanged, this,
            &LauncherWindow::refreshPlayStatistics);
    connect(&viewModel_, &LauncherViewModel::loaded, this, [this] {
        refreshData();
        statusBar()->showMessage(tr("最新情報を読み込みました"), 3000);
        if (!initialUpdateCheckStarted_ && viewModel_.settings().checkLauncherUpdateOnStart) {
            initialUpdateCheckStarted_ = true;
            viewModel_.checkLauncherUpdate();
        }
    });
    connect(&viewModel_, &LauncherViewModel::errorOccurred, this,
            [this](const QString& message, bool) {
                if (viewModel_.settings().notifyErrors && trayIcon_->isVisible()) {
                    trayIcon_->showMessage(tr("操作エラー"), message, QSystemTrayIcon::Warning);
                }
                QMessageBox::warning(this, tr("操作エラー"), message);
            });
    connect(&viewModel_, &LauncherViewModel::launcherUpdateChecked, this,
            [this](const QString&, const QString& latest, const QString& title, const QString&,
                   bool available, bool mandatory) {
                if (!available) {
                    return;
                }
                if (viewModel_.settings().notifyLauncherUpdate && trayIcon_->isVisible()) {
                    trayIcon_->showMessage(tr("ランチャー更新"),
                                           tr("バージョン %1: %2").arg(latest, title));
                }
                if (mandatory) {
                    mandatoryUpdate_ = true;
                    primaryButton_->setEnabled(false);
                    locateButton_->setEnabled(false);
                    QMessageBox prompt(QMessageBox::Warning, tr("必須アップデート"),
                                       tr("安全に利用を続けるにはランチャーの更新が必要です"),
                                       QMessageBox::Ok | QMessageBox::Close, this);
                    prompt.setInformativeText(tr("バージョン %1: %2").arg(latest, title));
                    prompt.button(QMessageBox::Ok)->setText(tr("アップデート"));
                    prompt.button(QMessageBox::Close)->setText(tr("終了"));
                    if (prompt.exec() == QMessageBox::Ok) {
                        viewModel_.applyLauncherUpdate();
                    } else {
                        qApp->quit();
                    }
                } else if (viewModel_.settings().autoApplyLauncherUpdate) {
                    QMessageBox prompt(QMessageBox::Information, tr("ランチャー更新"),
                                       tr("バージョン %1: %2").arg(latest, title),
                                       QMessageBox::Ok | QMessageBox::Cancel, this);
                    prompt.button(QMessageBox::Ok)->setText(tr("アップデート"));
                    prompt.button(QMessageBox::Cancel)->setText(tr("後で"));
                    if (prompt.exec() == QMessageBox::Ok) {
                        viewModel_.applyLauncherUpdate();
                    }
                }
            });
    connect(&viewModel_, &LauncherViewModel::launcherUpdateStarted, qApp, &QApplication::quit);
    connect(&viewModel_, &LauncherViewModel::gameStateChanged, this,
            [this](const QString& gameId, int state) {
                if (static_cast<InstallState>(state) == InstallState::Running) {
                    runningGames_.insert(gameId);
                } else {
                    runningGames_.remove(gameId);
                }
                detailPage_->setGameRunning(!runningGames_.isEmpty());
                if (selectedGameId_ != gameId) {
                    return;
                }
                const auto previous = static_cast<InstallState>(selectedState_);
                selectedState_ = state;
                const auto value = static_cast<InstallState>(state);
                if (value == InstallState::Downloading) {
                    primaryButton_->setText(tr("一時停止"));
                    progressBar_->setVisible(true);
                } else if (value == InstallState::Paused) {
                    primaryButton_->setText(tr("再開"));
                } else if (value == InstallState::CheckingUpdate) {
                    primaryButton_->setText(tr("更新を確認中"));
                    primaryButton_->setEnabled(false);
                } else if (value == InstallState::Running) {
                    primaryButton_->setText(tr("実行中"));
                    primaryButton_->setEnabled(false);
                } else {
                    primaryButton_->setEnabled(!mandatoryUpdate_);
                    primaryButton_->setText(selectedGameInstalled() ? tr("ゲーム開始")
                                                                    : tr("ダウンロード"));
                    locateButton_->setVisible(!selectedGameInstalled());
                    if (value == InstallState::Ready && completesGamePreparation(previous) &&
                        viewModel_.settings().notifyInstallComplete && trayIcon_->isVisible()) {
                        trayIcon_->showMessage(tr("準備完了"), tr("ゲームを起動できます"));
                    }
                }
            });
    connect(&viewModel_, &LauncherViewModel::progressChanged, this,
            [this](const QString& gameId, quint64 received, quint64 total, quint64 speed, int done,
                   int all) {
                if (gameId != selectedGameId_) {
                    return;
                }
                progressBar_->setVisible(true);
                progressBar_->setValue(total == 0 ? 0 : static_cast<int>(received * 100 / total));
                transferLabel_->setText(
                    tr("%1 / %2  %3/s  ファイル %4/%5")
                        .arg(formatBytes(received), formatBytes(total), formatBytes(speed))
                        .arg(done)
                        .arg(all));
                if (all > 0 && done == all && viewModel_.settings().notifyDownloadComplete &&
                    trayIcon_->isVisible()) {
                    trayIcon_->showMessage(tr("ダウンロード完了"),
                                           tr("ゲームファイルの取得が完了しました"));
                }
            });
}

/** @brief カタログと導入済み一覧を各pageへ反映する */
void LauncherWindow::refreshData() {
    // 既存一覧をsnapshotから再構築する
    applyTheme();
    homeList_->clear();
    libraryList_->clear();
    const QPixmap placeholderPixmap(QStringLiteral(":/images/launcher_background_placeholder.png"));
    const QIcon placeholder(cardThumbnail(placeholderPixmap));
    std::vector<const GameCatalogEntry*> recommendations;
    for (const auto& game : viewModel_.catalog()) {
        const auto gameId = QString::fromStdString(game.gameId.value());
        const auto name = QString::fromStdString(game.name);
        const auto summary = QString::fromStdString(game.summary);
        const auto installed =
            std::any_of(viewModel_.installedGames().begin(), viewModel_.installedGames().end(),
                        [&game](const auto& value) { return value.gameId == game.gameId; });
        const auto imageUrl = QString::fromStdString(game.thumbnailUrl);
        const QIcon icon = heroCache_.contains(imageUrl)
                               ? QIcon(cardThumbnail(heroCache_.value(imageUrl)))
                               : (imageUrl.isEmpty() ? placeholder : QIcon{});
        auto addCard = [&](QListWidget* list) {
            auto* item = new QListWidgetItem(icon, name);
            item->setData(Qt::UserRole, gameId);
            item->setToolTip(summary);
            item->setTextAlignment(Qt::AlignHCenter | Qt::AlignBottom);
            list->addItem(item);
        };
        if (installed) {
            addCard(libraryList_);
        } else {
            recommendations.push_back(&game);
        }
        if (!imageUrl.isEmpty() && !heroCache_.contains(imageUrl)) {
            requestCatalogImage(gameId, imageUrl);
        }
    }

    // homeのおすすめをランダムな最大5件へ絞る
    std::mt19937 randomEngine(QRandomGenerator::global()->generate());
    std::shuffle(recommendations.begin(), recommendations.end(), randomEngine);
    recommendations.resize(std::min<std::size_t>(5, recommendations.size()));
    for (const auto* game : recommendations) {
        const auto gameId = QString::fromStdString(game->gameId.value());
        const auto imageUrl = QString::fromStdString(game->thumbnailUrl);
        const QIcon icon = heroCache_.contains(imageUrl)
                               ? QIcon(cardThumbnail(heroCache_.value(imageUrl)))
                               : (imageUrl.isEmpty() ? placeholder : QIcon{});
        auto* item = new QListWidgetItem(icon, QString::fromStdString(game->name));
        item->setData(Qt::UserRole, gameId);
        item->setToolTip(QString::fromStdString(game->summary));
        item->setTextAlignment(Qt::AlignHCenter | Qt::AlignBottom);
        homeList_->addItem(item);
    }
    // 各一覧の空状態と表示状態を同期する
    homeEmpty_->setVisible(homeList_->count() == 0);
    homeList_->setVisible(homeList_->count() != 0);
    if (homeList_->count() != 0) {
        homeList_->setCurrentRow(0);
    } else {
        homePreviewImage_->setSourcePixmap({});
        homePreviewTitle_->clear();
        homePreviewSummary_->setFullText({});
    }
    libraryEmpty_->setVisible(libraryList_->count() == 0);
    libraryList_->setVisible(libraryList_->count() != 0);
    refreshDiscover();
    if (!selectedGameId_.isEmpty()) {
        const auto currentPage = pages_->currentIndex();
        showGame(selectedGameId_);
        if (currentPage != 3) {
            navigateTo(currentPage);
        }
    }
}

/** @brief homeで選択されたゲームのpreviewを更新する */
void LauncherWindow::updateHomeSelection(const QString& gameId) {
    const auto iterator = std::find_if(
        viewModel_.catalog().begin(), viewModel_.catalog().end(),
        [&gameId](const auto& entry) { return entry.gameId.value() == gameId.toStdString(); });
    if (iterator == viewModel_.catalog().end()) {
        return;
    }

    homePreviewTitle_->setText(QString::fromStdString(iterator->name));
    homePreviewSummary_->setFullText(QString::fromStdString(iterator->summary));
    const auto imageUrl = QString::fromStdString(iterator->thumbnailUrl);
    const QPixmap image =
        heroCache_.contains(imageUrl)
            ? heroCache_.value(imageUrl)
            : QPixmap(QStringLiteral(":/images/launcher_background_placeholder.png"));
    homePreviewImage_->setSourcePixmap(image);
}

/** @brief 検索条件に合う未所持ゲームを再描画する */
void LauncherWindow::refreshDiscover() {
    // 検索結果を現在のqueryから再構築する
    if (discoverList_ == nullptr) {
        return;
    }
    discoverList_->clear();
    const auto query = searchInput_->text().trimmed();
    const QPixmap placeholderPixmap(QStringLiteral(":/images/launcher_background_placeholder.png"));
    const QIcon placeholder(cardThumbnail(placeholderPixmap));
    for (const auto& game : viewModel_.catalog()) {
        const auto installed =
            std::any_of(viewModel_.installedGames().begin(), viewModel_.installedGames().end(),
                        [&game](const auto& value) { return value.gameId == game.gameId; });
        const auto name = QString::fromStdString(game.name);
        const auto summary = QString::fromStdString(game.summary);
        if (installed || (!query.isEmpty() && !name.contains(query, Qt::CaseInsensitive) &&
                          !summary.contains(query, Qt::CaseInsensitive))) {
            continue;
        }
        const auto imageUrl = QString::fromStdString(game.thumbnailUrl);
        const QIcon icon = heroCache_.contains(imageUrl)
                               ? QIcon(cardThumbnail(heroCache_.value(imageUrl)))
                               : (imageUrl.isEmpty() ? placeholder : QIcon{});
        auto* item = new QListWidgetItem(icon, name);
        item->setData(Qt::UserRole, QString::fromStdString(game.gameId.value()));
        item->setToolTip(summary);
        item->setTextAlignment(Qt::AlignHCenter | Qt::AlignBottom);
        discoverList_->addItem(item);
    }
    const auto empty = discoverList_->count() == 0;
    discoverEmpty_->setText(query.isEmpty() ? tr("現在表示できる未所持ゲームはありません")
                                            : tr("「%1」に一致するゲームはありません").arg(query));
    discoverEmpty_->setVisible(empty);
    discoverList_->setVisible(!empty);
}

/** @brief 指定pageへ移動してnavigation状態を更新する */
void LauncherWindow::navigateTo(int pageIndex) {
    pages_->setCurrentIndex(pageIndex);
    homeButton_->setChecked(pageIndex == 0);
    discoverButton_->setChecked(pageIndex == 1);
    libraryButton_->setChecked(pageIndex == 2);
    updateNavigationIndicator(isVisible());
}

/** @brief 選択中navigation項目へindicatorを移動する */
void LauncherWindow::updateNavigationIndicator(bool animated) {
    if (!navigationIndicator_ || !navigationIndicator_->parentWidget()->isVisible()) {
        return;
    }

    QPushButton* selectedButton = nullptr;
    if (homeButton_->isChecked()) {
        selectedButton = homeButton_;
    } else if (discoverButton_->isChecked()) {
        selectedButton = discoverButton_;
    } else if (libraryButton_->isChecked()) {
        selectedButton = libraryButton_;
    }

    if (!selectedButton) {
        navigationIndicatorAnimation_->stop();
        navigationIndicator_->hide();
        return;
    }

    // indicatorはsidebar左端に置き、選択項目の上下を少し詰める
    const QRect target(0, selectedButton->y() + 10, 4, selectedButton->height() - 20);
    navigationIndicator_->show();
    navigationIndicator_->raise();
    navigationIndicatorAnimation_->stop();
    if (!animated) {
        navigationIndicator_->setGeometry(target);
        return;
    }
    navigationIndicatorAnimation_->setEndValue(target);
    navigationIndicatorAnimation_->start();
}

/** @brief catalog画像を取得して一覧のiconを更新する */
void LauncherWindow::requestCatalogImage(const QString& gameId, const QString& imageUrl) {
    // redirectと応答サイズを制限して画像を取得する
    QNetworkRequest request{QUrl(imageUrl)};
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                         QNetworkRequest::ManualRedirectPolicy);
    request.setTransferTimeout(10000);
    auto* reply = imageNetwork_->get(request);
    constexpr qsizetype maximumImageBytes = qsizetype{8} * 1024 * 1024;
    reply->setReadBufferSize(maximumImageBytes + 1);
    connect(reply, &QNetworkReply::finished, this, [this, reply, gameId, imageUrl] {
        const auto data = reply->readAll();
        const auto succeeded =
            reply->error() == QNetworkReply::NoError && data.size() <= maximumImageBytes;
        reply->deleteLater();
        auto* watcher = new QFutureWatcher<QImage>(this);
        connect(watcher, &QFutureWatcher<QImage>::finished, this,
                [this, watcher, gameId, imageUrl] {
                    const auto decoded = watcher->result();
                    watcher->deleteLater();
                    if (decoded.isNull()) {
                        const QPixmap placeholderPixmap(
                            QStringLiteral(":/images/launcher_background_placeholder.png"));
                        const QIcon placeholder(cardThumbnail(placeholderPixmap));
                        heroCache_.insert(imageUrl, placeholderPixmap);
                        for (auto* list : {homeList_, discoverList_, libraryList_}) {
                            for (int index = 0; index < list->count(); ++index) {
                                auto* item = list->item(index);
                                if (item->data(Qt::UserRole).toString() == gameId) {
                                    item->setIcon(placeholder);
                                }
                            }
                        }
                        if (homeList_->currentItem() &&
                            homeList_->currentItem()->data(Qt::UserRole).toString() == gameId) {
                            updateHomeSelection(gameId);
                        }
                        return;
                    }
                    const auto pixmap = QPixmap::fromImage(decoded);
                    heroCache_.insert(imageUrl, pixmap);
                    for (auto* list : {homeList_, discoverList_, libraryList_}) {
                        for (int index = 0; index < list->count(); ++index) {
                            auto* item = list->item(index);
                            if (item->data(Qt::UserRole).toString() == gameId) {
                                item->setIcon(QIcon(cardThumbnail(pixmap)));
                            }
                        }
                    }
                    if (homeList_->currentItem() &&
                        homeList_->currentItem()->data(Qt::UserRole).toString() == gameId) {
                        updateHomeSelection(gameId);
                    }
                });
        watcher->setFuture(QtConcurrent::run(
            [data, succeeded] { return succeeded ? decodeImage(data, 4096) : QImage{}; }));
    });
}

/** @brief 指定ゲームのdetail pageを表示する */
void LauncherWindow::showGame(const QString& gameId) {
    // catalogから選択ゲームを解決する
    const auto iterator = std::find_if(
        viewModel_.catalog().begin(), viewModel_.catalog().end(),
        [&gameId](const auto& entry) { return entry.gameId.value() == gameId.toStdString(); });
    if (iterator == viewModel_.catalog().end()) {
        return;
    }
    selectedGameId_ = gameId;
    detailPage_->setModel(live2dAssets_.find(gameId), vrmAssets_.find(gameId));
    heroTitle_->setFullText(QString::fromStdString(iterator->name));
    summary_->setText(QString::fromStdString(iterator->summary));
    refreshPlayStatistics();
    detailPage_->setFocalPoint(iterator->heroFocalX, iterator->heroFocalY);

    // 取得中は空背景とし、取得失敗時にだけplaceholderを表示
    const auto heroUrl = QString::fromStdString(iterator->heroUrl);
    if (heroCache_.contains(heroUrl)) {
        detailPage_->setHero(heroCache_.value(heroUrl));
    } else {
        detailPage_->clearHero();
        if (heroUrl.isEmpty()) {
            detailPage_->setHero(QPixmap(":/images/launcher_background_placeholder.png"));
        } else {
            QNetworkRequest request{QUrl(heroUrl)};
            request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                                 QNetworkRequest::ManualRedirectPolicy);
            request.setTransferTimeout(10000);
            auto* reply = imageNetwork_->get(request);
            constexpr qsizetype maximumHeroBytes = qsizetype{16} * 1024 * 1024;
            reply->setReadBufferSize(maximumHeroBytes + 1);
            const auto data = std::make_shared<QByteArray>();
            connect(reply, &QNetworkReply::readyRead, this, [reply, data] {
                constexpr qsizetype maximumHeroBytes = qsizetype{16} * 1024 * 1024;
                if (reply->bytesAvailable() > maximumHeroBytes - data->size()) {
                    reply->abort();
                    return;
                }
                data->append(reply->readAll());
            });
            connect(reply, &QNetworkReply::finished, this, [this, reply, data, heroUrl, gameId] {
                constexpr qsizetype maximumHeroBytes = qsizetype{16} * 1024 * 1024;
                const auto remaining = reply->readAll();
                const auto succeeded = reply->error() == QNetworkReply::NoError &&
                                       remaining.size() <= maximumHeroBytes - data->size();
                data->append(remaining);
                reply->deleteLater();
                auto* watcher = new QFutureWatcher<QImage>(this);
                connect(watcher, &QFutureWatcher<QImage>::finished, this,
                        [this, watcher, heroUrl, gameId] {
                            const auto decoded = watcher->result();
                            watcher->deleteLater();
                            if (!decoded.isNull()) {
                                const auto image = QPixmap::fromImage(decoded);
                                heroCache_.insert(heroUrl, image);
                                if (selectedGameId_ == gameId) {
                                    detailPage_->setHero(image);
                                }
                            } else if (selectedGameId_ == gameId) {
                                const QPixmap placeholder(
                                    ":/images/launcher_background_placeholder.png");
                                heroCache_.insert(heroUrl, placeholder);
                                detailPage_->setHero(placeholder);
                            }
                        });
                watcher->setFuture(QtConcurrent::run(
                    [data, succeeded] { return succeeded ? decodeImage(*data, 8192) : QImage{}; }));
            });
        }
    }
    announcements_->clear();
    for (const auto& item : viewModel_.announcements()) {
        announcements_->addItem(
            QString::fromStdString(item.category + "  " + item.title + "  " + item.publishedAt));
    }
    primaryButton_->setText(selectedGameInstalled() ? tr("ゲーム開始") : tr("ダウンロード"));
    locateButton_->setVisible(!selectedGameInstalled());
    primaryButton_->setEnabled(!mandatoryUpdate_);
    locateButton_->setEnabled(!mandatoryUpdate_);
    progressBar_->setVisible(false);
    transferLabel_->clear();
    navigateTo(3);
}

/** @brief 観測できた実行時間と成功起動回数を表示する */
void LauncherWindow::refreshPlayStatistics() {
    if (selectedGameId_.isEmpty() || playStatisticsLabel_ == nullptr) {
        return;
    }

    const auto statistics = viewModel_.playStatistics(selectedGameId_);
    const auto seconds = statistics.totalDurationSeconds;
    const auto lastPlayed = QDateTime::fromString(statistics.lastPlayedAt, Qt::ISODateWithMs);
    playStatisticsLabel_->setText(
        tr("この端末・直近90日: %1回起動 / 実行時間 %2時間%3分\n最終起動: %4 / 計測中断: %5回")
            .arg(statistics.launchCount)
            .arg(seconds / 3600)
            .arg((seconds % 3600) / 60)
            .arg(lastPlayed.isValid() ? lastPlayed.toLocalTime().toString("yyyy/MM/dd HH:mm")
                                      : tr("記録なし"))
            .arg(statistics.interruptedCount));
    playStatisticsLabel_->setToolTip(
        tr("ランチャーで監視できた時間です。メニューや放置時間を含みます。"
           "ランチャーの完全終了後やゲーム本体の直接起動は計測できません"));
}

/** @brief 選択ゲームが導入済みかを返す */
bool LauncherWindow::selectedGameInstalled() const {
    // ViewModel snapshotからゲームIDを検索する
    return std::any_of(viewModel_.installedGames().begin(), viewModel_.installedGames().end(),
                       [this](const auto& value) {
                           return value.gameId.value() == selectedGameId_.toStdString();
                       });
}

/** @brief 選択ゲームの状態に応じた主操作を実行する */
void LauncherWindow::runPrimaryAction() {
    // 必須更新と取得操作を優先して判定する
    if (mandatoryUpdate_) {
        QMessageBox::warning(this, tr("必須アップデート"),
                             tr("ランチャーを更新してからゲームを操作してください"));
        return;
    }
    if (static_cast<InstallState>(selectedState_) == InstallState::Downloading) {
        viewModel_.pause(selectedGameId_);
        return;
    }
    if (static_cast<InstallState>(selectedState_) == InstallState::Paused) {
        viewModel_.resume(selectedGameId_);
        return;
    }
    if (selectedGameInstalled()) {
        viewModel_.launch(selectedGameId_);
    } else if (confirmInstall()) {
        viewModel_.installOrUpdate(selectedGameId_);
    }
}

/** @brief ゲーム導入確認dialogを表示して結果を返す */
bool LauncherWindow::confirmInstall() const {
    // 設定済みinstall rootを確認文へ表示する
    const auto root = QString::fromStdString(viewModel_.settings().installRoot);
    return QMessageBox::question(const_cast<LauncherWindow*>(this), tr("ダウンロードの確認"),
                                 tr("%1 を次の場所へインストールします。\n\n%2\n\n続行しますか？")
                                     .arg(heroTitle_->fullText(), root),
                                 QMessageBox::Yes | QMessageBox::No) == QMessageBox::Yes;
}

/** @brief 一般・download・更新・詳細設定をdialogへ構築する */
void LauncherWindow::showSettingsDialog() {
    // 設定dialogの共通layoutを構築する
    QDialog dialog(this);
    dialog.setWindowTitle(tr("設定"));
    dialog.resize(620, 520);
    auto* layout = new QVBoxLayout(&dialog);
    auto* tabs = new QTabWidget(&dialog);

    auto settings = viewModel_.settings();
    const auto previousLanguage = settings.language;
    auto* general = new QWidget(tabs);
    auto* generalForm = new QFormLayout(general);
    auto* language = new QComboBox(general);
    for (const auto& locale : supportedLocales()) {
        language->addItem(locale.nativeName, locale.code);
    }
    if (language->findData(QString::fromStdString(settings.language)) < 0) {
        const auto code = QString::fromStdString(settings.language);
        language->addItem(code, code);
    }
    language->setCurrentIndex(language->findData(QString::fromStdString(settings.language)));
    auto* installRoot = new QLineEdit(QString::fromStdString(settings.installRoot), general);
    auto* browse = new QPushButton(tr("参照"), general);
    auto* pathRow = new QWidget(general);
    auto* pathLayout = new QHBoxLayout(pathRow);
    pathLayout->setContentsMargins(0, 0, 0, 0);
    pathLayout->addWidget(installRoot, 1);
    pathLayout->addWidget(browse);
    auto* startup = new QCheckBox(tr("OSログイン時に自動起動"), general);
    startup->setChecked(settings.startOnLogin);
    auto* minimized = new QCheckBox(tr("自動起動時は最小化"), general);
    minimized->setChecked(settings.startMinimized);
    auto* closeToTray = new QCheckBox(tr("閉じるボタンで通知領域へ格納"), general);
    closeToTray->setChecked(settings.closeToTray);
    closeToTray->setEnabled(QSystemTrayIcon::isSystemTrayAvailable());
    auto* showAfterExit = new QCheckBox(tr("ゲーム終了後にランチャーを表示"), general);
    showAfterExit->setChecked(settings.showAfterGameExit);
    auto* theme = new QComboBox(general);
    theme->addItem(tr("ライト"), false);
    theme->addItem(tr("ダーク"), true);
    theme->setCurrentIndex(theme->findData(settings.darkTheme));
    generalForm->addRow(tr("言語"), language);
    generalForm->addRow(tr("テーマ"), theme);
    generalForm->addRow(tr("ゲーム保存先"), pathRow);
    generalForm->addRow(startup);
    generalForm->addRow(minimized);
    generalForm->addRow(closeToTray);
    generalForm->addRow(showAfterExit);
    tabs->addTab(general, tr("一般"));

    // download設定を構築する
    auto* downloads = new QWidget(tabs);
    auto* downloadForm = new QFormLayout(downloads);
    auto* speed = new QSpinBox(downloads);
    speed->setRange(0, 1024);
    speed->setSuffix(" MB/s");
    speed->setSpecialValueText(tr("無制限"));
    speed->setValue(static_cast<int>(settings.downloadLimitBytesPerSecond / 1000000));
    auto* checkBefore = new QCheckBox(tr("ゲーム起動前に更新を確認"), downloads);
    checkBefore->setChecked(settings.checkGameUpdateBeforeLaunch);
    auto* continueDownloads = new QCheckBox(tr("他ゲーム実行中もダウンロードを継続"), downloads);
    continueDownloads->setChecked(settings.continueOtherDownloadsWhilePlaying);
    downloadForm->addRow(tr("速度上限"), speed);
    downloadForm->addRow(checkBefore);
    downloadForm->addRow(continueDownloads);
    tabs->addTab(downloads, tr("ダウンロード"));

    // 任意送信の説明と端末・サーバーそれぞれの削除操作を構築する
    auto* statisticsPage = new QWidget(tabs);
    auto* statisticsLayout = new QVBoxLayout(statisticsPage);
    auto* shareStatistics = new QCheckBox(tr("プレイ統計を運営へ送信する（任意）"), statisticsPage);
    const bool initialStatisticsSharing = viewModel_.statisticsSharingEnabled();
    shareStatistics->setChecked(initialStatisticsSharing);
    shareStatistics->setEnabled(viewModel_.statisticsUploadAvailable() &&
                                !viewModel_.statisticsDeletionInProgress());
    statisticsLayout->addWidget(shareStatistics);
    auto* statisticsDescription = new QLabel(
        tr("ゲームID、バージョン、起動日時、実行時間、終了結果とランダムな端末識別IDを送信します。"
           "初期状態はOFFです。有効化する前の履歴は送信しません。\n\n"
           "この端末の履歴は90日、送信待ちは最大30日保存します。"
           "サーバーの詳細記録は90日で削除し、識別IDを含まない集計は保持します。"
           "送信をOFFにすると未送信データを削除します。送信済み記録の削除には下のボタンを使えます。"
           "\n\n"
           "削除操作は保存・キャンセルに関係なく直ちに適用されます"),
        statisticsPage);
    statisticsDescription->setWordWrap(true);
    statisticsLayout->addWidget(statisticsDescription);
    if (!viewModel_.statisticsUploadAvailable()) {
        auto* unavailable =
            new QLabel(tr("このビルドでは統計送信先が設定されていません"), statisticsPage);
        unavailable->setWordWrap(true);
        statisticsLayout->addWidget(unavailable);
    }
    auto* clearHistory = new QPushButton(tr("この端末のプレイ履歴を削除"), statisticsPage);
    auto* deleteShared = new QPushButton(tr("送信を停止して送信済み記録を削除"), statisticsPage);
    deleteShared->setEnabled(viewModel_.statisticsUploadAvailable() &&
                             !viewModel_.statisticsDeletionInProgress());
    auto* deletionStatus = new QLabel(statisticsPage);
    deletionStatus->setWordWrap(true);
    if (viewModel_.statisticsDeletionInProgress()) {
        deletionStatus->setText(tr("削除を要求しています…"));
    }
    statisticsLayout->addWidget(clearHistory);
    statisticsLayout->addWidget(deleteShared);
    statisticsLayout->addWidget(deletionStatus);
    statisticsLayout->addStretch();
    tabs->addTab(statisticsPage, tr("プレイ統計"));
    connect(clearHistory, &QPushButton::clicked, &dialog, [this, &dialog] {
        if (QMessageBox::question(&dialog, tr("プレイ履歴の削除"),
                                  tr("この端末のプレイ履歴を削除します。続行しますか？")) ==
            QMessageBox::Yes) {
            viewModel_.clearPlayHistory();
        }
    });
    connect(deleteShared, &QPushButton::clicked, &dialog,
            [this, &dialog, deleteShared, shareStatistics, deletionStatus] {
                if (QMessageBox::question(
                        &dialog, tr("送信済み記録の削除"),
                        tr("統計送信を停止し、サーバーのこの端末に対応する詳細記録を削除します。"
                           "識別IDを含まない集計は残ります。続行しますか？")) == QMessageBox::Yes) {
                    shareStatistics->setChecked(false);
                    shareStatistics->setEnabled(false);
                    deleteShared->setEnabled(false);
                    deletionStatus->setText(tr("削除を要求しています…"));
                    viewModel_.deleteSharedStatistics();
                }
            });
    connect(&viewModel_, &LauncherViewModel::sharedStatisticsDeleted, &dialog,
            [this, deleteShared, shareStatistics, deletionStatus](bool success) {
                deleteShared->setEnabled(viewModel_.statisticsUploadAvailable());
                shareStatistics->setEnabled(viewModel_.statisticsUploadAvailable());
                deletionStatus->setText(
                    success ? tr("送信済みの詳細記録を削除しました")
                            : tr("削除できませんでした。接続を確認して再試行してください"));
            });

    // launcher更新と通知設定を構築する
    auto* update = new QWidget(tabs);
    auto* updateForm = new QFormLayout(update);
    auto* updateCheck = new QCheckBox(tr("起動時にランチャー更新を確認"), update);
    updateCheck->setChecked(settings.checkLauncherUpdateOnStart);
    auto* autoApply = new QCheckBox(tr("ランチャー更新を自動適用"), update);
    autoApply->setChecked(settings.autoApplyLauncherUpdate);
    auto* downloadNotifications = new QCheckBox(tr("ダウンロード完了をOS通知"), update);
    downloadNotifications->setChecked(settings.notifyDownloadComplete);
    auto* installNotifications = new QCheckBox(tr("インストール完了をOS通知"), update);
    installNotifications->setChecked(settings.notifyInstallComplete);
    auto* errorNotifications = new QCheckBox(tr("エラーをOS通知"), update);
    errorNotifications->setChecked(settings.notifyErrors);
    auto* launcherNotifications = new QCheckBox(tr("ランチャー更新をOS通知"), update);
    launcherNotifications->setChecked(settings.notifyLauncherUpdate);
    const auto notificationsAvailable = QSystemTrayIcon::supportsMessages();
    for (auto* notification :
         {downloadNotifications, installNotifications, errorNotifications, launcherNotifications}) {
        notification->setEnabled(notificationsAvailable);
    }
    updateForm->addRow(updateCheck);
    updateForm->addRow(autoApply);
    updateForm->addRow(downloadNotifications);
    updateForm->addRow(installNotifications);
    updateForm->addRow(errorNotifications);
    updateForm->addRow(launcherNotifications);
    updateForm->addRow(
        tr("OS通知"),
        new QLabel(notificationsAvailable ? tr("利用可能") : tr("利用できません"), update));
    auto* currentVersion = new QLabel(PANDD_LAUNCHER_VERSION, update);
    auto* latestVersion = new QLabel(tr("未確認"), update);
    auto* lastChecked = new QLabel(settings.lastLauncherUpdateCheck.empty()
                                       ? tr("未確認")
                                       : QString::fromStdString(settings.lastLauncherUpdateCheck),
                                   update);
    auto* releaseTitle = new QLabel(tr("更新情報はありません"), update);
    releaseTitle->setWordWrap(true);
    updateForm->addRow(tr("現在のバージョン"), currentVersion);
    updateForm->addRow(tr("最新のバージョン"), latestVersion);
    updateForm->addRow(tr("最終確認日時"), lastChecked);
    updateForm->addRow(tr("更新内容"), releaseTitle);
    auto* checkNow = new QPushButton(tr("今すぐ確認"), update);
    auto* applyUpdate = new QPushButton(tr("アップデート"), update);
    applyUpdate->setEnabled(false);
    updateForm->addRow(checkNow);
    updateForm->addRow(applyUpdate);
    tabs->addTab(update, tr("更新と通知"));

    // versionとドキュメント操作を構築する
    auto* details = new QWidget(tabs);
    auto* detailsForm = new QFormLayout(details);
    detailsForm->addRow(tr("ランチャーバージョン"), new QLabel(PANDD_LAUNCHER_VERSION, details));
    detailsForm->addRow(tr("ビルド番号"), new QLabel(PANDD_BUILD_NUMBER, details));
    detailsForm->addRow(tr("OS"), new QLabel(QSysInfo::prettyProductName(), details));
    detailsForm->addRow(tr("アーキテクチャ"),
                        new QLabel(QSysInfo::currentCpuArchitecture(), details));
    auto* licenses = new QPushButton(tr("ライセンス"), details);
    auto* chromiumLicenses = new QPushButton(tr("Chromiumライセンス"), details);
    auto* qtReplacement = new QPushButton(tr("Qtライブラリ交換手順"), details);
    auto* changelog = new QPushButton(tr("更新履歴"), details);
    auto* privacy = new QPushButton(tr("プライバシーポリシー"), details);
    auto* terms = new QPushButton(tr("利用規約"), details);
    auto* diagnostics = new QPushButton(tr("診断情報をコピー"), details);
    detailsForm->addRow(changelog);
    detailsForm->addRow(licenses);
    detailsForm->addRow(chromiumLicenses);
    detailsForm->addRow(qtReplacement);
    detailsForm->addRow(privacy);
    detailsForm->addRow(terms);
    detailsForm->addRow(diagnostics);
    tabs->addTab(details, tr("詳細"));

    layout->addWidget(tabs);
    auto* buttons =
        new QDialogButtonBox(QDialogButtonBox::Save | QDialogButtonBox::Cancel, &dialog);
    layout->addWidget(buttons);
    connect(browse, &QPushButton::clicked, &dialog, [&] {
        const auto selected =
            QFileDialog::getExistingDirectory(&dialog, tr("ゲーム保存先"), installRoot->text());
        if (!selected.isEmpty()) {
            installRoot->setText(selected);
        }
    });
    connect(buttons, &QDialogButtonBox::accepted, &dialog, &QDialog::accept);
    connect(buttons, &QDialogButtonBox::rejected, &dialog, &QDialog::reject);
    connect(checkNow, &QPushButton::clicked, &dialog, [this, checkNow] {
        checkNow->setEnabled(false);
        viewModel_.checkLauncherUpdate();
    });
    connect(applyUpdate, &QPushButton::clicked, &dialog,
            [this] { viewModel_.applyLauncherUpdate(); });
    // 同じQString型のsignal引数を定義済みの意味順で受け取る
    // NOLINTBEGIN(bugprone-easily-swappable-parameters)
    connect(&viewModel_, &LauncherViewModel::launcherUpdateChecked, &dialog,
            [checkNow, applyUpdate, latestVersion, lastChecked,
             releaseTitle](const QString&, const QString& latest, const QString& title,
                           const QString& checkedAt, bool available, bool mandatory) {
                // 更新確認結果を設定画面へ反映し、適用可能な場合だけ操作を有効化
                checkNow->setEnabled(true);
                applyUpdate->setEnabled(available);
                latestVersion->setText(latest);
                lastChecked->setText(checkedAt);
                releaseTitle->setText(available ? (mandatory ? tr("必須: %1").arg(title) : title)
                                                : tr("最新バージョンです"));
            });
    // NOLINTEND(bugprone-easily-swappable-parameters)
    connect(licenses, &QPushButton::clicked, &dialog,
            [this] { showTextDocument(tr("ライセンス"), ":/legal/THIRD_PARTY_NOTICES.md"); });
    connect(chromiumLicenses, &QPushButton::clicked, &dialog, [&dialog, this] {
        // 同梱Chromium自身が提供する完全な第三者ライセンスを表示する
        QDialog credits(&dialog);
        credits.setWindowTitle(tr("Chromiumライセンス"));
        credits.resize(900, 650);
        auto* creditsLayout = new QVBoxLayout(&credits);
        auto* view = new QWebEngineView(&credits);
        creditsLayout->addWidget(view);
        view->load(QUrl(QStringLiteral("chrome://credits")));
        credits.exec();
    });
    connect(qtReplacement, &QPushButton::clicked, &dialog, [this] {
        showTextDocument(tr("Qtライブラリ交換手順"), ":/legal/QT_LGPL_COMPLIANCE.md");
    });
    connect(changelog, &QPushButton::clicked, &dialog, [this] { showLauncherChangelog(); });
    connect(privacy, &QPushButton::clicked, &dialog,
            [this] { showTextDocument(tr("プライバシーポリシー"), ":/legal/PRIVACY_POLICY.md"); });
    connect(terms, &QPushButton::clicked, &dialog,
            [this] { showTextDocument(tr("利用規約"), ":/legal/TERMS_OF_USE.md"); });
    connect(diagnostics, &QPushButton::clicked, &dialog, [this] { copyDiagnostics(); });
    // dialog確定後に設定値をViewModelへ渡す
    if (dialog.exec() != QDialog::Accepted) {
        return;
    }

    // 変更していない送信設定は背景処理で停止された状態を上書きしない
    if (shareStatistics->isChecked() != initialStatisticsSharing) {
        viewModel_.setStatisticsSharingEnabled(shareStatistics->isChecked());
    }

    settings.language = language->currentData().toString().toStdString();
    settings.installRoot = installRoot->text().toStdString();
    settings.startOnLogin = startup->isChecked();
    settings.startMinimized = minimized->isChecked();
    settings.closeToTray = closeToTray->isChecked();
    settings.showAfterGameExit = showAfterExit->isChecked();
    settings.darkTheme = theme->currentData().toBool();
    settings.downloadLimitBytesPerSecond = static_cast<std::uint64_t>(speed->value()) * 1000000ULL;
    settings.checkGameUpdateBeforeLaunch = checkBefore->isChecked();
    settings.continueOtherDownloadsWhilePlaying = continueDownloads->isChecked();
    settings.checkLauncherUpdateOnStart = updateCheck->isChecked();
    settings.autoApplyLauncherUpdate = autoApply->isChecked();
    settings.notifyDownloadComplete = downloadNotifications->isChecked();
    settings.notifyInstallComplete = installNotifications->isChecked();
    settings.notifyErrors = errorNotifications->isChecked();
    settings.notifyLauncherUpdate = launcherNotifications->isChecked();
    settings.lastLauncherUpdateCheck = viewModel_.settings().lastLauncherUpdateCheck;
    viewModel_.saveSettings(std::move(settings));
    if (language->currentData().toString().toStdString() != previousLanguage) {
        QMessageBox::information(this, tr("言語"), tr("言語の変更は次回起動時に反映されます"));
    }
}

/** @brief 選択ゲームの検証・修復・保存場所操作menuを表示する */
void LauncherWindow::showToolsMenu() {
    if (mandatoryUpdate_ || selectedGameId_.isEmpty() || !selectedGameInstalled()) {
        return;
    }
    QMenu menu(this);
    auto* verify = menu.addAction(tr("ゲームファイルを検証"));
    auto* repair = menu.addAction(tr("修復"));
    menu.addSeparator();
    auto* openInstall = menu.addAction(tr("インストールフォルダーを開く"));
    auto* openSave = menu.addAction(tr("セーブデータフォルダーを開く"));
    auto* openLogs = menu.addAction(tr("ログフォルダーを開く"));
    auto* cleanup = menu.addAction(tr("失敗した一時データを削除"));
    menu.addSeparator();
    auto* uninstall = menu.addAction(tr("ゲームをアンインストール"));
    const auto* action = menu.exec(QCursor::pos());
    if (action == verify) {
        viewModel_.verify(selectedGameId_);
    } else if (action == repair) {
        viewModel_.repair(selectedGameId_);
    } else if (action == openInstall) {
        const auto iterator =
            std::find_if(viewModel_.installedGames().begin(), viewModel_.installedGames().end(),
                         [this](const auto& value) {
                             return value.gameId.value() == selectedGameId_.toStdString();
                         });
        if (iterator != viewModel_.installedGames().end()) {
            QDesktopServices::openUrl(
                QUrl::fromLocalFile(QString::fromStdString(iterator->gameRoot)));
        }
    } else if (action == openSave) {
        const auto directory = viewModel_.saveDirectory(selectedGameId_);
        if (!directory.isEmpty()) {
            QDir().mkpath(directory);
            QDesktopServices::openUrl(QUrl::fromLocalFile(directory));
        }
    } else if (action == openLogs) {
        QDesktopServices::openUrl(QUrl::fromLocalFile(FileLogger::logDirectory()));
    } else if (action == cleanup &&
               QMessageBox::question(this, tr("一時データの削除"),
                                     tr("未完了のダウンロードデータを削除しますか？"),
                                     QMessageBox::Yes | QMessageBox::No) == QMessageBox::Yes) {
        viewModel_.cleanupTemporary(selectedGameId_);
    } else if (action == uninstall) {
        const auto iterator =
            std::find_if(viewModel_.installedGames().begin(), viewModel_.installedGames().end(),
                         [this](const auto& value) {
                             return value.gameId.value() == selectedGameId_.toStdString();
                         });
        if (iterator != viewModel_.installedGames().end() &&
            QMessageBox::warning(
                this, tr("アンインストール"),
                tr("次のゲーム本体を削除します。セーブデータは保持されます。\n\n%1\n%2")
                    .arg(QString::fromStdString(iterator->gameRoot),
                         formatBytes(iterator->installedSize)),
                QMessageBox::Yes | QMessageBox::No) == QMessageBox::Yes) {
            viewModel_.uninstall(selectedGameId_);
        }
    }
}

/** @brief 同梱resource文書をdialogへ表示する */
// 同じQString型でもtitleとresource pathを別のUI概念として受け取る
// NOLINTNEXTLINE(bugprone-easily-swappable-parameters)
void LauncherWindow::showTextDocument(const QString& title, const QString& resourcePath) {
    // 同梱文書をread-only browserへ表示する
    QFile file(resourcePath);
    if (!file.open(QIODevice::ReadOnly | QIODevice::Text)) {
        QMessageBox::warning(this, title, tr("文書を読み込めません"));
        return;
    }
    QDialog dialog(this);
    dialog.setWindowTitle(title);
    dialog.resize(720, 560);
    auto* layout = new QVBoxLayout(&dialog);
    auto* browser = new QTextBrowser(&dialog);
    browser->setMarkdown(QString::fromUtf8(file.readAll()));
    browser->setOpenExternalLinks(true);
    layout->addWidget(browser);
    auto* buttons = new QDialogButtonBox(QDialogButtonBox::Close, &dialog);
    connect(buttons, &QDialogButtonBox::rejected, &dialog, &QDialog::reject);
    layout->addWidget(buttons);
    dialog.exec();
}

/** @brief ランチャー更新履歴をread-only dialogへ表示する */
void LauncherWindow::showLauncherChangelog() {
    // changelogを表示用の行へ変換する
    QDialog dialog(this);
    dialog.setWindowTitle(tr("更新履歴"));
    dialog.resize(680, 520);
    auto* layout = new QVBoxLayout(&dialog);
    auto* browser = new QTextBrowser(&dialog);
    QStringList lines;
    for (const auto& entry : viewModel_.launcherChangelog()) {
        lines.append(QString("%1 — %2").arg(QString::fromStdString(entry.version.value()),
                                            QString::fromStdString(entry.title)));
        lines.append(QString::fromStdString(entry.publishedAt));
        for (const auto& change : entry.changes) {
            lines.append("  • " + QString::fromStdString(change));
        }
        lines.append(QString{});
    }
    browser->setPlainText(lines.isEmpty() ? tr("更新履歴はまだありません") : lines.join('\n'));
    layout->addWidget(browser);
    auto* buttons = new QDialogButtonBox(QDialogButtonBox::Close, &dialog);
    connect(buttons, &QDialogButtonBox::rejected, &dialog, &QDialog::reject);
    layout->addWidget(buttons);
    dialog.exec();
}

/** @brief 個人pathを除外した診断情報をclipboardへコピーする */
void LauncherWindow::copyDiagnostics() {
    // pathを含まない診断情報を組み立てる
    QStringList lines{
        "PandD Game Launcher diagnostics",
        QString("LauncherVersion=%1").arg(PANDD_LAUNCHER_VERSION),
        QString("Build=%1").arg(PANDD_BUILD_NUMBER),
        QString("Environment=%1").arg(PANDD_DISTRIBUTION_ENV),
        QString("Qt=%1").arg(QT_VERSION_STR),
        QString("OS=%1").arg(QSysInfo::prettyProductName()),
        QString("Kernel=%1 %2").arg(QSysInfo::kernelType(), QSysInfo::kernelVersion()),
        QString("Architecture=%1").arg(QSysInfo::currentCpuArchitecture()),
        QString("Language=%1").arg(QString::fromStdString(viewModel_.settings().language)),
        QString("InstalledGameCount=%1").arg(viewModel_.installedGames().size()),
    };
    for (const auto& game : viewModel_.installedGames()) {
        lines.append(QString("Game=%1 Version=%2")
                         .arg(QString::fromStdString(game.gameId.value()),
                              QString::fromStdString(game.version.value())));
    }
    lines.append("PersonalPaths=excluded");
    QGuiApplication::clipboard()->setText(lines.join('\n'));
    QMessageBox::information(this, tr("診断情報"),
                             tr("個人パスを除外した診断情報をコピーしました"));
}

/** @brief byte数を利用者向け単位へ整形する */
QString LauncherWindow::formatBytes(quint64 bytes) {
    if (bytes >= 1000000000ULL) {
        return QString::number(static_cast<double>(bytes) / 1000000000.0, 'f', 1) + " GB";
    }
    if (bytes >= 1000000ULL) {
        return QString::number(static_cast<double>(bytes) / 1000000.0, 'f', 1) + " MB";
    }
    if (bytes >= 1000ULL) {
        return QString::number(static_cast<double>(bytes) / 1000.0, 'f', 1) + " KB";
    }
    return QString::number(bytes) + " B";
}

} // namespace pandd
