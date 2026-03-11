#include "CheckLauncherUpdateUseCase.h"

CheckLauncherUpdateUseCase::CheckLauncherUpdateUseCase(
    std::shared_ptr<ILauncherUpdateRepository> updateRepo,
    std::shared_ptr<ISettingsRepository> settingsRepo,
    const std::string& currentVersion)
    : m_updateRepo(std::move(updateRepo))
    , m_settingsRepo(std::move(settingsRepo))
    , m_currentVersion(currentVersion) {

}

void CheckLauncherUpdateUseCase::execute(
    const std::string                         &manifestUrl,
    std::function<void(UpdateCheckResultDto)> onResult,
    std::function<void(const std::string &)>  onError
) {
    // QtIFWのMaintenanceToolを使用して更新をチェック
    m_updateRepo->checkUpdateWithMaintenanceTool(
        "", // デフォルトのパスを使用
        [this, onResult](const LauncherUpdateInfo &info) {
            LauncherSettings settings = m_settingsRepo->load();

            UpdateCheckResultDto dto;
            dto.hasUpdate = info.hasUpdate;
            dto.autoUpdate = settings.autoUpdate;
            dto.latestVersion = info.latestVersion;
            dto.currentVersion = m_currentVersion;
            dto.releaseNotes = info.releaseNotes;

            onResult(dto);
        },

        onError
    );
}