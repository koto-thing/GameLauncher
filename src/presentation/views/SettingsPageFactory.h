#ifndef GAMELAUNCHER_SETTINGSPAGEFACTORY_H
#define GAMELAUNCHER_SETTINGSPAGEFACTORY_H

#include <QWidget>
#include <QLabel>
#include <QFrame>
#include <memory>
#include "../../domain/repositories/ISettingsRepository.h"
#include "../../application/usecases/CheckLauncherUpdateUseCase.h"
#include "../../application/usecases/ApplyLauncherUpdateUseCase.h"

class SettingsPageFactory {
public:
    static QWidget* createGeneralSettingsPage(ISettingsRepository* settings);
    static QWidget* createDownloadSettingsPage(ISettingsRepository* settings);
    static QWidget* createNotificationSettingsPage(ISettingsRepository* settings);
    static QWidget* createDescriptionSettingsPage(
        ISettingsRepository* settings,
        std::shared_ptr<CheckLauncherUpdateUseCase> checkUpdateUseCase,
        std::shared_ptr<ApplyLauncherUpdateUseCase> applyUpdateUseCase
    );

    static QLabel* createRecommendTag();
    static QFrame* createSeparator();
};

#endif //GAMELAUNCHER_SETTINGSPAGEFACTORY_H
