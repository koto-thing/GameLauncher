#include <QMouseEvent>
#include <QPainter>
#include <QPainterPath>

#include "LauncherWindow.h"

LauncherWindow::LauncherWindow(QWidget *parent) : QWidget(parent) {
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
    closeButton = new QPushButton("x", this);
    closeButton->setGeometry(width() - 40, 10, 30, 30);
    closeButton->setStyleSheet("background-color: transparent; color: white; font-weight: bold; font-size: 32px;");
    connect(closeButton, &QPushButton::clicked, this, &QWidget::close);

    // 最小化ボタン
    minimizeButton = new QPushButton("-", this);
    minimizeButton->setGeometry(width() - 80, 10, 30, 30);
    minimizeButton->setStyleSheet("background-color: transparent; color: white; font-weight: bold; font-size: 32px;");
    connect(minimizeButton, &QPushButton::clicked, this, &QWidget::showMinimized);

    // ボタンを作成
    launchButton = new QPushButton("ゲーム起動", this);
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

void LauncherWindow::mouseMoveEvent(QMouseEvent *event) {
    // 左ボタンが押されている場合にウィンドウを移動
    if ((event->buttons() & Qt::LeftButton) && m_isDragging) {
        move(event->globalPosition().toPoint() - m_dragPosition);
        event->accept();
    }
}

void LauncherWindow::mouseReleaseEvent(QMouseEvent *event) {
    m_isDragging = false;
    QWidget::mouseReleaseEvent(event);
}

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