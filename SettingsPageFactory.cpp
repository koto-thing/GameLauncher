#include <QCheckBox>
#include <QRadioButton>
#include <QButtonGroup>
#include <QComboBox>
#include <QLineEdit>
#include <QPushButton>
#include <QVBoxLayout>

#include "SettingsPageFactory.h"
#include "SettingsManager.h"

/**
 * @brief 推奨タグラベルを作成
 * @return 推奨タグラベル
 */
QWidget* SettingsPageFactory::createGeneralSettingsPage(SettingsManager* settings) {
    QWidget *page = new QWidget();
    page->setStyleSheet("background-color: transparent;");

    QVBoxLayout *layout = new QVBoxLayout(page);
    layout->setAlignment(Qt::AlignTop);
    layout->setSpacing(10);
    layout->setContentsMargins(20, 20, 20, 20);

    // タイトルラベル
    QLabel *title = new QLabel("一般", page);
    title->setStyleSheet("font-size: 20px; font-weight: bold; margin-bottom: 10px; color: #ffffff; background-color: transparent;");
    layout->addWidget(title);

    /* ---クライアント言語設定--- */
    QLabel *header1 = new QLabel("クライアント言語", page);
    header1->setProperty("class", "SectionHeader");
    layout->addWidget(header1);

    QWidget *group1 = new QWidget(page);
    group1->setObjectName("group1");
    group1->setStyleSheet("#group1 { background-color: #2a2a2a; border-radius: 6px; }");
    QHBoxLayout *group1Layout = new QHBoxLayout(group1);
    group1Layout->setContentsMargins(18, 15, 18, 15);

    QLabel *langLabel = new QLabel("言語選択");
    langLabel->setStyleSheet("background-color: transparent; color: #ffffff;");
    group1Layout->addWidget(langLabel);
    group1Layout->addStretch();

    QComboBox *langCombo = new QComboBox();
    langCombo->addItem("日本語");
    langCombo->addItem("English");
    langCombo->setCurrentText(settings->language());
    langCombo->setCursor(Qt::PointingHandCursor);
    QObject::connect(langCombo, &QComboBox::currentTextChanged, settings, [settings](const QString& text) {
        settings->setLanguage(text);
        settings->saveSettings();
    });
    group1Layout->addWidget(langCombo);

    layout->addWidget(group1);

    /* ---スタートアップ設定--- */
    QLabel *header2 = new QLabel("スタートアップ設定", page);
    header2->setProperty("class", "SectionHeader");
    layout->addWidget(header2);

    QWidget *group2 = new QWidget(page);
    group2->setObjectName("group2");
    group2->setStyleSheet("#group2 { background-color: #2a2a2a; border-radius: 6px; }");
    QVBoxLayout *group2Layout = new QVBoxLayout(group2);
    group2Layout->setContentsMargins(18, 15, 18, 15);
    group2Layout->setSpacing(0);

    // PC起動時自動実行
    QHBoxLayout *row1 = new QHBoxLayout();
    row1->setContentsMargins(0, 0, 0, 0);

    QLabel *lblAutoRun = new QLabel("PC起動時、自動的にランチャーを実行する");
    lblAutoRun->setStyleSheet("background-color: transparent; color: #ffffff;");
    row1->addWidget(lblAutoRun);
    row1->addWidget(createRecommendTag());
    row1->addStretch();

    QCheckBox *swAutoRun = new QCheckBox();
    swAutoRun->setProperty("class", "ToggleSwitch");
    swAutoRun->setChecked(settings->autoRunOnStartup());
    swAutoRun->setCursor(Qt::PointingHandCursor);
    QObject::connect(swAutoRun, &QCheckBox::toggled, settings, [settings](bool checked) {
        settings->setAutoRunOnStartup(checked);
        settings->saveSettings();
    });
    row1->addWidget(swAutoRun);

    group2Layout->addLayout(row1);

    // 区切り線
    group2Layout->addSpacing(15);
    group2Layout->addWidget(createSeparator());
    group2Layout->addSpacing(15);

    // 終了時表示
    QHBoxLayout *row2 = new QHBoxLayout();
    row2->setContentsMargins(0, 0, 0, 0);

    QLabel *lblShowLauncher = new QLabel("ゲームを終了すると、ランチャー画面が自動的に表示される");
    lblShowLauncher->setStyleSheet("background-color: transparent; color: #ffffff;");
    row2->addWidget(lblShowLauncher);
    row2->addStretch();

    QCheckBox *swShowLauncher = new QCheckBox();
    swShowLauncher->setProperty("class", "ToggleSwitch");
    swShowLauncher->setChecked(settings->showLauncherAfterGameExit());
    swShowLauncher->setCursor(Qt::PointingHandCursor);
    QObject::connect(swShowLauncher, &QCheckBox::toggled, settings, [settings](bool checked) {
        settings->setShowLauncherAfterGameExit(checked);
        settings->saveSettings();
    });
    row2->addWidget(swShowLauncher);

    group2Layout->addLayout(row2);
    layout->addWidget(group2);

    /* ---終了設定--- */
    QLabel *header3 = new QLabel("終了設定", page);
    header3->setProperty("class", "SectionHeader");
    layout->addWidget(header3);

    QWidget *group3 = new QWidget(page);
    group3->setObjectName("group3");
    group3->setStyleSheet("#group3 { background-color: #2a2a2a; border-radius: 6px; }");
    QVBoxLayout *group3Layout = new QVBoxLayout(group3);
    group3Layout->setContentsMargins(18, 15, 18, 15);
    group3Layout->setSpacing(12);

    // サブタイトル
    QLabel *subHeader = new QLabel("ウィンドウを閉じる");
    subHeader->setStyleSheet("color: #888888; font-size: 12px; background-color: transparent;");
    group3Layout->addWidget(subHeader);

    QButtonGroup *closeBtnGroup = new QButtonGroup(page);

    // ラジオ1: 最小化
    QHBoxLayout *radioRow1 = new QHBoxLayout();
    radioRow1->setContentsMargins(0, 0, 0, 0);

    QRadioButton *radioMin = new QRadioButton("ウィンドウを最小化する");
    radioMin->setStyleSheet("background-color: transparent;");
    radioMin->setChecked(settings->windowCloseAction() == SettingsManager::WindowCloseAction::Minimize);
    radioMin->setCursor(Qt::PointingHandCursor);
    closeBtnGroup->addButton(radioMin, 0);
    radioRow1->addWidget(radioMin);
    radioRow1->addWidget(createRecommendTag());
    radioRow1->addStretch();
    group3Layout->addLayout(radioRow1);

    // ラジオ2: 閉じる
    QHBoxLayout *radioRow2 = new QHBoxLayout();
    radioRow2->setContentsMargins(0, 0, 0, 0);

    QRadioButton *radioClose = new QRadioButton("ランチャーを閉じる");
    radioClose->setStyleSheet("background-color: transparent;");
    radioClose->setChecked(settings->windowCloseAction() == SettingsManager::WindowCloseAction::Close);
    radioClose->setCursor(Qt::PointingHandCursor);
    closeBtnGroup->addButton(radioClose, 1);
    radioRow2->addWidget(radioClose);
    radioRow2->addStretch();
    group3Layout->addLayout(radioRow2);

    QObject::connect(closeBtnGroup, QOverload<int>::of(&QButtonGroup::idClicked), settings, [settings](int id) {
        settings->setWindowCloseAction(id == 0 ? SettingsManager::WindowCloseAction::Minimize : SettingsManager::WindowCloseAction::Close);
        settings->saveSettings();
    });

    layout->addWidget(group3);

    /* ---自動アップデート設定--- */
    QLabel *header4 = new QLabel("自動アップデート設定", page);
    header4->setProperty("class", "SectionHeader");
    layout->addWidget(header4);

    QWidget *group4 = new QWidget(page);
    group4->setObjectName("group4");
    group4->setStyleSheet("#group4 { background-color: #2a2a2a; border-radius: 6px; }");
    QHBoxLayout *group4Layout = new QHBoxLayout(group4);
    group4Layout->setContentsMargins(18, 15, 18, 15);

    QLabel *updateLabel = new QLabel("自動アップデートを有効にする");
    updateLabel->setStyleSheet("background-color: transparent; color: #ffffff;");
    group4Layout->addWidget(updateLabel);
    group4Layout->addStretch();

    QCheckBox *swAutoUpdate = new QCheckBox();
    swAutoUpdate->setProperty("class", "ToggleSwitch");
    swAutoUpdate->setChecked(settings->autoUpdateEnabled());
    swAutoUpdate->setCursor(Qt::PointingHandCursor);
    QObject::connect(swAutoUpdate, &QCheckBox::toggled, settings, [settings](bool checked) {
        settings->setAutoUpdateEnabled(checked);
        settings->saveSettings();
    });
    group4Layout->addWidget(swAutoUpdate);

    layout->addWidget(group4);

    layout->addStretch();
    return page;
}

/**
 * @brief ダウンロード設定ページを作成
 * @param settings 設定マネージャー
 * @return ダウンロード設定ページのウィジェット
 */
QWidget* SettingsPageFactory::createDownloadSettingsPage(SettingsManager* settings) {
    QWidget *page = new QWidget();
    page->setStyleSheet("background-color: transparent;");

    QVBoxLayout *layout = new QVBoxLayout(page);
    layout->setAlignment(Qt::AlignTop);
    layout->setSpacing(10);
    layout->setContentsMargins(20, 20, 20, 20);

    /* ---タイトル--- */
    QLabel *title = new QLabel("ダウンロード", page);
    title->setStyleSheet("font-size: 20px; font-weight: bold; margin-bottom: 10px; color: #ffffff; background-color: transparent;");
    layout->addWidget(title);

    /* ---ダウンロード速度--- */
    QLabel *header1 = new QLabel("ダウンロード速度", page);
    header1->setProperty("class", "SectionHeader");
    layout->addWidget(header1);

    QWidget *group1 = new QWidget(page);
    group1->setObjectName("downloadSpeedGroup");
    group1->setStyleSheet("#downloadSpeedGroup { background-color: #2a2a2a; border-radius: 6px; }");
    QVBoxLayout *group1Layout = new QVBoxLayout(group1);
    group1Layout->setContentsMargins(18, 15, 18, 15);
    group1Layout->setSpacing(12);

    // サブタイトル
    QLabel *subHeader = new QLabel("ダウンロード速度制限選択");
    subHeader->setStyleSheet("color: #888888; font-size: 12px; background-color: transparent;");
    group1Layout->addWidget(subHeader);

    QButtonGroup *speedBtnGroup = new QButtonGroup(page);

    // ラジオ1: 無制限
    QHBoxLayout *radioRow1 = new QHBoxLayout();
    radioRow1->setContentsMargins(0, 0, 0, 0);

    QRadioButton *radioUnlimited = new QRadioButton("無制限");
    radioUnlimited->setStyleSheet("background-color: transparent;");
    radioUnlimited->setChecked(settings->downloadSpeedUnlimited());
    radioUnlimited->setCursor(Qt::PointingHandCursor);
    speedBtnGroup->addButton(radioUnlimited, 0);
    radioRow1->addWidget(radioUnlimited);
    radioRow1->addStretch();
    group1Layout->addLayout(radioRow1);

    // ラジオ2: 速度上限
    QHBoxLayout *radioRow2 = new QHBoxLayout();
    radioRow2->setContentsMargins(0, 0, 0, 0);

    QRadioButton *radioLimited = new QRadioButton("速度上限");
    radioLimited->setStyleSheet("background-color: transparent;");
    radioLimited->setChecked(!settings->downloadSpeedUnlimited());
    radioLimited->setCursor(Qt::PointingHandCursor);
    speedBtnGroup->addButton(radioLimited, 1);
    radioRow2->addWidget(radioLimited);
    radioRow2->addSpacing(20);

    // 速度入力フィールド
    QLineEdit *speedInput = new QLineEdit();
    speedInput->setText(QString::number(settings->downloadSpeedLimit()));
    speedInput->setFixedWidth(100);
    speedInput->setStyleSheet(R"(
        QLineEdit {
            background-color: #1e1e1e;
            color: #ffffff;
            border: 1px solid #3a3a3a;
            border-radius: 4px;
            padding: 6px 10px;
            font-size: 13px;
        }
        QLineEdit:focus {
            border: 1px solid #555555;
        }
    )");
    QObject::connect(speedInput, &QLineEdit::textChanged, settings, [settings](const QString& text) {
        bool ok;
        int value = text.toInt(&ok);
        if (ok && value > 0) {
            settings->setDownloadSpeedLimit(value);
            settings->saveSettings();
        }
    });
    radioRow2->addWidget(speedInput);

    QLabel *unitLabel = new QLabel("KB/S");
    unitLabel->setStyleSheet("background-color: transparent; color: #888888; font-size: 13px;");
    radioRow2->addWidget(unitLabel);
    radioRow2->addStretch();

    QObject::connect(speedBtnGroup, QOverload<int>::of(&QButtonGroup::idClicked), settings, [settings](int id) {
        settings->setDownloadSpeedUnlimited(id == 0);
        settings->saveSettings();
    });

    group1Layout->addLayout(radioRow2);
    layout->addWidget(group1);

    /* ---ゲームアップデート--- */
    QLabel *header2 = new QLabel("ゲームアップデート", page);
    header2->setProperty("class", "SectionHeader");
    layout->addWidget(header2);

    QWidget *group2 = new QWidget(page);
    group2->setObjectName("gameUpdateGroup");
    group2->setStyleSheet("#gameUpdateGroup { background-color: #2a2a2a; border-radius: 6px; }");
    QVBoxLayout *group2Layout = new QVBoxLayout(group2);
    group2Layout->setContentsMargins(18, 15, 18, 15);
    group2Layout->setSpacing(8);

    // トグルスイッチ行
    QHBoxLayout *toggleRow = new QHBoxLayout();
    toggleRow->setContentsMargins(0, 0, 0, 0);

    QLabel *lblContinueDownload = new QLabel("ゲームを起動した後、ダウンロードと更新作業を続ける");
    lblContinueDownload->setStyleSheet("background-color: transparent; color: #ffffff;");
    toggleRow->addWidget(lblContinueDownload);
    toggleRow->addStretch();

    QCheckBox *swContinueDownload = new QCheckBox();
    swContinueDownload->setProperty("class", "ToggleSwitch");
    swContinueDownload->setChecked(settings->continueDownloadAfterGameStart());
    swContinueDownload->setCursor(Qt::PointingHandCursor);
    QObject::connect(swContinueDownload, &QCheckBox::toggled, settings, [settings](bool checked) {
        settings->setContinueDownloadAfterGameStart(checked);
        settings->saveSettings();
    });
    toggleRow->addWidget(swContinueDownload);

    group2Layout->addLayout(toggleRow);

    // 説明文
    QLabel *descLabel = new QLabel("これをオンにすると、ゲームを起動した後、GameLauncherは未完了のダウンロードと更新作業を続けます。ゲーム体験にある程度の影響を及ぼす恐れがございますので、ご了承ください。");
    descLabel->setWordWrap(true);
    descLabel->setStyleSheet("background-color: transparent; color: #666666; font-size: 11px; line-height: 1.4;");
    group2Layout->addWidget(descLabel);

    layout->addWidget(group2);

    layout->addStretch();
    return page;
}

/**
 * @brief ダウンロード設定ページを作成
 * @param settings 設定マネージャー
 * @return ダウンロード設定ページのウィジェット
 */
QWidget* SettingsPageFactory::createNotificationSettingsPage(SettingsManager* settings) {
    QWidget *page = new QWidget();
    page->setStyleSheet("background-color: transparent;");

    QVBoxLayout *layout = new QVBoxLayout(page);
    layout->setAlignment(Qt::AlignTop);
    layout->setSpacing(10);
    layout->setContentsMargins(20, 20, 20, 20);

    /* ---タイトル--- */
    QLabel *title = new QLabel("通知", page);
    title->setStyleSheet("font-size: 20px; font-weight: bold; margin-bottom: 10px; color: #ffffff; background-color: transparent;");
    layout->addWidget(title);

    /* ---デスクトップ通知--- */
    QWidget *group1 = new QWidget(page);
    group1->setObjectName("notificationGroup");
    group1->setStyleSheet("#notificationGroup { background-color: #2a2a2a; border-radius: 6px; }");
    QVBoxLayout *group1Layout = new QVBoxLayout(group1);
    group1Layout->setContentsMargins(18, 15, 18, 15);
    group1Layout->setSpacing(8);

    // トグルスイッチ行
    QHBoxLayout *toggleRow = new QHBoxLayout();
    toggleRow->setContentsMargins(0, 0, 0, 0);

    QLabel *lblDesktopNotification = new QLabel("デスクトップ通知を許可する");
    lblDesktopNotification->setStyleSheet("background-color: transparent; color: #ffffff;");
    toggleRow->addWidget(lblDesktopNotification);
    toggleRow->addStretch();

    QCheckBox *swDesktopNotification = new QCheckBox();
    swDesktopNotification->setProperty("class", "ToggleSwitch");
    swDesktopNotification->setChecked(settings->desktopNotificationEnabled());
    swDesktopNotification->setCursor(Qt::PointingHandCursor);
    QObject::connect(swDesktopNotification, &QCheckBox::toggled, settings, [settings](bool checked) {
        settings->setDesktopNotificationEnabled(checked);
        settings->saveSettings();
    });
    toggleRow->addWidget(swDesktopNotification);

    group1Layout->addLayout(toggleRow);

    // 説明文
    QLabel *descLabel = new QLabel("GameLauncherがデスクトップに重要なお知らせを表示することを許可します");
    descLabel->setWordWrap(true);
    descLabel->setStyleSheet("background-color: transparent; color: #666666; font-size: 11px;");
    group1Layout->addWidget(descLabel);

    layout->addWidget(group1);

    layout->addStretch();
    return page;
}

/**
 * @brief 詳細設定ページを作成
 * @return 詳細設定ページのウィジェット
 */
QWidget* SettingsPageFactory::createDescriptionSettingsPage() {
    QWidget *page = new QWidget();
    page->setStyleSheet("background-color: transparent;");

    QVBoxLayout *layout = new QVBoxLayout(page);
    layout->setAlignment(Qt::AlignTop);
    layout->setSpacing(10);
    layout->setContentsMargins(20, 20, 20, 20);

    /* ---タイトル--- */
    QLabel *title = new QLabel("詳細", page);
    title->setStyleSheet("font-size: 20px; font-weight: bold; margin-bottom: 10px; color: #ffffff; background-color: transparent;");
    layout->addWidget(title);

    /* ---バージョン情報--- */
    QWidget *versionGroup = new QWidget(page);
    versionGroup->setObjectName("versionGroup");
    versionGroup->setStyleSheet("#versionGroup { background-color: #2a2a2a; border-radius: 6px; }");
    QVBoxLayout *versionLayout = new QVBoxLayout(versionGroup);
    versionLayout->setContentsMargins(18, 15, 18, 15);
    versionLayout->setSpacing(12);

    // アイコンとバージョン情報
    QHBoxLayout *versionRow = new QHBoxLayout();
    versionRow->setSpacing(12);

    // アイコン（プレースホルダー）
    QLabel *iconLabel = new QLabel();
    iconLabel->setFixedSize(40, 40);
    iconLabel->setStyleSheet("background-color: #3a8cff; border-radius: 8px;");
    versionRow->addWidget(iconLabel);

    // GameLauncher
    QVBoxLayout *versionTextLayout = new QVBoxLayout();
    versionTextLayout->setSpacing(2);

    QLabel *appNameLabel = new QLabel("GameLauncher");
    appNameLabel->setStyleSheet("background-color: transparent; color: #ffffff; font-size: 14px; font-weight: bold;");
    versionTextLayout->addWidget(appNameLabel);

    QLabel *versionLabel = new QLabel("V1.12.0.322");
    versionLabel->setStyleSheet("background-color: transparent; color: #888888; font-size: 12px;");
    versionTextLayout->addWidget(versionLabel);

    versionRow->addLayout(versionTextLayout);
    versionRow->addStretch();

    versionLayout->addLayout(versionRow);

    // 更新履歴を確認する
    QHBoxLayout *historyRow = new QHBoxLayout();
    historyRow->setContentsMargins(0, 0, 0, 0);

    QLabel *historyLabel = new QLabel("更新履歴を確認する");
    historyLabel->setStyleSheet("background-color: transparent; color: #ffffff; font-size: 13px;");
    historyRow->addWidget(historyLabel);
    historyRow->addStretch();

    QLabel *arrowLabel1 = new QLabel(">");
    arrowLabel1->setStyleSheet("background-color: transparent; color: #666666; font-size: 13px;");
    historyRow->addWidget(arrowLabel1);

    versionLayout->addLayout(historyRow);

    // 最新バージョンをチェックする
    QHBoxLayout *checkRow = new QHBoxLayout();
    checkRow->setContentsMargins(0, 0, 0, 0);

    QLabel *checkLabel = new QLabel("最新バージョンをチェックする");
    checkLabel->setStyleSheet("background-color: transparent; color: #ffffff; font-size: 13px;");
    checkRow->addWidget(checkLabel);
    checkRow->addStretch();

    QPushButton *checkButton = new QPushButton("チェック");
    checkButton->setFixedHeight(28);
    checkButton->setCursor(Qt::PointingHandCursor);
    checkButton->setStyleSheet(R"(
        QPushButton {
            background-color: #3a3a3a;
            color: #ffffff;
            border: none;
            border-radius: 4px;
            padding: 6px 16px;
            font-size: 12px;
        }
        QPushButton:hover {
            background-color: #4a4a4a;
        }
        QPushButton:pressed {
            background-color: #2a2a2a;
        }
    )");
    checkRow->addWidget(checkButton);

    versionLayout->addLayout(checkRow);

    layout->addWidget(versionGroup);

    /* ---クライアントログ--- */
    QLabel *logHeader = new QLabel("クライアントログ", page);
    logHeader->setProperty("class", "SectionHeader");
    layout->addWidget(logHeader);

    QWidget *logGroup = new QWidget(page);
    logGroup->setObjectName("logGroup");
    logGroup->setStyleSheet("#logGroup { background-color: #2a2a2a; border-radius: 6px; }");
    QVBoxLayout *logLayout = new QVBoxLayout(logGroup);
    logLayout->setContentsMargins(18, 15, 18, 15);
    logLayout->setSpacing(12);

    // クライアントログを確認する
    QHBoxLayout *logViewRow = new QHBoxLayout();
    logViewRow->setContentsMargins(0, 0, 0, 0);

    QLabel *logViewLabel = new QLabel("クライアントログを確認する");
    logViewLabel->setStyleSheet("background-color: transparent; color: #ffffff; font-size: 13px;");
    logViewRow->addWidget(logViewLabel);
    logViewRow->addStretch();

    QLabel *arrowLabel2 = new QLabel(">");
    arrowLabel2->setStyleSheet("background-color: transparent; color: #666666; font-size: 13px;");
    logViewRow->addWidget(arrowLabel2);

    logLayout->addLayout(logViewRow);

    // ログをアップロードする
    QHBoxLayout *uploadRow = new QHBoxLayout();
    uploadRow->setContentsMargins(0, 0, 0, 0);

    QVBoxLayout *uploadTextLayout = new QVBoxLayout();
    uploadTextLayout->setSpacing(4);

    QLabel *uploadLabel = new QLabel("ログをアップロードする");
    uploadLabel->setStyleSheet("background-color: transparent; color: #ffffff; font-size: 13px;");
    uploadTextLayout->addWidget(uploadLabel);

    QLabel *uploadDesc = new QLabel("ログはトラブルシューティングのためのみ使用され、また個人情報は記録されません");
    uploadDesc->setWordWrap(true);
    uploadDesc->setStyleSheet("background-color: transparent; color: #666666; font-size: 11px;");
    uploadTextLayout->addWidget(uploadDesc);

    uploadRow->addLayout(uploadTextLayout);
    uploadRow->addStretch();

    QPushButton *uploadButton = new QPushButton("アップロード");
    uploadButton->setFixedHeight(28);
    uploadButton->setCursor(Qt::PointingHandCursor);
    uploadButton->setStyleSheet(R"(
        QPushButton {
            background-color: #3a3a3a;
            color: #ffffff;
            border: none;
            border-radius: 4px;
            padding: 6px 16px;
            font-size: 12px;
        }
        QPushButton:hover {
            background-color: #4a4a4a;
        }
        QPushButton:pressed {
            background-color: #2a2a2a;
        }
    )");
    uploadRow->addWidget(uploadButton, 0, Qt::AlignTop);

    logLayout->addLayout(uploadRow);

    layout->addWidget(logGroup);

    layout->addStretch();
    return page;
}

/**
 * @brief 推奨タグラベルを作成
 * @return 推奨タグラベル
 */
QLabel* SettingsPageFactory::createRecommendTag() {
    QLabel *tag = new QLabel("オススメ");
    tag->setProperty("class", "RecommendTag");
    return tag;
}

/**
 * @brief 区切り線を作成
 * @return 区切り線のQFrame
 */
QFrame* SettingsPageFactory::createSeparator() {
    QFrame *line = new QFrame();
    line->setProperty("class", "SeparatorLine");
    line->setFrameShape(QFrame::HLine);
    line->setFrameShadow(QFrame::Sunken);
    return line;
}

