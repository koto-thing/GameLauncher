#ifndef GAMELAUNCHER_SETTINGSPAGEFACTORY_H
#define GAMELAUNCHER_SETTINGSPAGEFACTORY_H

#include <QWidget>
#include <QLabel>
#include <QFrame>

class SettingsManager;

class SettingsPageFactory {
public:
    // 各設定ページを作成
    static QWidget* createGeneralSettingsPage(SettingsManager* settings);
    static QWidget* createDownloadSettingsPage(SettingsManager* settings);
    static QWidget* createNotificationSettingsPage(SettingsManager* settings);
    static QWidget* createDescriptionSettingsPage();

    // ヘルパー関数
    static QLabel* createRecommendTag();
    static QFrame* createSeparator();
};

#endif

