#include "presentation/LauncherWindow.h"

#include "infrastructure/FileLogger.h"
#include "presentation/LocalizationManager.h"

#include <QApplication>
#include <QBitmap>
#include <QBuffer>
#include <QCheckBox>
#include <QClipboard>
#include <QCloseEvent>
#include <QComboBox>
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
#include <QProgressBar>
#include <QPropertyAnimation>
#include <QPushButton>
#include <QRegion>
#include <QResizeEvent>
#include <QSpinBox>
#include <QStackedWidget>
#include <QStandardPaths>
#include <QStatusBar>
#include <QSysInfo>
#include <QSystemTrayIcon>
#include <QTabWidget>
#include <QTextBrowser>
#include <QTimer>
#include <QToolButton>
#include <QVBoxLayout>

#include <algorithm>
#include <memory>

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

} // namespace

/** @brief hero画像をcover配置し可読性gradientを重ねる詳細page */
class HeroPage final : public QWidget {
  public:
    /** @brief 画像未読込の空背景で初期化する */
    explicit HeroPage(QWidget* parent = nullptr) : QWidget(parent) {}

    /** @brief 次の画像を待つ間は以前の画像を表示しない */
    void clearHero() {
        hero_ = {};
        update();
    }

    /** @brief 検証済み取得画像へ差し替える */
    void setHero(const QPixmap& hero) {
        if (!hero.isNull()) {
            hero_ = hero;
            update();
        }
    }

    /** @brief catalog指定の注視点を0から1の範囲で設定する */
    void setFocalPoint(double x, double y) {
        focalX_ = std::clamp(x, 0.0, 1.0);
        focalY_ = std::clamp(y, 0.0, 1.0);
        update();
    }

  protected:
    /** @brief aspect-fillで描画し下部へgradientを合成する */
    void paintEvent(QPaintEvent* event) override {
        Q_UNUSED(event)
        QPainter painter(this);
        painter.fillRect(rect(), QColor(20, 22, 27));
        if (!hero_.isNull()) {
            const auto scaled =
                hero_.scaled(size(), Qt::KeepAspectRatioByExpanding, Qt::SmoothTransformation);
            const QPoint origin(-static_cast<int>((scaled.width() - width()) * focalX_),
                                -static_cast<int>((scaled.height() - height()) * focalY_));
            painter.drawPixmap(origin, scaled);
        }
        QLinearGradient gradient(0, 0, 0, height());
        gradient.setColorAt(0.0, QColor(8, 12, 18, 80));
        gradient.setColorAt(0.55, QColor(8, 12, 18, 130));
        gradient.setColorAt(1.0, QColor(8, 12, 18, 245));
        painter.fillRect(rect(), gradient);
    }

  private:
    QPixmap hero_;
    double focalX_{0.5};
    double focalY_{0.5};
};

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
    [[nodiscard]] const QString& fullText() const { return fullText_; }

  protected:
    void resizeEvent(QResizeEvent* event) override {
        QLabel::resizeEvent(event);
        updateDisplayedText();
    }

  private:
    void updateDisplayedText() {
        setText(QFontMetrics(font()).elidedText(fullText_, Qt::ElideRight, width()));
    }

    QString fullText_;
};

LauncherWindow::LauncherWindow(LauncherViewModel& viewModel, bool initialize, QWidget* parent)
    : QMainWindow(parent), viewModel_(viewModel) {
    buildUi();
    connectViewModel();
    if (initialize) {
        viewModel_.initialize();
    }
}

void LauncherWindow::closeEvent(QCloseEvent* event) {
    if (viewModel_.settings().closeToTray && QSystemTrayIcon::isSystemTrayAvailable()) {
        hide();
        event->ignore();
        return;
    }
    QMainWindow::closeEvent(event);
}

void LauncherWindow::buildUi() {
    setWindowTitle(tr("PandD Game Launcher"));
    const QIcon logoIcon(QStringLiteral(":/images/PandDLogo.png"));
    setWindowIcon(logoIcon);
    setMinimumSize(960, 600);
    resize(1280, 720);
    applyTheme();

    auto* central = new QWidget(this);
    auto* layout = new QHBoxLayout(central);
    layout->setContentsMargins(0, 0, 0, 0);
    layout->setSpacing(0);

    // 主要ナビゲーションとゲーム一覧への導線を持つ固定サイドバー
    auto* sidebar = new QFrame(central);
    sidebar->setObjectName("sidebar");
    sidebar->setFixedWidth(190);
    auto* sidebarLayout = new QVBoxLayout(sidebar);
    sidebarLayout->setContentsMargins(8, 4, 8, 16);
    sidebarLayout->setSpacing(8);
    auto* brand = new QLabel(sidebar);
    const QPixmap sourceLogo(QStringLiteral(":/images/PandDLogo.png"));
    const auto visibleLogoBounds = QRegion(sourceLogo.mask()).boundingRect();
    const auto visibleLogo =
        visibleLogoBounds.isValid() ? sourceLogo.copy(visibleLogoBounds) : sourceLogo;
    brand->setPixmap(visibleLogo.scaled(174, 72, Qt::KeepAspectRatio, Qt::SmoothTransformation));
    brand->setFixedHeight(76);
    brand->setAlignment(Qt::AlignCenter);
    sidebarLayout->addWidget(brand);
    homeButton_ = new QPushButton(tr("トップ"), sidebar);
    homeButton_->setObjectName("nav");
    homeButton_->setCheckable(true);
    discoverButton_ = new QPushButton(tr("さがす"), sidebar);
    discoverButton_->setObjectName("nav");
    discoverButton_->setCheckable(true);
    sidebarLayout->addWidget(homeButton_);
    sidebarLayout->addWidget(discoverButton_);
    sidebarLayout->addStretch(1);
    libraryButton_ = new QPushButton(tr("▦  ゲーム一覧"), sidebar);
    libraryButton_->setObjectName("libraryNav");
    libraryButton_->setCheckable(true);
    libraryButton_->setAccessibleName(tr("所持ゲーム一覧を開く"));
    sidebarLayout->addWidget(libraryButton_);
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

    connect(homeButton_, &QPushButton::clicked, this, [this] { navigateTo(0); });
    connect(discoverButton_, &QPushButton::clicked, this, [this] { navigateTo(1); });
    connect(libraryButton_, &QPushButton::clicked, this, [this] {
        navigateTo(2);
        libraryList_->scrollToTop();
        libraryList_->setCurrentItem(nullptr);
    });
    navigateTo(0);
    QTimer::singleShot(0, this, [this] { updateNavigationIndicator(false); });
}

void LauncherWindow::applyTheme() {
    const auto dark = viewModel_.settings().darkTheme;
    const auto background = dark ? "#17181c" : "#f5f5f5";
    const auto surface = dark ? "#24262c" : "#ffffff";
    const auto text = dark ? "#f4f4f5" : "#242424";
    const auto muted = dark ? "#a9abb3" : "#676767";
    const auto border = dark ? "#3a3d45" : "#d7d7d7";
    const auto hover = dark ? "#34272c" : "#fff7f8";
    const auto selected = dark ? "#3d242a" : "#fff4f5";
    setStyleSheet(
        QString("QMainWindow,QWidget#page,QDialog{background:%1;color:%3;}"
                "QFrame#sidebar{background:%2;border-right:1px solid %5;}"
                "QLabel,QCheckBox,QRadioButton,QGroupBox,QTabWidget{color:%3;}"
                "QPushButton{background:%2;color:%3;border:1px solid %5;border-radius:8px;"
                "padding:10px 16px;font-weight:600;}"
                "QPushButton:hover{border:2px solid #e60012;background:%6;}"
                "QPushButton#account,QPushButton#account:hover{background:transparent;border:0;"
                "padding:0;}"
                "QPushButton#settings{padding:0;}"
                "QPushButton#nav{border:0;border-radius:8px;text-align:left;padding:12px;}"
                "QPushButton#libraryNav{text-align:left;min-height:38px;}"
                "QPushButton#nav:checked,QPushButton#libraryNav:checked{background:transparent;"
                "color:%3;border:0;}"
                "QFrame#navigationIndicator{background:#e60012;border-radius:2px;}"
                "QPushButton#primary{background:#e60012;color:white;border:0;font-size:18px;"
                "min-width:260px;min-height:38px;}"
                "QPushButton#primary:hover{background:#c90010;}"
                "QListWidget{background:transparent;border:0;outline:0;color:%3;}"
                "QListWidget::item{background:%2;color:%3;border:1px solid %5;"
                "border-radius:10px;padding:10px;margin:6px;}"
                "QListWidget::item:hover{border:3px solid #e60012;background:%6;}"
                "QListWidget::item:selected{border:3px solid #e60012;background:%7;}"
                "QLineEdit,QComboBox,QSpinBox,QTextBrowser{background:%2;color:%3;"
                "border:2px solid %5;border-radius:8px;padding:8px;}"
                "QLineEdit{border-radius:22px;padding:10px 18px;font-size:16px;}"
                "QLineEdit:focus,QComboBox:focus,QSpinBox:focus{border-color:#e60012;}"
                "QTabWidget::pane{border:1px solid %5;background:%2;}"
                "QTabBar::tab{background:%1;color:%3;padding:9px 14px;}"
                "QTabBar::tab:selected{background:#e60012;color:white;}"
                "QLabel#pageTitle{font-size:30px;font-weight:700;color:%3;}"
                "QLabel#sectionTitle{font-size:20px;font-weight:700;color:%3;}"
                "QLabel#muted{color:%4;font-size:14px;}"
                "QLabel#empty{color:%4;font-size:17px;background:%2;"
                "border:1px dashed %5;border-radius:12px;padding:28px;}"
                "QLabel#heroTitle{font-size:36px;font-weight:700;color:white;}"
                "QProgressBar{border:0;border-radius:5px;background:%5;color:%3;"
                "text-align:center;}"
                "QProgressBar::chunk{background:#e60012;border-radius:5px;}")
            .arg(background, surface, text, muted, border, hover, selected));
}

QWidget* LauncherWindow::createHomePage() {
    auto* page = new QWidget(this);
    page->setObjectName("page");
    auto* layout = new QVBoxLayout(page);
    layout->setContentsMargins(42, 32, 42, 32);
    auto* headerRow = new QHBoxLayout();
    auto* header = new QLabel(tr("あなたへのおすすめ"), page);
    header->setObjectName("pageTitle");
    headerRow->addWidget(header);
    headerRow->addStretch();
    auto* account = new QPushButton(page);
    account->setObjectName("account");
    account->setToolTip(tr("アカウント（準備中）"));
    account->setAccessibleName(tr("アカウント（準備中）"));
    account->setFixedSize(44, 44);
    headerRow->addWidget(account);
    auto* settings = new QPushButton(page);
    settings->setObjectName("settings");
    settings->setIcon(QIcon(QStringLiteral(":/images/settings.svg")));
    settings->setIconSize(QSize(20, 20));
    settings->setToolTip(tr("設定"));
    settings->setAccessibleName(tr("設定を開く"));
    settings->setFixedSize(44, 44);
    headerRow->addWidget(settings);
    layout->addLayout(headerRow);
    auto* hint = new QLabel(tr("まだ持っていないゲームから、新しいお気に入りを見つけよう"), page);
    hint->setObjectName("muted");
    layout->addWidget(hint);
    homeList_ = new QListWidget(page);
    homeList_->setViewMode(QListView::IconMode);
    homeList_->setIconSize(QSize(250, 140));
    homeList_->setGridSize(QSize(290, 210));
    homeList_->setMovement(QListView::Static);
    homeList_->setResizeMode(QListView::Adjust);
    homeList_->setAccessibleName(tr("おすすめゲーム"));
    layout->addWidget(homeList_, 1);
    homeEmpty_ = new QLabel(tr("現在おすすめできる未所持ゲームはありません"), page);
    homeEmpty_->setObjectName("empty");
    homeEmpty_->setAlignment(Qt::AlignCenter);
    layout->addWidget(homeEmpty_);
    connect(homeList_, &QListWidget::itemActivated, this,
            [this](QListWidgetItem* item) { showGame(item->data(Qt::UserRole).toString()); });
    connect(settings, &QPushButton::clicked, this, &LauncherWindow::showSettingsDialog);
    return page;
}

QWidget* LauncherWindow::createDiscoverPage() {
    auto* page = new QWidget(this);
    page->setObjectName("page");
    auto* layout = new QVBoxLayout(page);
    layout->setContentsMargins(42, 32, 42, 32);
    auto* headerRow = new QHBoxLayout();
    auto* header = new QLabel(tr("ゲームをさがす"), page);
    header->setObjectName("pageTitle");
    headerRow->addWidget(header);
    headerRow->addStretch();
    auto* account = new QPushButton(page);
    account->setObjectName("account");
    account->setToolTip(tr("アカウント（準備中）"));
    account->setAccessibleName(tr("アカウント（準備中）"));
    account->setFixedSize(44, 44);
    headerRow->addWidget(account);
    auto* settings = new QPushButton(page);
    settings->setObjectName("settings");
    settings->setIcon(QIcon(QStringLiteral(":/images/settings.svg")));
    settings->setIconSize(QSize(20, 20));
    settings->setToolTip(tr("設定"));
    settings->setAccessibleName(tr("設定を開く"));
    settings->setFixedSize(44, 44);
    headerRow->addWidget(settings);
    layout->addLayout(headerRow);
    searchInput_ = new QLineEdit(page);
    searchInput_->setPlaceholderText(tr("ゲーム名やキーワードで検索"));
    searchInput_->setClearButtonEnabled(true);
    searchInput_->setAccessibleName(tr("未所持ゲームを検索"));
    layout->addWidget(searchInput_);
    auto* section = new QLabel(tr("まだ持っていないゲーム"), page);
    section->setObjectName("sectionTitle");
    layout->addWidget(section);
    discoverList_ = new QListWidget(page);
    discoverList_->setViewMode(QListView::IconMode);
    discoverList_->setIconSize(QSize(210, 118));
    discoverList_->setGridSize(QSize(250, 185));
    discoverList_->setMovement(QListView::Static);
    discoverList_->setResizeMode(QListView::Adjust);
    discoverList_->setAccessibleName(tr("未所持ゲーム一覧"));
    layout->addWidget(discoverList_, 1);
    discoverEmpty_ = new QLabel(page);
    discoverEmpty_->setObjectName("empty");
    discoverEmpty_->setAlignment(Qt::AlignCenter);
    layout->addWidget(discoverEmpty_);
    connect(searchInput_, &QLineEdit::textChanged, this, &LauncherWindow::refreshDiscover);
    connect(discoverList_, &QListWidget::itemActivated, this,
            [this](QListWidgetItem* item) { showGame(item->data(Qt::UserRole).toString()); });
    connect(settings, &QPushButton::clicked, this, &LauncherWindow::showSettingsDialog);
    return page;
}

QWidget* LauncherWindow::createLibraryPage() {
    auto* page = new QWidget(this);
    page->setObjectName("page");
    auto* layout = new QVBoxLayout(page);
    layout->setContentsMargins(42, 32, 42, 32);
    auto* headerRow = new QHBoxLayout();
    auto* header = new QLabel(tr("ゲーム一覧"), page);
    header->setObjectName("pageTitle");
    headerRow->addWidget(header);
    headerRow->addStretch();
    auto* account = new QPushButton(page);
    account->setObjectName("account");
    account->setToolTip(tr("アカウント（準備中）"));
    account->setAccessibleName(tr("アカウント（準備中）"));
    account->setFixedSize(44, 44);
    headerRow->addWidget(account);
    auto* settings = new QPushButton(page);
    settings->setObjectName("settings");
    settings->setIcon(QIcon(QStringLiteral(":/images/settings.svg")));
    settings->setIconSize(QSize(20, 20));
    settings->setToolTip(tr("設定"));
    settings->setAccessibleName(tr("設定を開く"));
    settings->setFixedSize(44, 44);
    headerRow->addWidget(settings);
    layout->addLayout(headerRow);
    auto* hint = new QLabel(tr("持っているゲームを選んでプレイ"), page);
    hint->setObjectName("muted");
    layout->addWidget(hint);
    libraryList_ = new QListWidget(page);
    libraryList_->setViewMode(QListView::IconMode);
    libraryList_->setIconSize(QSize(210, 118));
    libraryList_->setGridSize(QSize(250, 185));
    libraryList_->setMovement(QListView::Static);
    libraryList_->setResizeMode(QListView::Adjust);
    libraryList_->setAccessibleName(tr("所持ゲーム一覧"));
    layout->addWidget(libraryList_, 1);
    libraryEmpty_ = new QLabel(
        tr("所持しているゲームはありません\nトップや「さがす」からゲームを見つけましょう"), page);
    libraryEmpty_->setObjectName("empty");
    libraryEmpty_->setAlignment(Qt::AlignCenter);
    layout->addWidget(libraryEmpty_);
    connect(libraryList_, &QListWidget::itemActivated, this,
            [this](QListWidgetItem* item) { showGame(item->data(Qt::UserRole).toString()); });
    connect(settings, &QPushButton::clicked, this, &LauncherWindow::showSettingsDialog);
    return page;
}

QWidget* LauncherWindow::createDetailPage() {
    auto* page = new HeroPage(this);
    detailPage_ = page;
    auto* layout = new QVBoxLayout(page);
    layout->setContentsMargins(46, 30, 46, 34);

    auto* top = new QHBoxLayout();
    auto* back = new QPushButton(tr("← 戻る"), page);
    top->addWidget(back);
    top->addStretch();
    stagingBadge_ = new QLabel("STAGING", page);
    stagingBadge_->setStyleSheet(
        "background:#b45309;padding:6px 10px;border-radius:5px;font-weight:700;");
    stagingBadge_->setVisible(QString(PANDD_DISTRIBUTION_ENV) == "staging");
    top->addWidget(stagingBadge_);
    auto* account = new QPushButton(page);
    account->setObjectName("account");
    account->setToolTip(tr("アカウント（準備中）"));
    account->setAccessibleName(tr("アカウント（準備中）"));
    account->setFixedSize(44, 44);
    top->addWidget(account);
    auto* settings = new QPushButton(page);
    settings->setObjectName("settings");
    settings->setIcon(QIcon(QStringLiteral(":/images/settings.svg")));
    settings->setIconSize(QSize(20, 20));
    settings->setToolTip(tr("設定"));
    settings->setAccessibleName(tr("設定を開く"));
    settings->setFixedSize(44, 44);
    top->addWidget(settings);
    auto* tools = new QPushButton(tr("ツール"), page);
    top->addWidget(tools);
    layout->addLayout(top);

    layout->addStretch(1);
    heroTitle_ = new ElidedLabel(page);
    heroTitle_->setObjectName("heroTitle");
    layout->addWidget(heroTitle_);
    summary_ = new QLabel(page);
    summary_->setWordWrap(true);
    summary_->setMaximumWidth(650);
    summary_->setStyleSheet("font-size:15px;color:#d5dce8;");
    layout->addWidget(summary_);
    announcements_ = new QListWidget(page);
    announcements_->setMaximumHeight(140);
    announcements_->setAccessibleName(tr("お知らせ"));
    layout->addWidget(announcements_);

    auto* actionRow = new QHBoxLayout();
    auto* progressLayout = new QVBoxLayout();
    progressBar_ = new QProgressBar(page);
    progressBar_->setRange(0, 100);
    progressBar_->setVisible(false);
    transferLabel_ = new QLabel(page);
    transferLabel_->setStyleSheet("color:#b8c2d1;");
    progressLayout->addWidget(progressBar_);
    progressLayout->addWidget(transferLabel_);
    actionRow->addLayout(progressLayout, 1);
    primaryButton_ = new QPushButton(tr("ダウンロード"), page);
    primaryButton_->setObjectName("primary");
    primaryButton_->setAccessibleName(tr("選択ゲームの主操作"));
    actionRow->addWidget(primaryButton_);
    layout->addLayout(actionRow);
    locateButton_ = new QPushButton(tr("インストール済みですか？ ゲームの場所を特定"), page);
    locateButton_->setAccessibleName(tr("既存ゲームの場所を選択"));
    locateButton_->setStyleSheet("background:transparent;color:#c9d7ea;text-decoration:underline;");
    layout->addWidget(locateButton_, 0, Qt::AlignRight);

    connect(back, &QPushButton::clicked, this,
            [this] { navigateTo(selectedGameInstalled() ? 2 : 0); });
    connect(settings, &QPushButton::clicked, this, &LauncherWindow::showSettingsDialog);
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
    return page;
}

void LauncherWindow::connectViewModel() {
    connect(&viewModel_, &LauncherViewModel::dataChanged, this, &LauncherWindow::refreshData);
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

void LauncherWindow::refreshData() {
    applyTheme();
    homeList_->clear();
    libraryList_->clear();
    int recommendationCount = 0;
    const QIcon placeholder(QStringLiteral(":/images/launcher_background_placeholder.png"));
    for (const auto& game : viewModel_.catalog()) {
        const auto gameId = QString::fromStdString(game.gameId.value());
        const auto name = QString::fromStdString(game.name);
        const auto summary = QString::fromStdString(game.summary);
        const auto installed =
            std::any_of(viewModel_.installedGames().begin(), viewModel_.installedGames().end(),
                        [&game](const auto& value) { return value.gameId == game.gameId; });
        const auto imageUrl = QString::fromStdString(game.thumbnailUrl);
        const QIcon icon = heroCache_.contains(imageUrl)
                               ? QIcon(heroCache_.value(imageUrl))
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
        } else if (recommendationCount < 6) {
            addCard(homeList_);
            ++recommendationCount;
        }
        if (!imageUrl.isEmpty() && !heroCache_.contains(imageUrl)) {
            requestCatalogImage(gameId, imageUrl);
        }
    }
    homeEmpty_->setVisible(homeList_->count() == 0);
    homeList_->setVisible(homeList_->count() != 0);
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

void LauncherWindow::refreshDiscover() {
    if (discoverList_ == nullptr) {
        return;
    }
    discoverList_->clear();
    const auto query = searchInput_->text().trimmed();
    const QIcon placeholder(QStringLiteral(":/images/launcher_background_placeholder.png"));
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
                               ? QIcon(heroCache_.value(imageUrl))
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

void LauncherWindow::navigateTo(int pageIndex) {
    pages_->setCurrentIndex(pageIndex);
    homeButton_->setChecked(pageIndex == 0);
    discoverButton_->setChecked(pageIndex == 1);
    libraryButton_->setChecked(pageIndex == 2);
    updateNavigationIndicator(isVisible());
}

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

    const QRect target(selectedButton->x(), selectedButton->y(), 5, selectedButton->height());
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

void LauncherWindow::requestCatalogImage(const QString& gameId, const QString& imageUrl) {
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
        QBuffer buffer;
        buffer.setData(data);
        buffer.open(QIODevice::ReadOnly);
        QImageReader reader(&buffer);
        reader.setDecideFormatFromContent(true);
        const auto dimensions = reader.size();
        const auto validDimensions =
            dimensions.isValid() && dimensions.width() <= 4096 && dimensions.height() <= 4096;
        const auto decoded = succeeded && validDimensions ? reader.read() : QImage{};
        if (decoded.isNull()) {
            const QPixmap placeholderPixmap(
                QStringLiteral(":/images/launcher_background_placeholder.png"));
            const QIcon placeholder(placeholderPixmap);
            heroCache_.insert(imageUrl, placeholderPixmap);
            for (auto* list : {homeList_, discoverList_, libraryList_}) {
                for (int index = 0; index < list->count(); ++index) {
                    auto* item = list->item(index);
                    if (item->data(Qt::UserRole).toString() == gameId) {
                        item->setIcon(placeholder);
                    }
                }
            }
            return;
        }
        const auto pixmap = QPixmap::fromImage(decoded);
        heroCache_.insert(imageUrl, pixmap);
        for (auto* list : {homeList_, discoverList_, libraryList_}) {
            for (int index = 0; index < list->count(); ++index) {
                auto* item = list->item(index);
                if (item->data(Qt::UserRole).toString() == gameId) {
                    item->setIcon(QIcon(pixmap));
                }
            }
        }
    });
}

void LauncherWindow::showGame(const QString& gameId) {
    const auto iterator = std::find_if(
        viewModel_.catalog().begin(), viewModel_.catalog().end(),
        [&gameId](const auto& entry) { return entry.gameId.value() == gameId.toStdString(); });
    if (iterator == viewModel_.catalog().end()) {
        return;
    }
    selectedGameId_ = gameId;
    heroTitle_->setFullText(QString::fromStdString(iterator->name));
    summary_->setText(QString::fromStdString(iterator->summary));
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
                QBuffer buffer(data.get());
                buffer.open(QIODevice::ReadOnly);
                QImageReader reader(&buffer);
                reader.setDecideFormatFromContent(true);
                const auto dimensions = reader.size();
                const auto validDimensions = dimensions.isValid() && dimensions.width() <= 8192 &&
                                             dimensions.height() <= 8192;
                const auto decoded = succeeded && validDimensions ? reader.read() : QImage{};
                if (!decoded.isNull()) {
                    const auto image = QPixmap::fromImage(decoded);
                    heroCache_.insert(heroUrl, image);
                    if (selectedGameId_ == gameId) {
                        detailPage_->setHero(image);
                    }
                } else if (selectedGameId_ == gameId) {
                    const QPixmap placeholder(":/images/launcher_background_placeholder.png");
                    heroCache_.insert(heroUrl, placeholder);
                    detailPage_->setHero(placeholder);
                }
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

bool LauncherWindow::selectedGameInstalled() const {
    return std::any_of(viewModel_.installedGames().begin(), viewModel_.installedGames().end(),
                       [this](const auto& value) {
                           return value.gameId.value() == selectedGameId_.toStdString();
                       });
}

void LauncherWindow::runPrimaryAction() {
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

bool LauncherWindow::confirmInstall() const {
    const auto root = QString::fromStdString(viewModel_.settings().installRoot);
    return QMessageBox::question(const_cast<LauncherWindow*>(this), tr("ダウンロードの確認"),
                                 tr("%1 を次の場所へインストールします。\n\n%2\n\n続行しますか？")
                                     .arg(heroTitle_->fullText(), root),
                                 QMessageBox::Yes | QMessageBox::No) == QMessageBox::Yes;
}

void LauncherWindow::showSettingsDialog() {
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

    auto* details = new QWidget(tabs);
    auto* detailsForm = new QFormLayout(details);
    detailsForm->addRow(tr("ランチャーバージョン"), new QLabel(PANDD_LAUNCHER_VERSION, details));
    detailsForm->addRow(tr("ビルド番号"), new QLabel(PANDD_BUILD_NUMBER, details));
    detailsForm->addRow(tr("OS"), new QLabel(QSysInfo::prettyProductName(), details));
    detailsForm->addRow(tr("アーキテクチャ"),
                        new QLabel(QSysInfo::currentCpuArchitecture(), details));
    auto* licenses = new QPushButton(tr("ライセンス"), details);
    auto* qtReplacement = new QPushButton(tr("Qtライブラリ交換手順"), details);
    auto* changelog = new QPushButton(tr("更新履歴"), details);
    auto* privacy = new QPushButton(tr("プライバシーポリシー"), details);
    auto* terms = new QPushButton(tr("利用規約"), details);
    auto* diagnostics = new QPushButton(tr("診断情報をコピー"), details);
    detailsForm->addRow(changelog);
    detailsForm->addRow(licenses);
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
    connect(qtReplacement, &QPushButton::clicked, &dialog, [this] {
        showTextDocument(tr("Qtライブラリ交換手順"), ":/legal/QT_LGPL_COMPLIANCE.md");
    });
    connect(changelog, &QPushButton::clicked, &dialog, [this] { showLauncherChangelog(); });
    connect(privacy, &QPushButton::clicked, &dialog,
            [this] { showTextDocument(tr("プライバシーポリシー"), ":/legal/PRIVACY_POLICY.md"); });
    connect(terms, &QPushButton::clicked, &dialog,
            [this] { showTextDocument(tr("利用規約"), ":/legal/TERMS_OF_USE.md"); });
    connect(diagnostics, &QPushButton::clicked, &dialog, [this] { copyDiagnostics(); });
    if (dialog.exec() != QDialog::Accepted) {
        return;
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

// 同じQString型でもtitleとresource pathを別のUI概念として受け取る
// NOLINTNEXTLINE(bugprone-easily-swappable-parameters)
void LauncherWindow::showTextDocument(const QString& title, const QString& resourcePath) {
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

void LauncherWindow::showLauncherChangelog() {
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

void LauncherWindow::copyDiagnostics() {
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
