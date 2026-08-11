#include "bootstrap/AppContainer.h"

#include <QUrl>

namespace pandd {

AppContainer::AppContainer() {
    // テスト配信先はbuild時に固定し利用者設定へ露出しない
    const auto baseUrl = QUrl(QStringLiteral(PANDD_DISTRIBUTION_BASE_URL));
    contentRepository_ = std::make_unique<StaticContentRepository>(
        baseUrl, QByteArray(PANDD_MANIFEST_PUBLIC_KEY_BASE64));
    stateRepository_ = std::make_unique<JsonStateRepository>();
    installationService_ = std::make_unique<GameInstallationService>();
    processService_ = std::make_unique<QtGameProcessService>();
    startupService_ = std::make_unique<PlatformStartupService>();
    updateService_ = std::make_unique<MaintenanceToolService>();
    clock_ = std::make_unique<SystemClock>();
    launcherService_ = std::make_unique<LauncherService>(
        *contentRepository_, *contentRepository_, *contentRepository_, *stateRepository_,
        *stateRepository_, *installationService_, *processService_, *startupService_,
        *updateService_, *clock_, SemanticVersion(PANDD_LAUNCHER_VERSION));
}

AppContainer::~AppContainer() = default;

LauncherService& AppContainer::launcherService() { return *launcherService_; }

} // namespace pandd
