#include "SettingsPageFactory.h"
#include <QCheckBox>
#include <QRadioButton>
#include <QButtonGroup>
#include <QComboBox>
#include <QLineEdit>
#include <QPushButton>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QFileDialog>
#include <QMessageBox>

QWidget* SettingsPageFactory::createGeneralSettingsPage(ISettingsRepository* settings) {
    QWidget *page = new QWidget();
    page->setStyleSheet("background-color: transparent;");

    QVBoxLayout *layout = new QVBoxLayout(page);
    layout->setAlignment(Qt::AlignTop);
    layout->setSpacing(10);
    layout->setContentsMargins(20, 20, 20, 20);

    QLabel *title = new QLabel("一般", page);
    title->setStyleSheet("font-size: 20px; font-weight: bold; margin-bottom: 10px; color: #ffffff; background-color: transparent;");
    layout->addWidget(title);

    QLabel *header1 = new QLabel("クライアント言語", page);
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
    langCombo->setCurrentText(QString::fromStdString(settings->getLanguage()));
    QObject::connect(langCombo, &QComboBox::currentTextChanged, [settings](const QString& text) {
        settings->setLanguage(text.toStdString());
        settings->saveSettings();
    });
    group1Layout->addWidget(langCombo);
    layout->addWidget(group1);

    QLabel *header2 = new QLabel("スタートアップ設定", page);
    layout->addWidget(header2);

    QWidget *group2 = new QWidget(page);
    group2->setObjectName("group2");
    group2->setStyleSheet("#group2 { background-color: #2a2a2a; border-radius: 6px; }");
    QVBoxLayout *group2Layout = new QVBoxLayout(group2);
    group2Layout->setContentsMargins(18, 15, 18, 15);

    QHBoxLayout *row1 = new QHBoxLayout();
    QLabel *lblAutoRun = new QLabel("PC起動時、自動的にランチャーを実行する");
    lblAutoRun->setStyleSheet("background-color: transparent; color: #ffffff;");
    row1->addWidget(lblAutoRun);
    row1->addWidget(createRecommendTag());
    row1->addStretch();

    QCheckBox *swAutoRun = new QCheckBox();
    swAutoRun->setChecked(settings->isAutoRunOnStartup());
    QObject::connect(swAutoRun, &QCheckBox::toggled, [settings](bool checked) {
        settings->setAutoRunOnStartup(checked);
        settings->saveSettings();
    });
    row1->addWidget(swAutoRun);
    group2Layout->addLayout(row1);

    group2Layout->addSpacing(15);
    group2Layout->addWidget(createSeparator());
    group2Layout->addSpacing(15);

    QHBoxLayout *row2 = new QHBoxLayout();
    QLabel *lblShowLauncher = new QLabel("ゲームを終了すると、ランチャー画面が自動的に表示される");
    lblShowLauncher->setStyleSheet("background-color: transparent; color: #ffffff;");
    row2->addWidget(lblShowLauncher);
    row2->addStretch();

    QCheckBox *swShowLauncher = new QCheckBox();
    swShowLauncher->setChecked(settings->isShowLauncherAfterGameExit());
    QObject::connect(swShowLauncher, &QCheckBox::toggled, [settings](bool checked) {
        settings->setShowLauncherAfterGameExit(checked);
        settings->saveSettings();
    });
    row2->addWidget(swShowLauncher);
    group2Layout->addLayout(row2);
    layout->addWidget(group2);

    QLabel *header3 = new QLabel("終了設定", page);
    layout->addWidget(header3);

    QWidget *group3 = new QWidget(page);
    group3->setObjectName("group3");
    group3->setStyleSheet("#group3 { background-color: #2a2a2a; border-radius: 6px; }");
    QVBoxLayout *group3Layout = new QVBoxLayout(group3);
    group3Layout->setContentsMargins(18, 15, 18, 15);
    group3Layout->setSpacing(12);

    QLabel *subHeader = new QLabel("ウィンドウを閉じる");
    subHeader->setStyleSheet("color: #888888; font-size: 12px; background-color: transparent;");
    group3Layout->addWidget(subHeader);

    QButtonGroup *closeBtnGroup = new QButtonGroup(page);
    QRadioButton *radioMin = new QRadioButton("ウィンドウを最小化する");
    radioMin->setChecked(settings->getWindowCloseAction() == WindowCloseAction::Minimize);
    closeBtnGroup->addButton(radioMin, 0);
    group3Layout->addWidget(radioMin);

    QRadioButton *radioClose = new QRadioButton("ランチャーを閉じる");
    radioClose->setChecked(settings->getWindowCloseAction() == WindowCloseAction::Close);
    closeBtnGroup->addButton(radioClose, 1);
    group3Layout->addWidget(radioClose);

    QObject::connect(closeBtnGroup, QOverload<int>::of(&QButtonGroup::idClicked), [settings](int id) {
        settings->setWindowCloseAction(id == 0 ? WindowCloseAction::Minimize : WindowCloseAction::Close);
        settings->saveSettings();
    });
    layout->addWidget(group3);

    layout->addStretch();
    return page;
}

QWidget* SettingsPageFactory::createDownloadSettingsPage(ISettingsRepository* settings) {
    QWidget *page = new QWidget();
    page->setStyleSheet("background-color: transparent;");

    QVBoxLayout *layout = new QVBoxLayout(page);
    layout->setAlignment(Qt::AlignTop);
    layout->setSpacing(10);
    layout->setContentsMargins(20, 20, 20, 20);

    QLabel *title = new QLabel("ダウンロード", page);
    title->setStyleSheet("font-size: 20px; font-weight: bold; margin-bottom: 10px; color: #ffffff; background-color: transparent;");
    layout->addWidget(title);

    QLabel *header1 = new QLabel("ダウンロード速度", page);
    layout->addWidget(header1);

    QWidget *group1 = new QWidget(page);
    group1->setObjectName("downloadSpeedGroup");
    group1->setStyleSheet("#downloadSpeedGroup { background-color: #2a2a2a; border-radius: 6px; }");
    QVBoxLayout *group1Layout = new QVBoxLayout(group1);
    group1Layout->setContentsMargins(18, 15, 18, 15);

    QButtonGroup *speedBtnGroup = new QButtonGroup(page);
    QRadioButton *radioUnlimited = new QRadioButton("無制限");
    radioUnlimited->setChecked(settings->isDownloadSpeedUnlimited());
    speedBtnGroup->addButton(radioUnlimited, 0);
    group1Layout->addWidget(radioUnlimited);

    QHBoxLayout *radioRow2 = new QHBoxLayout();
    QRadioButton *radioLimited = new QRadioButton("速度上限");
    radioLimited->setChecked(!settings->isDownloadSpeedUnlimited());
    speedBtnGroup->addButton(radioLimited, 1);
    radioRow2->addWidget(radioLimited);

    QLineEdit *speedInput = new QLineEdit();
    speedInput->setText(QString::number(settings->getDownloadSpeedLimit()));
    speedInput->setFixedWidth(100);
    QObject::connect(speedInput, &QLineEdit::textChanged, [settings](const QString& text) {
        bool ok;
        int value = text.toInt(&ok);
        if (ok && value > 0) {
            settings->setDownloadSpeedLimit(value);
            settings->saveSettings();
        }
    });
    radioRow2->addWidget(speedInput);
    radioRow2->addWidget(new QLabel("KB/S"));
    radioRow2->addStretch();
    group1Layout->addLayout(radioRow2);

    QObject::connect(speedBtnGroup, QOverload<int>::of(&QButtonGroup::idClicked), [settings](int id) {
        settings->setDownloadSpeedUnlimited(id == 0);
        settings->saveSettings();
    });
    layout->addWidget(group1);

    QLabel *header2 = new QLabel("インストール先", page);
    layout->addWidget(header2);

    QWidget *group2 = new QWidget(page);
    group2->setObjectName("installDirGroup");
    group2->setStyleSheet("#installDirGroup { background-color: #2a2a2a; border-radius: 6px; }");
    QHBoxLayout *group2Layout = new QHBoxLayout(group2);
    group2Layout->setContentsMargins(18, 15, 18, 15);

    QLineEdit *dirInput = new QLineEdit();
    dirInput->setText(QString::fromStdString(settings->getInstallDir()));
    dirInput->setReadOnly(true);
    group2Layout->addWidget(dirInput);

    QPushButton *browseBtn = new QPushButton("変更");
    QObject::connect(browseBtn, &QPushButton::clicked, [settings, dirInput, page]() {
        QString dir = QFileDialog::getExistingDirectory(page, "インストール先を選択", dirInput->text());
        if (!dir.isEmpty()) {
            dirInput->setText(dir);
            settings->setInstallDir(dir.toStdString());
            settings->saveSettings();
        }
    });
    group2Layout->addWidget(browseBtn);
    layout->addWidget(group2);

    layout->addStretch();
    return page;
}

QWidget* SettingsPageFactory::createNotificationSettingsPage(ISettingsRepository* settings) {
    QWidget *page = new QWidget();
    page->setStyleSheet("background-color: transparent;");

    QVBoxLayout *layout = new QVBoxLayout(page);
    layout->setAlignment(Qt::AlignTop);
    layout->setSpacing(10);
    layout->setContentsMargins(20, 20, 20, 20);

    QLabel *title = new QLabel("通知", page);
    title->setStyleSheet("font-size: 20px; font-weight: bold; margin-bottom: 10px; color: #ffffff; background-color: transparent;");
    layout->addWidget(title);

    QWidget *group1 = new QWidget(page);
    group1->setObjectName("notificationGroup");
    group1->setStyleSheet("#notificationGroup { background-color: #2a2a2a; border-radius: 6px; }");
    QVBoxLayout *group1Layout = new QVBoxLayout(group1);
    group1Layout->setContentsMargins(18, 15, 18, 15);

    QHBoxLayout *toggleRow = new QHBoxLayout();
    QLabel *lblDesktopNotification = new QLabel("デスクトップ通知を許可する");
    lblDesktopNotification->setStyleSheet("background-color: transparent; color: #ffffff;");
    toggleRow->addWidget(lblDesktopNotification);
    toggleRow->addStretch();

    QCheckBox *swDesktopNotification = new QCheckBox();
    swDesktopNotification->setChecked(settings->isDesktopNotificationEnabled());
    QObject::connect(swDesktopNotification, &QCheckBox::toggled, [settings](bool checked) {
        settings->setDesktopNotificationEnabled(checked);
        settings->saveSettings();
    });
    toggleRow->addWidget(swDesktopNotification);
    group1Layout->addLayout(toggleRow);
    layout->addWidget(group1);

    layout->addStretch();
    return page;
}

QWidget* SettingsPageFactory::createDescriptionSettingsPage(
    ISettingsRepository* settings,
    std::shared_ptr<CheckLauncherUpdateUseCase> checkUpdateUseCase,
    std::shared_ptr<ApplyLauncherUpdateUseCase> applyUpdateUseCase
) {
    QWidget *page = new QWidget();
    page->setStyleSheet("background-color: transparent;");

    QVBoxLayout *layout = new QVBoxLayout(page);
    layout->setAlignment(Qt::AlignTop);
    layout->setSpacing(10);
    layout->setContentsMargins(20, 20, 20, 20);

    QLabel *title = new QLabel("詳細", page);
    title->setStyleSheet("font-size: 20px; font-weight: bold; margin-bottom: 10px; color: #ffffff; background-color: transparent;");
    layout->addWidget(title);

    QString versionStr = QString::fromStdString(settings->getLauncherVersion());
    QLabel *appNameLabel = new QLabel("GameLauncher V" + versionStr);
    appNameLabel->setStyleSheet("color: #ffffff;");
    layout->addWidget(appNameLabel);

    QPushButton *checkUpdateBtn = new QPushButton("アップデートを確認");
    checkUpdateBtn->setFixedWidth(150);
    QObject::connect(checkUpdateBtn, &QPushButton::clicked, [checkUpdateUseCase, applyUpdateUseCase, page, checkUpdateBtn]() {
        checkUpdateBtn->setEnabled(false);
        checkUpdateBtn->setText("確認中...");
        
        checkUpdateUseCase->execute("", 
            [applyUpdateUseCase, page, checkUpdateBtn](UpdateCheckResultDto result) {
                checkUpdateBtn->setEnabled(true);
                checkUpdateBtn->setText("アップデートを確認");
                
                if (result.hasUpdate) {
                    QMessageBox::StandardButton res = QMessageBox::question(page, "アップデート", 
                        QString("新しいバージョン(%1)が利用可能です。アップデートしますか？\n\nリリースノート:\n%2")
                        .arg(QString::fromStdString(result.latestVersion))
                        .arg(QString::fromStdString(result.releaseNotes)),
                        QMessageBox::Yes | QMessageBox::No);
                    
                    if (res == QMessageBox::Yes) {
                        applyUpdateUseCase->execute("", [](UpdateCheckResultDto){
                            // MaintenanceTool가 起動するのでアプリを終了する準備
                        }, [](const std::string& err) {
                            QMessageBox::critical(nullptr, "エラー", QString::fromStdString(err));
                        });
                    }
                } else {
                    QMessageBox::information(page, "アップデート", "最新のバージョンを使用しています。");
                }
            },
            [checkUpdateBtn](const std::string& err) {
                checkUpdateBtn->setEnabled(true);
                checkUpdateBtn->setText("アップデートを確認");
                QMessageBox::critical(nullptr, "エラー", QString::fromStdString(err));
            }
        );
    });
    layout->addWidget(checkUpdateBtn);

    layout->addStretch();
    return page;
}

QLabel* SettingsPageFactory::createRecommendTag() {
    QLabel *tag = new QLabel("オススメ");
    tag->setStyleSheet("color: orange; font-weight: bold;");
    return tag;
}

QFrame* SettingsPageFactory::createSeparator() {
    QFrame *line = new QFrame();
    line->setFrameShape(QFrame::HLine);
    line->setStyleSheet("background-color: rgba(255, 255, 255, 50);");
    return line;
}
