#include "GameStoreWidget.h"
#include <QLabel>
#include <QPixmap>

GameStoreWidget::GameStoreWidget(QWidget *parent) : QWidget(parent) {
    setupUI();
}

void GameStoreWidget::setupUI() {
    setStyleSheet("GameStoreWidget { background-color: rgba(0, 0, 0, 180); }");

    QVBoxLayout *storeLayout = new QVBoxLayout(this);
    storeLayout->setContentsMargins(40, 40, 40, 40);
    storeLayout->setSpacing(20);

    QLabel *titleLabel = new QLabel("ダウンロード可能なゲーム", this);
    titleLabel->setStyleSheet("color: #ffffff; font-size: 28px; font-weight: bold; background-color: transparent;");
    storeLayout->addWidget(titleLabel);

    m_gamePageStack = new QStackedWidget(this);
    m_gamePageStack->setStyleSheet("background-color: transparent;");

    QStringList gameNames = {
        "崩壊:スターレイル", "ゼンレスゾーンゼロ", "崩壊3rd", "原神",
        "ゲーム5", "ゲーム6", "ゲーム7", "ゲーム8",
        "ゲーム9", "ゲーム10", "ゲーム11", "ゲーム12"
    };

    m_currentPage = 0;
    m_totalPages = (gameNames.size() + 3) / 4;

    for (int page = 0; page < m_totalPages; ++page) {
        QWidget *pageWidget = new QWidget();
        pageWidget->setStyleSheet("background-color: transparent;");
        QHBoxLayout *pageLayout = new QHBoxLayout(pageWidget);
        pageLayout->setContentsMargins(0, 0, 0, 0);
        pageLayout->setSpacing(30);

        for (int i = 0; i < 4; ++i) {
            int gameIndex = page * 4 + i;
            if (gameIndex >= gameNames.size()) {
                pageLayout->addStretch();
                continue;
            }
            pageLayout->addWidget(createGameCard(gameNames[gameIndex]));
        }
        m_gamePageStack->addWidget(pageWidget);
    }
    storeLayout->addWidget(m_gamePageStack);

    QHBoxLayout *navLayout = new QHBoxLayout();
    m_prevPageBtn = new QPushButton("◀", this);
    m_prevPageBtn->setFixedSize(50, 50);
    connect(m_prevPageBtn, &QPushButton::clicked, this, &GameStoreWidget::previousPage);
    navLayout->addWidget(m_prevPageBtn);

    m_pageIndicatorLayout = new QHBoxLayout();
    m_pageIndicatorLayout->setSpacing(10);
    updatePageIndicators();
    navLayout->addLayout(m_pageIndicatorLayout);

    m_nextPageBtn = new QPushButton("▶", this);
    m_nextPageBtn->setFixedSize(50, 50);
    connect(m_nextPageBtn, &QPushButton::clicked, this, &GameStoreWidget::nextPage);
    navLayout->addWidget(m_nextPageBtn);

    storeLayout->addLayout(navLayout);
    updateNavigationButtons();
}

QWidget* GameStoreWidget::createGameCard(const QString& gameName) {
    QWidget *gameCard = new QWidget();
    gameCard->setFixedSize(240, 360);
    gameCard->setStyleSheet("background-color: transparent;");

    QVBoxLayout *cardLayout = new QVBoxLayout(gameCard);
    cardLayout->setContentsMargins(0, 0, 0, 0);
    cardLayout->setSpacing(12);

    QLabel *thumbnail = new QLabel();
    thumbnail->setFixedSize(240, 240);
    thumbnail->setAlignment(Qt::AlignCenter);
    QPixmap pixmap(":/images/launcher_background_placeholder.png");
    if (!pixmap.isNull()) {
        thumbnail->setPixmap(pixmap.scaled(240, 240, Qt::KeepAspectRatioByExpanding, Qt::SmoothTransformation));
    } else {
        thumbnail->setText(gameName);
    }
    cardLayout->addWidget(thumbnail);

    QLabel *gameTitle = new QLabel(gameName);
    gameTitle->setStyleSheet("color: white; font-weight: bold;");
    cardLayout->addWidget(gameTitle);

    QPushButton *downloadBtn = new QPushButton("ダウンロード");
    downloadBtn->setFixedHeight(40);
    cardLayout->addWidget(downloadBtn);

    return gameCard;
}

void GameStoreWidget::previousPage() {
    if (m_currentPage > 0) {
        m_currentPage--;
        m_gamePageStack->setCurrentIndex(m_currentPage);
        updateNavigationButtons();
        updatePageIndicators();
    }
}

void GameStoreWidget::nextPage() {
    if (m_currentPage < m_totalPages - 1) {
        m_currentPage++;
        m_gamePageStack->setCurrentIndex(m_currentPage);
        updateNavigationButtons();
        updatePageIndicators();
    }
}

void GameStoreWidget::updateNavigationButtons() {
    m_prevPageBtn->setEnabled(m_currentPage > 0);
    m_nextPageBtn->setEnabled(m_currentPage < m_totalPages - 1);
}

void GameStoreWidget::updatePageIndicators() {
    QLayoutItem *item;
    while ((item = m_pageIndicatorLayout->takeAt(0)) != nullptr) {
        delete item->widget();
        delete item;
    }

    for (int i = 0; i < m_totalPages; ++i) {
        QLabel *dot = new QLabel();
        dot->setFixedSize(12, 12);
        if (i == m_currentPage) {
            dot->setStyleSheet("background-color: white; border-radius: 6px;");
        } else {
            dot->setStyleSheet("background-color: gray; border-radius: 6px;");
        }
        m_pageIndicatorLayout->addWidget(dot);
    }
}
