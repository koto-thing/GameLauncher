#include "AppContainer.h"
#include "../../infrastructure/storage/QtSettingsRepository.h"
#include "../../infrastructure/system/QtGameRunner.h"

AppContainer::AppContainer() {
    m_settingsRepository = std::make_unique<QtSettingsRepository>();
    m_gameRunner = std::make_unique<QtGameRunner>();
}

AppContainer::~AppContainer() = default;

ISettingsRepository* AppContainer::getSettingsRepository() {
    return m_settingsRepository.get();
}

IGameRunner* AppContainer::getGameRunner() {
    return m_gameRunner.get();
}
