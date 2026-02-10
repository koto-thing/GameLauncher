#include "GameStoreWidget.h"
#include <QLabel>

/**
 * @brief コンストラクタ
 * @param parent 親ウィジェット
 */
GameStoreWidget::GameStoreWidget(QWidget *parent) : QWidget(parent) {
    setupUI();
}

/**
 * @brief UIのセットアップ
 */
void GameStoreWidget::setupUI() {
    // 半透明の黒背景を設定
    setStyleSheet(
        "GameStoreWidget {"
        "    background-color: rgba(0, 0, 0, 180);"
        "}"
    );

    QVBoxLayout *storeLayout = new QVBoxLayout(this);
    storeLayout->setContentsMargins(40, 40, 40, 40);
    storeLayout->setSpacing(20);

    // タイトルラベル
    QLabel *titleLabel = new QLabel("ダウンロード可能なゲーム", this);
    titleLabel->setStyleSheet("color: #ffffff; font-size: 28px; font-weight: bold; background-color: transparent;");
    storeLayout->addWidget(titleLabel);

    // ゲームカード表示エリア（スタックウィジェット）
    m_gamePageStack = new QStackedWidget(this);
    m_gamePageStack->setStyleSheet("background-color: transparent;");

    // 仮データ：合計12ゲーム（ページあたり4ゲーム表示）
    QStringList gameNames = {
        "崩壊:スターレイル", "ゼンレスゾーンゼロ", "崩壊3rd", "原神",
        "ゲーム5", "ゲーム6", "ゲーム7", "ゲーム8",
        "ゲーム9", "ゲーム10", "ゲーム11", "ゲーム12"
    };

    m_currentPage = 0;
    m_totalPages = (gameNames.size() + 3) / 4; // 4ゲームごとにページ分割

    // ページごとにウィジェットを作成
    for (int page = 0; page < m_totalPages; ++page) {
        QWidget *pageWidget = new QWidget();
        pageWidget->setStyleSheet("background-color: transparent;");
        QHBoxLayout *pageLayout = new QHBoxLayout(pageWidget);
        pageLayout->setContentsMargins(0, 0, 0, 0);
        pageLayout->setSpacing(30);

        // 1ページに4つのゲームカードを表示
        for (int i = 0; i < 4; ++i) {
            int gameIndex = page * 4 + i;
            if (gameIndex >= gameNames.size()) {
                pageLayout->addStretch();
                continue;
            }

            // ゲームカードを作成
            QWidget *gameCard = createGameCard(gameNames[gameIndex]);
            pageLayout->addWidget(gameCard);
        }

        m_gamePageStack->addWidget(pageWidget);
    }

    storeLayout->addWidget(m_gamePageStack);

    // ナビゲーションエリア
    QHBoxLayout *navLayout = new QHBoxLayout();
    navLayout->setContentsMargins(0, 20, 0, 0);

    // 左矢印ボタン
    m_prevPageBtn = new QPushButton("◀", this);
    m_prevPageBtn->setProperty("class", "PageNavButton");
    m_prevPageBtn->setFixedSize(50, 50);
    connect(m_prevPageBtn, &QPushButton::clicked, this, &GameStoreWidget::previousPage);
    navLayout->addWidget(m_prevPageBtn);

    // ページインジケーター（ドット）
    m_pageIndicatorLayout = new QHBoxLayout();
    m_pageIndicatorLayout->setSpacing(10);
    updatePageIndicators();
    navLayout->addLayout(m_pageIndicatorLayout);

    // 右矢印ボタン
    m_nextPageBtn = new QPushButton("▶", this);
    m_nextPageBtn->setProperty("class", "PageNavButton");
    m_nextPageBtn->setFixedSize(50, 50);
    connect(m_nextPageBtn, &QPushButton::clicked, this, &GameStoreWidget::nextPage);
    navLayout->addWidget(m_nextPageBtn);

    storeLayout->addLayout(navLayout);

    // 初期状態の更新
    updateNavigationButtons();
}

/**
 * @brief ゲームカードを作成
 */
QWidget* GameStoreWidget::createGameCard(const QString& gameName) {
    QWidget *gameCard = new QWidget();
    gameCard->setFixedSize(240, 360);
    gameCard->setStyleSheet("background-color: transparent;");

    QVBoxLayout *cardLayout = new QVBoxLayout(gameCard);
    cardLayout->setContentsMargins(0, 0, 0, 0);
    cardLayout->setSpacing(12);

    // サムネイル画像
    QLabel *thumbnail = new QLabel();
    thumbnail->setProperty("class", "GameCardThumbnail");
    thumbnail->setFixedSize(240, 240);
    thumbnail->setAlignment(Qt::AlignCenter);

    QPixmap pixmap(":/images/launcher_background_placeholder.png");
    if (!pixmap.isNull()) {
        thumbnail->setPixmap(pixmap.scaled(240, 240, Qt::KeepAspectRatioByExpanding, Qt::SmoothTransformation));
        thumbnail->setScaledContents(false);
    } else {
        thumbnail->setText(gameName);
    }
    cardLayout->addWidget(thumbnail);

    // ゲームタイトル
    QLabel *gameTitle = new QLabel(gameName);
    gameTitle->setProperty("class", "GameCardTitle");
    gameTitle->setAlignment(Qt::AlignLeft);
    cardLayout->addWidget(gameTitle);

    // ダウンロードボタン
    QPushButton *downloadBtn = new QPushButton("ダウンロード");
    downloadBtn->setProperty("class", "DownloadButton");
    downloadBtn->setFixedHeight(40);
    cardLayout->addWidget(downloadBtn);


    return gameCard;
}

/**
 * @brief 前のページに移動
 */
void GameStoreWidget::previousPage() {
    if (m_currentPage > 0) {
        m_currentPage--;
        m_gamePageStack->setCurrentIndex(m_currentPage);
        updateNavigationButtons();
        updatePageIndicators();
    }
}

/**
 * @brief 次のページに移動
 */
void GameStoreWidget::nextPage() {
    if (m_currentPage < m_totalPages - 1) {
        m_currentPage++;
        m_gamePageStack->setCurrentIndex(m_currentPage);
        updateNavigationButtons();
        updatePageIndicators();
    }
}

/**
 * @brief ナビゲーションボタンの状態を更新
 */
void GameStoreWidget::updateNavigationButtons() {
    m_prevPageBtn->setEnabled(m_currentPage > 0);
    m_nextPageBtn->setEnabled(m_currentPage < m_totalPages - 1);
}

/**
 * @brief ページインジケーターを更新
 */
void GameStoreWidget::updatePageIndicators() {
    // 既存のインジケーターをクリア
    QLayoutItem *item;
    while ((item = m_pageIndicatorLayout->takeAt(0)) != nullptr) {
        delete item->widget();
        delete item;
    }

    // 新しいインジケーターを作成
    for (int i = 0; i < m_totalPages; ++i) {
        QLabel *dot = new QLabel();
        dot->setFixedSize(12, 12);

        if (i == m_currentPage) {
            // アクティブなページ
            dot->setProperty("class", "PageIndicatorActive");
        } else {
            // 非アクティブなページ
            dot->setProperty("class", "PageIndicatorInactive");
        }

        m_pageIndicatorLayout->addWidget(dot);
    }
}

