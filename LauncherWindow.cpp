#include "LauncherWindow.h"

LauncherWindow::LauncherWindow(QWidget *parent) : QWidget(parent) {
    // ウィンドウの設定
    setWindowTitle("Game Launcher");
    resize(400, 300);

    // レイアウトを作成
    mainLayout = new QVBoxLayout(this);

    // ラベルを作成
    statusLabel = new QLabel("準備完了", this);
    statusLabel->setAlignment(Qt::AlignCenter);
    mainLayout->addWidget(statusLabel);

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