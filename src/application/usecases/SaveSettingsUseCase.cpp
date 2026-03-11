#include "domain/repositories/IStartupRepository.h"
#include "domain/entities/LauncherSettings.h"
#include "SaveSettingsUseCase.h"
#include <stdexcept>

SaveSettingsUseCase::SaveSettingsUseCase(
    std::shared_ptr<ISettingsRepository> settingsRepo,
    std::shared_ptr<IStartupRepository>  startupRepo,
    const std::string                   &appName,
    const std::string                   &executablePath)
    : m_settingsRepo(std::move(settingsRepo))
    , m_startupRepo(std::move(startupRepo))
    , m_appName(appName)
    , m_executablePath(executablePath) {

}

void SaveSettingsUseCase::execute(const LauncherSettingsDto &dto) {
    validate(dto);

    bool currentlyEnabled = m_startupRepo->isEnabled(m_appName);
    if (dto.startOnBoot && !currentlyEnabled) {
        m_startupRepo->enable(m_appName, m_executablePath);
    } else if (!dto.startOnBoot && currentlyEnabled) {
        m_startupRepo->disable(m_appName);
    }

    // 設定をセッターで更新してJsonに保存
    m_settingsRepo->setLanguage(dto.language);
    m_settingsRepo->setAutoRunOnStartup(dto.startOnBoot);
    m_settingsRepo->setAutoUpdateEnabled(dto.autoUpdate);
    m_settingsRepo->setDesktopNotificationEnabled(dto.enableNotifications);
    m_settingsRepo->saveSettings();
}

void SaveSettingsUseCase::validate(const LauncherSettingsDto &dto) {
    if (dto.language.empty()) {
        throw std::runtime_error("Language cannot be empty");
    }

    if (dto.installDir.empty()) {
        throw std::runtime_error("Install directory cannot be empty");
    }

    if (dto.maxDownloadSpeedKB < 0) {
        throw std::runtime_error("Max download speed cannot be negative");
    }
}
