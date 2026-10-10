#include "bootstrap/AppContainer.h"

#include <QDir>
#include <QStandardPaths>
#include <QUrl>

namespace pandd {

/** @brief build固定の具象Serviceを生成してPortへ接続する */
AppContainer::AppContainer() : editionRepository_(EditionProfile::current()) {
    // テスト配信先はbuild時に固定し利用者設定へ露出しない
    const auto baseUrl = QUrl(QStringLiteral(PANDD_DISTRIBUTION_BASE_URL));
    // 外部I/Oを担当する具象Adapterを生成
    contentRepository_ = std::make_unique<StaticContentRepository>(
        baseUrl, QByteArray(PANDD_MANIFEST_PUBLIC_KEY_BASE64));
    stateRepository_ = std::make_unique<JsonStateRepository>();
    installationService_ = std::make_unique<GameInstallationService>();
    playStatistics_ = std::make_unique<PlayStatisticsService>(
        QDir(QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation))
            .filePath("play-statistics/" + QStringLiteral(PANDD_DISTRIBUTION_ENV)),
        QUrl(QStringLiteral(PANDD_PLATFORM_API_BASE_URL)));
    processService_ = std::make_unique<QtGameProcessService>();
    processService_->setPlayStatisticsService(playStatistics_.get());
    startupService_ = std::make_unique<PlatformStartupService>();
    updateService_ = std::make_unique<MaintenanceToolService>();
    clock_ = std::make_unique<SystemClock>();

    // 全PortをApplication Facadeへ注入
    launcherService_ = std::make_unique<LauncherService>(
        editionRepository_.enabled() ? static_cast<IGameCatalogRepository&>(editionRepository_)
                                     : *contentRepository_,
        *contentRepository_, *contentRepository_, *stateRepository_, *stateRepository_,
        *installationService_, *processService_, *startupService_, *updateService_, *clock_,
        SemanticVersion(PANDD_LAUNCHER_VERSION),
        editionRepository_.enabled() ? &editionRepository_ : nullptr);
}

/** @brief 所有しているServiceを解放する */
AppContainer::~AppContainer() = default;

LauncherService& AppContainer::launcherService() {
    // UIへApplication Facadeを返す
    return *launcherService_;
}

/** @brief UIへ統計Serviceを返す */
PlayStatisticsService& AppContainer::playStatistics() { return *playStatistics_; }

} // namespace pandd
