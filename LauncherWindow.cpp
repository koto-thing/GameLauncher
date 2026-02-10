#include <QMouseEvent>
#include <QPainter>
#include <QPainterPath>
#include <QFile>
#include <QGridLayout>
#include <QFrame>

#include "LauncherWindow.h"
#include "GameListFactory.h"
#include "GameStoreWidget.h"
#include "GameDetailsWidget.h"
/**
 * @brief コンストラクタ
 * @param parent 親ウィジェット
 */
LauncherWindow::LauncherWindow(QWidget *parent) : QWidget(parent) {
    setupUI();
}

/**
 * @brief マウス押下イベントハンドラ
 * @param event マウスイベント
 */
void LauncherWindow::mousePressEvent(QMouseEvent *event) {
    // 左ボタンが押された場合にドラッグ開始位置を記録
    if (event->button() == Qt::LeftButton) {
        // タイトルバー部分でのみドラッグを有効にする
        if (event->position().y() <= TITLE_BAR_HEIGHT) {
            m_dragPosition = event->globalPosition().toPoint() - frameGeometry().topLeft();
            m_isDragging = true;
            event->accept();
        }
    }
}

/**
 * @brief マウス移動イベントハンドラ
 * @param event マウスイベント
 */
void LauncherWindow::mouseMoveEvent(QMouseEvent *event) {
    // 左ボタンが押されている場合にウィンドウを移動
    if ((event->buttons() & Qt::LeftButton) && m_isDragging) {
        move(event->globalPosition().toPoint() - m_dragPosition);
        event->accept();
    }
}

/**
 * @brief マウスリリースイベントハンドラ
 * @param event マウスイベント
 */
void LauncherWindow::mouseReleaseEvent(QMouseEvent *event) {
    m_isDragging = false;
    QWidget::mouseReleaseEvent(event);
}

/**
 * @brief ペイントイベントハンドラ
 * @param event ペイントイベント
 */
void LauncherWindow::paintEvent(QPaintEvent *event) {
    QPainter painter(this);

    // アンチエイリアスを有効にする
    painter.setRenderHint(QPainter::Antialiasing);

    // 角丸矩形のパスを作成
    QPainterPath path;
    path.addRoundedRect(rect(), 20, 20);

    // クリッピングを設定
    painter.setClipPath(path);

    // 背景画像を描画
    const QPixmap background(":/images/launcher_background_placeholder.png");
    painter.drawPixmap(rect(), background);
}

/**
 * @brief リサイズイベントハンドラ
 * @param event リサイズイベント
 */
void LauncherWindow::resizeEvent(QResizeEvent *event) {
    QWidget::resizeEvent(event);

    // オプション画面が開いているなら、サイズを追従させる
    if (m_optionOverlay) {
        m_optionOverlay->resize(this->size());
    }
}

/**
 * @brief スタイルシートを読み込んでウィジェットに適用するヘルパー関数
 * @param widget スタイルシートを適用するウィジェット
 * @param filePath スタイルシートファイルのパス
 */
void LauncherWindow::loadStyleSheet(QWidget *widget, const QString& filePath) {
    if (QFile file(filePath); file.open(QIODevice::ReadOnly | QIODevice::Text)) {
        widget->setStyleSheet(file.readAll());
        file.close();
    } else {
        qDebug() << "Error: Could not open stylesheet file:" << filePath;
    }
}

/**
 * @brief UIのセットアップ
 */
void LauncherWindow::setupUI() {
    // スタイルシートを適用
    loadStyleSheet(this, ":/styles/mainWindow.qss");

    // ウィンドウの設定
    setWindowTitle("Game Launcher");
    setWindowFlags(Qt::FramelessWindowHint);
    setAttribute(Qt::WA_TranslucentBackground);

    resize(1280, 720);

    // レイアウトを作成
    mainLayout = new QHBoxLayout(this);
    mainLayout->setContentsMargins(0, 0, 0, 0);
    mainLayout->setSpacing(0);

    /* ---左側のゲームリスト--- */
    gameListLayout = new QVBoxLayout;
    gameListLayout->setContentsMargins(0, 0, 0, 0);
    gameListLayout->setSpacing(0);

    // 左側の黒背景コンテナを作成
    QWidget *leftContainer = new QWidget(this);
    leftContainer->setMaximumWidth(150);
    leftContainer->setStyleSheet(
        "QWidget {"
        "    background-color: rgba(0, 0, 0, 200);"
        "    border-top-left-radius: 20px;"
        "    border-bottom-left-radius: 20px;"
        "}"
    );

    QVBoxLayout *leftContainerLayout = new QVBoxLayout(leftContainer);
    leftContainerLayout->setContentsMargins(0, 0, 0, 0);
    leftContainerLayout->setSpacing(0);

    // ゲーム追加ボタンを作成
    addGameButton = new QPushButton("+", leftContainer);
    addGameButton->setProperty("class", "AddGameButton");
    addGameButton->setFixedSize(50, 50);
    addGameButton->setStyleSheet(
        "QPushButton {"
        "    background-color: rgba(255, 255, 255, 30);"
        "    border: 2px solid rgba(255, 255, 255, 100);"
        "    border-radius: 8px;"
        "    color: #ffffff;"
        "    font-size: 24px;"
        "    font-weight: bold;"
        "}"
        "QPushButton:hover {"
        "    background-color: rgba(255, 255, 255, 50);"
        "}"
        "QPushButton:pressed {"
        "    background-color: rgba(255, 150, 0, 100);"
        "}"
    );
    connect(addGameButton, &QPushButton::clicked, this, &LauncherWindow::showGameStore);

    QHBoxLayout *addButtonLayout = new QHBoxLayout;
    addButtonLayout->setContentsMargins(10, 15, 10, 15);
    addButtonLayout->addWidget(addGameButton, 0, Qt::AlignCenter);
    leftContainerLayout->addLayout(addButtonLayout);

    // セパレーターラインを追加
    QFrame *separatorLine = new QFrame(leftContainer);
    separatorLine->setFrameShape(QFrame::HLine);
    separatorLine->setFrameShadow(QFrame::Plain);
    separatorLine->setFixedHeight(2);
    separatorLine->setStyleSheet("background-color: rgba(255, 255, 255, 50); border: none; margin: 0px 10px;");
    leftContainerLayout->addWidget(separatorLine);

    // ゲームリストウィジェットを作成
    gameListWidget = new QListWidget(leftContainer);
    gameListWidget->setProperty("class", "GameListWidget");
    gameListWidget->setVerticalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    gameListWidget->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    gameListWidget->setFocusPolicy(Qt::NoFocus);
    gameListWidget->setStyleSheet("QListWidget { background-color: transparent; border: none; }");

    // サンプルゲームアイテムを追加（セパレーター付き）
    GameListFactory::addGameItemWithWidget(gameListWidget, "ゲーム1", ":/images/placeholder_100x100.png");
    GameListFactory::addGameItemWithWidget(gameListWidget, "ゲーム2", ":/images/placeholder_100x100.png");
    GameListFactory::addGameItemWithWidget(gameListWidget, "ゲーム3", ":/images/placeholder_100x100.png");

    // ゲームリストアイテムをクリックしたらゲーム詳細画面に戻る
    connect(gameListWidget, &QListWidget::itemClicked, this, &LauncherWindow::showGameDetails);

    leftContainerLayout->addWidget(gameListWidget);

    gameListLayout->addWidget(leftContainer);
    mainLayout->addLayout(gameListLayout);

    /* ---画面右側--- */
    rightLayout = new QVBoxLayout();
    rightLayout->setContentsMargins(0, 0, 0, 0);
    rightLayout->setSpacing(0);

    // スタックウィジェットを作成（画面切り替え用）
    contentStack = new QStackedWidget(this);

    // ゲーム詳細画面を作成
    m_gameDetailsView = new GameDetailsWidget(this);
    contentStack->addWidget(m_gameDetailsView);

    // ゲームストア画面を作成
    m_gameStoreView = new GameStoreWidget(this);
    contentStack->addWidget(m_gameStoreView);

    rightLayout->addWidget(contentStack);
    mainLayout->addLayout(rightLayout);

    /* ---画面上部右側--- */
    // 閉じるボタン
    m_closeButton = new QPushButton("x", this);
    m_closeButton->setProperty("class", "CloseButton");
    m_closeButton->setGeometry(width() - 40, 10, 30, 30);
    connect(m_closeButton, &QPushButton::clicked, this, &QWidget::close);

    // 最小化ボタン
    m_minimizeButton = new QPushButton("-", this);
    m_minimizeButton->setProperty("class", "MinimizeButton");
    m_minimizeButton->setGeometry(width() - 80, 10, 30, 30);
    connect(m_minimizeButton, &QPushButton::clicked, this, &QWidget::showMinimized);

    // オプションボタン
    m_optionButton = new QPushButton("⚙", this);
    m_optionButton->setProperty("class", "OptionButton");
    m_optionButton->setGeometry(width() - 120, 10, 30, 30);

    /* ---オプション関連--- */
    m_optionOverlay = new OptionOverlay(this);
    connect(m_optionButton, &QPushButton::clicked, this, [this]() {
        m_optionOverlay->raise();
        m_optionOverlay->resize(this->size());
        m_optionOverlay->show();
    });

    // GameRunnerのインスタンスを作成
    m_runner = new GameRunner(this);
    m_runner->setGamePath("C:/Windows/System32/notepad.exe");

    // GameDetailsWidgetにGameRunnerを設定
    m_gameDetailsView->setGameRunner(m_runner);
}

/**
 * @brief ゲーム詳細画面を表示
 */
void LauncherWindow::showGameDetails() {
    contentStack->setCurrentWidget(m_gameDetailsView);
}

/**
 * @brief ゲームストア画面を表示
 */
void LauncherWindow::showGameStore() {
    contentStack->setCurrentWidget(m_gameStoreView);
}

