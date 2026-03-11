#ifndef GAMELAUNCHER_SAVESETTINGSUSECASE_H
#define GAMELAUNCHER_SAVESETTINGSUSECASE_H

#include "../../domain/repositories/IStartupRepository.h"
#include "../../domain/repositories/ISettingsRepository.h"
#include "../../application/dto/LauncherSettingsDto.h"
#include <memory>

class SaveSettingsUseCase {
public:
    explicit SaveSettingsUseCase(
        std::shared_ptr<ISettingsRepository> settingsRepo,
        std::shared_ptr<IStartupRepository>  startupRepo,
        const std::string                    &appName,
        const std::string                    &executablePath
    );
    void execute(const LauncherSettingsDto &dto);

private:
    std::shared_ptr<ISettingsRepository> m_settingsRepo;
    std::shared_ptr<IStartupRepository>  m_startupRepo;
    std::string                          m_appName;
    std::string                          m_executablePath;

    void validate(const LauncherSettingsDto &dto);
};

#endif //GAMELAUNCHER_SAVESETTINGSUSECASE_H