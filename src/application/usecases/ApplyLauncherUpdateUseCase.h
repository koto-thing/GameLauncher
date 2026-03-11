#ifndef GAMELAUNCHER_APPLYLAUNCHERUPDATEUSECASEW_H
#define GAMELAUNCHER_APPLYLAUNCHERUPDATEUSECASEW_H

#include "../../domain/repositories/ILauncherUpdateRepository.h"
#include "../../domain/repositories/ISettingsRepository.h"
#include "../dto/UpdateCheckResultDto.h"
#include <memory>
#include <functional>
#include <string>

class ApplyLauncherUpdateUseCase {
public:
    ApplyLauncherUpdateUseCase(
        std::shared_ptr<ILauncherUpdateRepository> updateRepo,
        std::shared_ptr<ISettingsRepository> settingsRepo
    );

    void execute(
        const std::string                            &manifestUrl,
        std::function<void(UpdateCheckResultDto)>    onResult,
        std::function<void(const std::string &)>     onError
    );

private:
    std::shared_ptr<ILauncherUpdateRepository> m_updateRepo;
    std::shared_ptr<ISettingsRepository>       m_settingsRepo;
};


#endif //GAMELAUNCHER_APPLYLAUNCHERUPDATEUSECASEW_H