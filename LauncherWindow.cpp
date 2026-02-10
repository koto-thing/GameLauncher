#include <QMouseEvent>
#include <QPainter>
#include <QPainterPath>
#include <QFile>

#include "LauncherWindow.h"

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
    mainLayout = new QVBoxLayout(this);

    // ラベルを作成
    statusLabel = new QLabel("準備完了", this);
    statusLabel->setAlignment(Qt::AlignCenter);
    mainLayout->addWidget(statusLabel);

    // 閉じるボタン
    m_closeButton = new QPushButton("x", this);
    m_closeButton->setGeometry(width() - 40, 10, 30, 30);
    m_closeButton->setStyleSheet("background-color: transparent; color: white; font-weight: bold; font-size: 32px;");
    connect(m_closeButton, &QPushButton::clicked, this, &QWidget::close);

    // 最小化ボタン
    m_minimizeButton = new QPushButton("-", this);
    m_minimizeButton->setGeometry(width() - 80, 10, 30, 30);
    m_minimizeButton->setStyleSheet("background-color: transparent; color: white; font-weight: bold; font-size: 32px;");
    connect(m_minimizeButton, &QPushButton::clicked, this, &QWidget::showMinimized);

    // オプションボタン
    m_optionButton = new QPushButton("⚙", this);
    m_optionButton->setGeometry(width() - 120, 10, 30, 30);
    m_optionButton->setStyleSheet("background-color: transparent; color: white; font-weight: bold; font-size: 16px;");

    /* ---オプション関連--- */
    m_optionOverlay = new OptionOverlay(this);
    connect(m_optionButton, &QPushButton::clicked, this, [this]() {
        m_optionOverlay->raise();
        m_optionOverlay->resize(this->size());
        m_optionOverlay->show();
    });

    // ボタンを作成
    launchButton = new QPushButton("ゲーム起動", this);
    launchButton->setProperty("class", "LaunchButton");
    mainLayout->addWidget(launchButton);

    // GameRunnerのインスタンスを作成
    m_runner = new GameRunner(this);
    m_runner->setGamePath("C:/Windows/System32/notepad.exe");

    // シグナルとスロットの接続
    connect(m_runner, &GameRunner::onStatusChanged, this, [this]() {
        statusLabel->setText(m_runner->status());
    });

    // ボタンがクリックされた時にゲームを起動
    connect(launchButton, &QPushButton::clicked, m_runner, &GameRunner::launchGame);
}