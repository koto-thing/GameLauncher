#ifndef GAMELAUNCHER_APPCONTAINER_H
#define GAMELAUNCHER_APPCONTAINER_H

#include "../../domain/repositories/ISettingsRepository.h"
#include "../../domain/repositories/IGameRunner.h"
#include "../../domain/repositories/ILauncherUpdateRepository.h"
#include "../../application/usecases/CheckLauncherUpdateUseCase.h"
#include "../../application/usecases/ApplyLauncherUpdateUseCase.h"
#include <memory>

class AppContainer {
public:
    AppContainer();
    ~AppContainer();

    ISettingsRepository* getSettingsRepository();
    IGameRunner* getGameRunner();
    ILauncherUpdateRepository* getUpdateRepository();
    
    std::shared_ptr<CheckLauncherUpdateUseCase> getCheckLauncherUpdateUseCase();
    std::shared_ptr<ApplyLauncherUpdateUseCase> getApplyLauncherUpdateUseCase();

private:
    std::unique_ptr<ISettingsRepository> m_settingsRepository;
    std::unique_ptr<IGameRunner> m_gameRunner;
    std::shared_ptr<ILauncherUpdateRepository> m_updateRepository;

    std::shared_ptr<CheckLauncherUpdateUseCase> m_checkUpdateUseCase;
    std::shared_ptr<ApplyLauncherUpdateUseCase> m_applyUpdateUseCase;
};

#endif //GAMELAUNCHER_APPCONTAINER_H
