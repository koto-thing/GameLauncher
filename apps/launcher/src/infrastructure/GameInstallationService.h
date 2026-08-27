#pragma once

#include "application/Ports.h"

#include <QElapsedTimer>
#include <QMutex>
#include <QNetworkAccessManager>
#include <QString>

namespace pandd {

/** @brief stagingとactive切替を管理するゲーム配置Service */
class GameInstallationService final : public IGameInstallationService {
  public:
    /** @brief Qtネットワーク実装を構築する */
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
    /** @brief 一チャンクをRange再開付きで取得する */
    OperationResult downloadChunk(const FileChunk& chunk, const QString& partPath,
                                  const QString& operationId, std::uint64_t speedLimit,
                                  std::atomic_uint64_t& aggregateReceived,
                                  std::uint64_t aggregateTotal, std::size_t completedFiles,
                                  std::size_t totalFiles, const ProgressCallback& progress,
                                  std::atomic_bool& cancelled, QMutex& throttleMutex,
                                  QElapsedTimer& throttleTimer, std::uint64_t& throttledBytes);

    /** @brief SHA-256をストリーミング計算する */
    [[nodiscard]] static QByteArray sha256(const QString& path);

    /** @brief file構成先がsymlinkを経由しないことを検査する */
    [[nodiscard]] static bool hasUnsafeLink(const QString& root, const QString& relativePath);

    /** @brief active.jsonを原子的に更新する */
    static OperationResult writeActiveVersion(const QString& gameRoot, const std::string& version);

    /** @brief currentとprevious以外のreleaseを清掃する */
    static void cleanOldReleases(const QString& gameRoot, const QString& activeVersion);

    /** @brief 検証済みstaging releaseをrollback可能に有効化する */
    static OperationResult activateRelease(const GameRelease& release, const QString& gameRoot,
                                           const QString& stagingRoot);

    std::atomic_bool paused_{false};
    QMutex operationMutex_;
};

} // namespace pandd
