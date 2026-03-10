#ifndef GAMELAUNCHER_SETTINGSPAGEFACTORY_H
#define GAMELAUNCHER_SETTINGSPAGEFACTORY_H

#include <QWidget>
#include <QLabel>
#include <QFrame>
#include "../../domain/repositories/ISettingsRepository.h"

class SettingsPageFactory {
public:
    static QWidget* createGeneralSettingsPage(ISettingsRepository* settings);
    static QWidget* createDownloadSettingsPage(ISettingsRepository* settings);
    static QWidget* createNotificationSettingsPage(ISettingsRepository* settings);
    static QWidget* createDescriptionSettingsPage();

    static QLabel* createRecommendTag();
    static QFrame* createSeparator();
};

#endif //GAMELAUNCHER_SETTINGSPAGEFACTORY_H
