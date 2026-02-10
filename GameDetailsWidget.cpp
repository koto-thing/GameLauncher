#include "GameDetailsWidget.h"

/**
 * @brief コンストラクタ
 * @param parent 親ウィジェット
 */
GameDetailsWidget::GameDetailsWidget(QWidget *parent) : QWidget(parent) {
    setupUI();
}

/**
 * @brief UIのセットアップ
 */
void GameDetailsWidget::setupUI() {
    setStyleSheet("GameDetailsWidget { background-color: transparent; }");

    QVBoxLayout *detailsLayout = new QVBoxLayout(this);
    detailsLayout->setContentsMargins(20, 20, 20, 20);
    detailsLayout->setSpacing(10);

    // ラベルを作成
    m_statusLabel = new QLabel("準備完了", this);
    m_statusLabel->setProperty("class", "StatusLabel");
    m_statusLabel->setAlignment(Qt::AlignCenter);
    detailsLayout->addWidget(m_statusLabel);

    // 上部のスペースを埋める
    detailsLayout->addStretch();

    // ボタンを作成
    m_launchButton = new QPushButton("ゲーム起動", this);
    m_launchButton->setProperty("class", "LaunchButton");
    m_launchButton->setMinimumHeight(50);
    m_launchButton->setMinimumWidth(600);
    m_launchButton->setMaximumWidth(800);
    detailsLayout->addWidget(m_launchButton, 0, Qt::AlignBottom | Qt::AlignLeft);
}

/**
 * @brief GameRunnerを設定
 * @param runner GameRunnerのインスタンス
 */
void GameDetailsWidget::setGameRunner(GameRunner *runner) {
    m_runner = runner;

    if (m_runner) {
        // シグナルとスロットの接続
        connect(m_runner, &GameRunner::onStatusChanged, this, [this]() {
            m_statusLabel->setText(m_runner->status());
        });

        // ボタンがクリックされた時にゲームを起動
        connect(m_launchButton, &QPushButton::clicked, m_runner, &GameRunner::launchGame);
    }
}

