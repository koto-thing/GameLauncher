#pragma once

#include "application/Ports.h"

#include <QMutex>
#include <QString>

namespace pandd {

/** @brief stagingとactive切替を管理するゲーム配置Service */
class GameInstallationService final : public IGameInstallationService {
  public:
    /** @brief ゲーム配置処理を構築する */
    GameInstallationService();

    /** @copydoc IGameInstallationService::install */
    OperationResult install(const GameRelease& release, const std::string& gameRoot,
                            std::uint64_t speedLimit, const ProgressCallback& progress,
                            std::atomic_bool& cancelled) override;

    /** @copydoc IGameInstallationService::verify */
    OperationResult verify(const InstalledGame& installed, const GameRelease& release) override;

    /** @copydoc IGameInstallationService::validateActivation */
    OperationResult validateActivation(const InstalledGame& installed) override;

    /** @copydoc IGameInstallationService::uninstall */
    OperationResult uninstall(const InstalledGame& installed) override;

    /** @copydoc IGameInstallationService::importExisting */
    OperationResult importExisting(const GameRelease& release, const std::string& sourceDirectory,
                                   const std::string& gameRoot,
                                   const ProgressCallback& progress) override;

    /** @copydoc IGameInstallationService::cleanupTemporary */
    OperationResult cleanupTemporary(const InstalledGame& installed) override;

    /** @copydoc IGameInstallationService::pause */
    void pause() override;

    /** @copydoc IGameInstallationService::resume */
    void resume() override;

  private:
    /** @brief file構成先がsymlinkを経由しないことを検査する */
    [[nodiscard]] static bool hasUnsafeLink(const QString& root, const QString& relativePath);

    std::atomic_bool paused_{false};
    QMutex operationMutex_;
};

} // namespace pandd
