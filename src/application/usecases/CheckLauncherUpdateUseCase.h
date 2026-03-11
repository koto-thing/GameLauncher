#ifndef GAMELAUNCHER_CHECKLAUNCHERUPDATEUSECASE_H
#define GAMELAUNCHER_CHECKLAUNCHERUPDATEUSECASE_H

#include "../../domain/repositories/ILauncherUpdateRepository.h"
#include "../../domain/repositories/ISettingsRepository.h"
#include "../dto/UpdateCheckResultDto.h"
#include <functional>
#include <memory>

class CheckLauncherUpdateUseCase {
public:
    CheckLauncherUpdateUseCase(
        std::shared_ptr<ILauncherUpdateRepository> updateRepo,
        std::shared_ptr<ISettingsRepository>       settingsRepo,
        const std::string                          &currentVersion
    );

    void execute(
        const std::string                         &manifestUrl,
        std::function<void(UpdateCheckResultDto)> onResult,
        std::function<void(const std::string &)>  onError
    );

private:
    std::shared_ptr<ILauncherUpdateRepository> m_updateRepo;
    std::shared_ptr<ISettingsRepository>       m_settingsRepo;
    std::string                                m_currentVersion;
};


#endif //GAMELAUNCHER_CHECKLAUNCHERUPDATEUSECASE_H