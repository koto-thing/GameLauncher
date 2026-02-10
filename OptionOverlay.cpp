#include <QLabel>
#include <QMouseEvent>
#include <QCheckBox>
#include <QRadioButton>
#include <QButtonGroup>
#include <QComboBox>
#include <QHBoxLayout>
#include <QDebug>
#include <QFile>
#include <QScrollArea>

#include "OptionOverlay.h"
#include "SettingsPageFactory.h"
#include "SettingsManager.h"

/**
 * @brief コンストラクタ
 * @param parent 親ウィジェット
 */
OptionOverlay::OptionOverlay(QWidget *parent) : QWidget(parent) {
    // 初期状態では非表示にする
    hide();

    // 背景色を半透明の黒に設定
    setStyleSheet("background-color: rgba(0, 0, 0, 180)");

    // UIのセットアップ
    setupUI();
}

/**
 * @brief マウスプレスイベントハンドラ
 * @param event マウスイベント
 */
void OptionOverlay::mousePressEvent(QMouseEvent *event) {
    event->accept();
}

/**
 * @brief スタイルシートを読み込んでウィジェットに適用するヘルパー関数
 * @param widget スタイルシートを適用するウィジェット
 * @param filePath スタイルシートファイルのパス
 */
void OptionOverlay::loadStyleSheet(QWidget *widget, const QString& filePath) {
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
void OptionOverlay::setupUI() {
    // 全体のレイアウト
    QVBoxLayout *mainLayout = new QVBoxLayout(this);
    mainLayout->setAlignment(Qt::AlignCenter);        // 中央揃え

    // 中央パネル
    m_panel = new QWidget(this);
    m_panel->setFixedSize(800, 600);
    m_panel->setObjectName("OptionPanel");
    m_panel->setAttribute(Qt::WA_StyledBackground, true);
    loadStyleSheet(m_panel, ":/styles/optionPanel.qss");

    mainLayout->addWidget(m_panel);

    /* ---パネル内部--- */
    QHBoxLayout *panelLayout = new QHBoxLayout(m_panel);
    panelLayout->setContentsMargins(0, 0, 0, 0);
    panelLayout->addSpacing(0);

    // 左側のカテゴリ
    m_categoryList = new QListWidget(m_panel);
    m_categoryList->setFixedWidth(200);
    m_categoryList->addItem("一般");
    m_categoryList->addItem("ダウンロード");
    m_categoryList->addItem("通知");
    m_categoryList->addItem("詳細");

    panelLayout->addWidget(m_categoryList);

    // 右側の詳細設定エリア
    QWidget *rightContainer = new QWidget(m_panel);
    rightContainer->setStyleSheet("background-color: #1e1e1e; border-top-right-radius: 12px; border-bottom-right-radius: 12px;");
    QVBoxLayout *rightLayout = new QVBoxLayout(rightContainer);
    rightLayout->setContentsMargins(0, 0, 0, 0);

    // ヘッダー部分（設定タイトルと閉じるボタン）
    QHBoxLayout *headerLayout = new QHBoxLayout();
    headerLayout->setContentsMargins(20, 15, 15, 10);

    QLabel *settingsLabel = new QLabel("設定");
    settingsLabel->setStyleSheet("color: #888888; font-size: 14px; font-weight: normal; background-color: transparent;");
    headerLayout->addWidget(settingsLabel);
    headerLayout->addStretch();

    m_closeButton = new QPushButton("×", rightContainer);
    m_closeButton->setFixedSize(30, 30);
    m_closeButton->setCursor(Qt::PointingHandCursor);
    m_closeButton->setStyleSheet("background-color: transparent; color: #888888; font-weight: bold; font-size: 20px; border: none;");
    connect(m_closeButton, &QPushButton::clicked, this, &QWidget::hide);
    headerLayout->addWidget(m_closeButton);

    rightLayout->addLayout(headerLayout);

    // スクロールエリアを追加
    QScrollArea *scrollArea = new QScrollArea(rightContainer);
    scrollArea->setWidgetResizable(true);
    scrollArea->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    scrollArea->setVerticalScrollBarPolicy(Qt::ScrollBarAsNeeded);
    scrollArea->setFrameShape(QFrame::NoFrame);
    scrollArea->setStyleSheet("QScrollArea { background-color: transparent; border: none; }");

    // ページ切り替え部分
    m_contentStack = new QStackedWidget();

    // SettingsManagerのインスタンスを取得
    SettingsManager* settings = SettingsManager::instance();

    // 各ページを追加
    m_contentStack->addWidget(SettingsPageFactory::createGeneralSettingsPage(settings));
    m_contentStack->addWidget(SettingsPageFactory::createDownloadSettingsPage(settings));
    m_contentStack->addWidget(SettingsPageFactory::createNotificationSettingsPage(settings));
    m_contentStack->addWidget(SettingsPageFactory::createDescriptionSettingsPage());

    scrollArea->setWidget(m_contentStack);
    rightLayout->addWidget(scrollArea);
    panelLayout->addWidget(rightContainer);

    connect(m_categoryList, &QListWidget::currentRowChanged, m_contentStack, &QStackedWidget::setCurrentIndex);

    // 最初に一番上の項目を選択状態にする
    m_categoryList->setCurrentRow(0);
}