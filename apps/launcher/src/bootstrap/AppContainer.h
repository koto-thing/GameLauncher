#pragma once

#include "application/LauncherService.h"
#include "infrastructure/GameInstallationService.h"
#include "infrastructure/PlatformServices.h"
#include "infrastructure/QtRepositories.h"

#include <memory>

namespace pandd {

/** @brief 具象依存関係の所有権を一箇所へ集約するComposition Root */
class AppContainer final {
  public:
    /** @brief build環境に固定された配布先で全Serviceを接続する */
    AppContainer();

    /** @brief 所有Serviceを依存関係の逆順で破棄する */
    ~AppContainer();

    /** @brief UIへApplication Facadeを貸し出す */
    [[nodiscard]] LauncherService& launcherService();

  private:
    std::unique_ptr<StaticContentRepository> contentRepository_;
    std::unique_ptr<JsonStateRepository> stateRepository_;
    std::unique_ptr<GameInstallationService> installationService_;
    std::unique_ptr<QtGameProcessService> processService_;
    std::unique_ptr<PlatformStartupService> startupService_;
    std::unique_ptr<MaintenanceToolService> updateService_;
    std::unique_ptr<SystemClock> clock_;
    std::unique_ptr<LauncherService> launcherService_;
};

} // namespace pandd
