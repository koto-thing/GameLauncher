#ifndef GAMELAUNCHER_APPCONTAINER_H
#define GAMELAUNCHER_APPCONTAINER_H

#include "../../domain/repositories/ISettingsRepository.h"
#include "../../domain/repositories/IGameRunner.h"
#include <memory>

class AppContainer {
public:
    AppContainer();
    ~AppContainer();

    ISettingsRepository* getSettingsRepository();
    IGameRunner* getGameRunner();

private:
    std::unique_ptr<ISettingsRepository> m_settingsRepository;
    std::unique_ptr<IGameRunner> m_gameRunner;
};

#endif //GAMELAUNCHER_APPCONTAINER_H
