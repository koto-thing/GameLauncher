#include "GameDetailsWidget.h"

GameDetailsWidget::GameDetailsWidget(QWidget *parent) : QWidget(parent) {
    setupUI();
}

void GameDetailsWidget::setupUI() {
    setStyleSheet("GameDetailsWidget { background-color: transparent; }");

    QVBoxLayout *detailsLayout = new QVBoxLayout(this);
    detailsLayout->setContentsMargins(20, 20, 20, 20);
    detailsLayout->setSpacing(10);

    m_statusLabel = new QLabel("準備完了", this);
    m_statusLabel->setAlignment(Qt::AlignCenter);
    detailsLayout->addWidget(m_statusLabel);

    detailsLayout->addStretch();

    m_launchButton = new QPushButton("ゲーム起動", this);
    m_launchButton->setMinimumHeight(50);
    m_launchButton->setMinimumWidth(600);
    m_launchButton->setMaximumWidth(800);
    detailsLayout->addWidget(m_launchButton, 0, Qt::AlignBottom | Qt::AlignLeft);

    connect(m_launchButton, &QPushButton::clicked, this, &GameDetailsWidget::handleLaunchClicked);
}

void GameDetailsWidget::setGameRunner(IGameRunner *runner) {
    m_runner = runner;
    if (m_runner) {
        m_runner->onStatusChanged([this](const std::string& status) {
            updateStatus(status);
        });
        m_statusLabel->setText(QString::fromStdString(m_runner->getStatus()));
    }
}

void GameDetailsWidget::handleLaunchClicked() {
    if (m_runner) {
        m_runner->launchGame();
    }
}

void GameDetailsWidget::updateStatus(const std::string& status) {
    m_statusLabel->setText(QString::fromStdString(status));
}
