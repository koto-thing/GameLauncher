#include "CloseApplicationUseCase.h"

CloseApplicationUseCase::CloseApplicationUseCase(
    std::shared_ptr<IApplicationRepository> appRepo,
    std::shared_ptr<ISettingsRepository>    settingsRepo)
        : m_appRepo(std::move(appRepo))
        , m_settingsRepo(std::move(settingsRepo)) {

}

void CloseApplicationUseCase::execute() const {
    LauncherSettings settings = m_settingsRepo->load();
    if (settings.closeToTray) {
        m_appRepo->minimizeToTray();
    } else {
        m_appRepo->quit();
    }
}

void CloseApplicationUseCase::forceQuit() const {
    m_appRepo->quit();
}
