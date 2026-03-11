#include "AppContainer.h"
#include "../../infrastructure/storage/QtSettingsRepository.h"
#include "../../infrastructure/system/QtGameRunner.h"
#include "../../infrastructure/network/QtLauncherUpdateRepository.h"

AppContainer::AppContainer() {
    auto settingsRepo = new QtSettingsRepository();
    m_settingsRepository = std::unique_ptr<ISettingsRepository>(settingsRepo);
    m_gameRunner = std::unique_ptr<QtGameRunner>(new QtGameRunner());

    m_updateRepository = std::make_shared<QtLauncherUpdateRepository>();

    m_checkUpdateUseCase = std::make_shared<CheckLauncherUpdateUseCase>(
        m_updateRepository, 
        std::shared_ptr<ISettingsRepository>(m_settingsRepository.get(), [](ISettingsRepository*){}), // Non-owning shared_ptr
        "1.0.0"
    );
    
    m_applyUpdateUseCase = std::make_shared<ApplyLauncherUpdateUseCase>(
        m_updateRepository,
        std::shared_ptr<ISettingsRepository>(m_settingsRepository.get(), [](ISettingsRepository*){})
    );
}

AppContainer::~AppContainer() = default;

ISettingsRepository* AppContainer::getSettingsRepository() {
    return m_settingsRepository.get();
}

IGameRunner* AppContainer::getGameRunner() {
    return m_gameRunner.get();
}

ILauncherUpdateRepository* AppContainer::getUpdateRepository() {
    return m_updateRepository.get();
}

std::shared_ptr<CheckLauncherUpdateUseCase> AppContainer::getCheckLauncherUpdateUseCase() {
    return m_checkUpdateUseCase;
}

std::shared_ptr<ApplyLauncherUpdateUseCase> AppContainer::getApplyLauncherUpdateUseCase() {
    return m_applyUpdateUseCase;
}
