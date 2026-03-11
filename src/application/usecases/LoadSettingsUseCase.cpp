#include "LoadSettingsUseCase.h"
#include "domain/entities/LauncherSettings.h"

LoadSettingsUseCase::LoadSettingsUseCase(std::shared_ptr<ISettingsRepository> repo)
    : m_repo(std::move(repo)) {

}

LauncherSettingsDto LoadSettingsUseCase::execute() {
    LauncherSettings entity = m_repo->load();

    // エンティティからDTOへの変換
    LauncherSettingsDto dto;
    dto.language            = entity.language;
    dto.startOnBoot         = entity.startOnBoot;
    dto.installDir          = entity.installDir;
    dto.maxDownloadSpeedKB  = entity.maxDownloadSpeedKB;
    dto.closeToTray         = entity.closeToTray;
    dto.autoUpdate          = entity.autoUpdate;
    dto.enableNotifications = entity.enableNotifications;

    return dto;
}
