#include "infrastructure/GameInstallationService.h"

#include "infrastructure/FileIntegrity.h"
#include "infrastructure/InstallationStorage.h"
#include "pandd-launcher-rust/src/lib.rs.h"
#include <QDebug>
#include <QDir>
#include <QDirIterator>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QStorageInfo>
#include <QUuid>

#include <algorithm>
#include <exception>
#include <limits>
#include <map>
#include <set>
#include <vector>

namespace pandd {
namespace {

/** @brief インストールエラー結果を作成する */
OperationResult installFailure(ErrorCode code, std::string userMessage, std::string detail,
                               bool retryable = true) {
    return OperationResult::failure({.code = code,
                                     .userMessage = std::move(userMessage),
                                     .detail = std::move(detail),
                                     .retryable = retryable});
}

/** @brief symlinkとWindows junctionを同じ脱出経路として判定する */
bool isUnsafeLink(const QFileInfo& info) {
    if (info.isSymLink()) {
        return true;
    }
#if defined(Q_OS_WIN)
    return info.isJunction();
#else
    return false;
#endif
}

} // namespace

/** @brief ゲーム配置Serviceを初期化する */
GameInstallationService::GameInstallationService() = default;

/** @brief ダウンロードを一時停止する */
void GameInstallationService::pause() {
    // workerが現在のchunkを終えるまで停止状態を共有する
    paused_ = true;
}

/** @brief 一時停止中のダウンロードを再開する */
void GameInstallationService::resume() {
    // workerが待機条件を解除できるよう状態を共有する
    paused_ = false;
}

/** @brief 検証済みchunkからreleaseを構築して有効化する */
OperationResult GameInstallationService::install(const GameRelease& release,
                                                 const std::string& gameRootValue,
                                                 std::uint64_t speedLimit,
                                                 const ProgressCallback& progress,
                                                 std::atomic_bool& cancelled) {
    QMutexLocker operationLock(&operationMutex_);
    const QString gameRoot = QString::fromStdString(gameRootValue);
    const auto operationId = QUuid::createUuid().toString(QUuid::WithoutBraces);
    qInfo().noquote() << "operation=" + operationId
                      << "game=" + QString::fromStdString(release.gameId.value())
                      << "release=" + QString::fromStdString(release.version.value())
                      << "event=install-start";
    paused_ = false;
    const QString launcherRoot = QDir(gameRoot).filePath(".launcher");
    const QString stagingRoot =
        QDir(launcherRoot).filePath("staging/" + QString::fromStdString(release.version.value()));
    const QString stagedRelease = QDir(stagingRoot).filePath("release");
    const QString chunksRoot = QDir(launcherRoot).filePath("cache/sha256");

    // 管理rootと内部directoryに事前配置されたlinkを作成・書込より先に拒否
    const auto version = QString::fromStdString(release.version.value());
    const QStringList managedPaths{".launcher",         ".launcher/active.json",
                                   ".launcher/staging", ".launcher/staging/" + version,
                                   ".launcher/cache",   ".launcher/cache/sha256",
                                   ".launcher/trash",   ".launcher/trash/" + version,
                                   "releases",          "releases/" + version};
    const auto managedLink = std::ranges::any_of(
        managedPaths, [&](const auto& path) { return hasUnsafeLink(gameRoot, path); });
    if ((QFileInfo::exists(gameRoot) && isUnsafeLink(QFileInfo(gameRoot))) || managedLink) {
        return installFailure(ErrorCode::ManifestInvalid, "安全でない保存先を検出しました",
                              "game management path crosses a symbolic link", false);
    }

    // staging余裕を含む必要容量を先に確認
    QDir().mkpath(stagingRoot);
    const QStorageInfo storage(stagingRoot);
    const auto availableBytes =
        static_cast<std::uint64_t>(std::max<qint64>(0, storage.bytesAvailable()));
    const auto requiredBytes = release.totalSize > std::numeric_limits<std::uint64_t>::max() / 2
                                   ? std::numeric_limits<std::uint64_t>::max()
                                   : release.totalSize * 2;
    if (storage.isValid() && availableBytes < requiredBytes) {
        return installFailure(ErrorCode::DiskSpaceInsufficient,
                              "空き容量が不足しています。保存先を変更してください",
                              "available disk space is smaller than staging requirement", false);
    }
    QDir().mkpath(stagedRelease);
    QDir().mkpath(chunksRoot);
    QDir().mkpath(QDir(gameRoot).filePath("releases"));
    QDir().mkpath(QDir(launcherRoot).filePath("trash"));

    // キャッシュのリンクを拒否して後段の追記ダウンロードが外部へ書き込まないようにする
    for (const auto& file : release.files) {
        for (const auto& chunk : file.chunks) {
            if (hasUnsafeLink(chunksRoot, QString::fromStdString(chunk.sha256))) {
                return installFailure(ErrorCode::ManifestInvalid, "安全でない保存先を検出しました",
                                      "chunk cache path crosses a symbolic link", false);
            }
        }
    }

    std::set<std::string> verifiedCache;

    // active版の正常chunkをcacheへ戻し、修復時のnetwork取得を破損箇所だけに限定
    QFile activeMarker(QDir(launcherRoot).filePath("active.json"));
    if (activeMarker.open(QIODevice::ReadOnly) && activeMarker.size() <= 4096) {
        const auto markerData = activeMarker.readAll();
        activeMarker.close();
        const auto marker = QJsonDocument::fromJson(markerData).object();
        try {
            const SemanticVersion activeVersion(marker.value("version").toString().toStdString());
            const QString activeRoot = QDir(gameRoot).filePath(
                "releases/" + QString::fromStdString(activeVersion.value()));
            for (const auto& file : release.files) {
                const auto relativePath = QString::fromStdString(file.path);
                const auto sourcePath = QDir(activeRoot).filePath(relativePath);
                if (hasUnsafeLink(activeRoot, relativePath) ||
                    QFileInfo(sourcePath).size() != static_cast<qint64>(file.size)) {
                    continue;
                }
                for (const auto& chunk : file.chunks) {
                    if (cancelled) {
                        return installFailure(ErrorCode::OperationCancelled,
                                              "ダウンロードをキャンセルしました", "cancelled",
                                              false);
                    }
                    const auto cachePath =
                        QDir(chunksRoot).filePath(QString::fromStdString(chunk.sha256));
                    if (verifiedCache.contains(chunk.sha256)) {
                        continue;
                    }
                    if (FileIntegrity::verify(cachePath, chunk.size, chunk.sha256) ||
                        FileIntegrity::recover(sourcePath, chunk, cachePath, cancelled).ok) {
                        verifiedCache.insert(chunk.sha256);
                    }
                }
            }
        } catch (const std::exception&) { // NOLINT(bugprone-empty-catch)
            // 不正markerは再利用に使わず、通常の取得と後段整合性検証へ委ねる
        }
    }
    if (activeMarker.isOpen()) {
        activeMarker.close();
    }

    // content hashで重複chunkをまとめ最大3並列で取得
    struct PendingChunk {
        FileChunk chunk;
        QString path;
    };
    std::map<std::string, PendingChunk> uniqueChunks;
    for (const auto& file : release.files) {
        for (const auto& chunk : file.chunks) {
            const auto partPath = QDir(chunksRoot).filePath(QString::fromStdString(chunk.sha256));
            uniqueChunks.try_emplace(chunk.sha256, PendingChunk{chunk, partPath});
        }
    }
    std::uint64_t received = 0;
    std::vector<manifest_bridge::DownloadChunk> pending;
    for (const auto& [digest, item] : uniqueChunks) {
        if (verifiedCache.contains(digest) ||
            FileIntegrity::verify(item.path, item.chunk.size, digest)) {
            received += item.chunk.size;
        } else {
            pending.push_back({item.chunk.url, item.chunk.sha256, item.chunk.size});
        }
    }
    const manifest_bridge::DownloadControl control{
        &cancelled, &paused_, [&](std::uint64_t bytes, std::uint64_t speed) {
            if (progress) {
                progress({bytes, release.totalSize, speed, 0, release.files.size()});
            }
        }};
    const auto status = manifest_bridge::download_chunks(
        {pending.data(), pending.size()}, chunksRoot.toStdString(), received, speedLimit, control);
    if (status.code != 0) {
        const auto code = status.code == 2   ? ErrorCode::OperationCancelled
                          : status.code == 3 ? ErrorCode::InstallPermissionDenied
                                             : ErrorCode::DownloadHttpError;
        return installFailure(code, "ゲームファイルを取得できません", std::string(status.detail),
                              status.code == 3 || status.code == 4);
    }
    received = release.totalSize;

    std::size_t completedFiles = 0;
    for (const auto& file : release.files) {
        if (cancelled) {
            const auto discarded = InstallationStorage::discard(release, gameRoot, false);
            if (!discarded.ok) {
                return discarded;
            }
            return installFailure(ErrorCode::OperationCancelled, "ダウンロードをキャンセルしました",
                                  "operation cancelled", true);
        }
        if (hasUnsafeLink(stagedRelease, QString::fromStdString(file.path))) {
            return installFailure(ErrorCode::ManifestInvalid, "安全でない保存先を検出しました",
                                  "staging path crosses a symbolic link", false);
        }

        // 結合中に各チャンクと全体を検証し、成功した出力だけを確定する
        const QString destination = QDir(stagedRelease).filePath(QString::fromStdString(file.path));
        QDir().mkpath(QFileInfo(destination).absolutePath());
        const auto assembled = FileIntegrity::assemble(file, chunksRoot, destination, cancelled);
        if (!assembled.ok) {
            return assembled;
        }
#if !defined(Q_OS_WIN)
        if (file.executable) {
            QFile::setPermissions(destination, QFile::permissions(destination) |
                                                   QFileDevice::ExeOwner | QFileDevice::ExeGroup |
                                                   QFileDevice::ExeOther);
        }
#endif
        ++completedFiles;
        if (progress) {
            progress({received, release.totalSize, 0, completedFiles, release.files.size()});
        }
    }

    auto result = InstallationStorage::activate(release, gameRoot, false);
    qInfo().noquote() << "operation=" + operationId
                      << "game=" + QString::fromStdString(release.gameId.value())
                      << "release=" + QString::fromStdString(release.version.value())
                      << (result.ok ? "event=install-complete" : "event=install-failed");
    return result;
}

/** @brief 既存directoryを検証して管理下のreleaseへ取り込む */
OperationResult GameInstallationService::importExisting(const GameRelease& release,
                                                        const std::string& sourceDirectory,
                                                        const std::string& gameRootValue,
                                                        const ProgressCallback& progress) {
    QMutexLocker operationLock(&operationMutex_);
    const QString sourceRoot =
        QFileInfo(QString::fromStdString(sourceDirectory)).absoluteFilePath();
    const QString gameRoot = QString::fromStdString(gameRootValue);
    const QString launcherRoot = QDir(gameRoot).filePath(".launcher");
    const QString stagingRoot =
        QDir(launcherRoot)
            .filePath("staging/import-" + QString::fromStdString(release.version.value()));
    const QString stagedRelease = QDir(stagingRoot).filePath("release");
    if (!QFileInfo(sourceRoot).isDir() || isUnsafeLink(QFileInfo(sourceRoot))) {
        return installFailure(ErrorCode::ManifestInvalid,
                              "選択したゲームフォルダーが見つかりません",
                              "existing game source is not a directory", false);
    }

    // 余分なfileも含め正規releaseと同一のfile集合かを確認
    std::set<std::string> expectedPaths;
    for (const auto& file : release.files) {
        expectedPaths.insert(file.path);
    }
    std::set<std::string> actualPaths;
    QDirIterator iterator(sourceRoot, QDir::Files | QDir::Hidden | QDir::System,
                          QDirIterator::Subdirectories);
    while (iterator.hasNext()) {
        const QFileInfo fileInfo(iterator.next());
        if (isUnsafeLink(fileInfo)) {
            return installFailure(ErrorCode::ManifestInvalid,
                                  "安全でないゲームファイルを検出しました",
                                  "existing game contains a symbolic link", false);
        }
        actualPaths.insert(QDir(sourceRoot)
                               .relativeFilePath(fileInfo.absoluteFilePath())
                               .replace('\\', '/')
                               .toStdString());
    }
    if (actualPaths != expectedPaths) {
        return installFailure(ErrorCode::FileHashMismatch,
                              "選択したゲームは公開中の正規版と一致しません",
                              "existing game file set differs from manifest", false);
    }

    // 既存fileを一つずつ正規manifestと照合してstagingへ複製
    if (const auto discarded = InstallationStorage::discard(release, gameRoot, true);
        !discarded.ok) {
        return discarded;
    }
    QDir().mkpath(stagedRelease);
    const QStorageInfo storage(stagedRelease);
    if (storage.isValid() && static_cast<std::uint64_t>(std::max<qint64>(
                                 0, storage.bytesAvailable())) < release.totalSize) {
        if (const auto discarded = InstallationStorage::discard(release, gameRoot, true);
            !discarded.ok) {
            return discarded;
        }
        return installFailure(ErrorCode::DiskSpaceInsufficient,
                              "既存ゲームを取り込む空き容量が不足しています",
                              "insufficient disk space for existing game import", false);
    }
    std::uint64_t copiedBytes = 0;
    std::size_t completedFiles = 0;
    for (const auto& file : release.files) {
        const auto relativePath = QString::fromStdString(file.path);
        if (hasUnsafeLink(sourceRoot, relativePath) || hasUnsafeLink(stagedRelease, relativePath)) {
            if (const auto discarded = InstallationStorage::discard(release, gameRoot, true);
                !discarded.ok) {
                return discarded;
            }
            return installFailure(ErrorCode::ManifestInvalid,
                                  "安全でないゲームファイルを検出しました",
                                  "existing game path crosses a symbolic link", false);
        }
        const QString source = QDir(sourceRoot).filePath(relativePath);
        const QString destination = QDir(stagedRelease).filePath(relativePath);
        QDir().mkpath(QFileInfo(destination).absolutePath());
        const auto copied = FileIntegrity::copy(source, destination, file.size, file.sha256);
        if (!copied.ok) {
            if (const auto discarded = InstallationStorage::discard(release, gameRoot, true);
                !discarded.ok) {
                return discarded;
            }
            return copied;
        }
#if !defined(Q_OS_WIN)
        if (file.executable) {
            QFile::setPermissions(destination, QFile::permissions(destination) |
                                                   QFileDevice::ExeOwner | QFileDevice::ExeGroup |
                                                   QFileDevice::ExeOther);
        }
#endif
        copiedBytes += file.size;
        ++completedFiles;
        if (progress) {
            progress({copiedBytes, release.totalSize, 0, completedFiles, release.files.size()});
        }
    }
    return InstallationStorage::activate(release, gameRoot, true);
}

/** @brief active releaseの全ファイルを検証する */
OperationResult GameInstallationService::verify(const InstalledGame& installed,
                                                const GameRelease& release) {
    if (installed.gameId != release.gameId || installed.version != release.version) {
        return installFailure(ErrorCode::FileHashMismatch, "更新または修復が必要です",
                              "installed version does not match manifest", true);
    }
    const QDir releaseRoot(
        QDir(QString::fromStdString(installed.gameRoot))
            .filePath("releases/" + QString::fromStdString(installed.version.value())));
    for (const auto& file : release.files) {
        const auto path = releaseRoot.filePath(QString::fromStdString(file.path));
        if (hasUnsafeLink(releaseRoot.path(), QString::fromStdString(file.path)) ||
            !FileIntegrity::verify(path, file.size, file.sha256)) {
            return installFailure(ErrorCode::FileHashMismatch, "ゲームファイルの修復が必要です",
                                  "verification failed: " + file.path, true);
        }
    }
    return OperationResult::success();
}

/** @brief active markerとrelease entrypointの整合性を検証する */
OperationResult GameInstallationService::validateActivation(const InstalledGame& installed) {
    const QFileInfo root(QString::fromStdString(installed.gameRoot));
    const auto launcherRoot = QDir(root.absoluteFilePath()).filePath(".launcher");
    QFile activeFile(QDir(launcherRoot).filePath("active.json"));
    if (isUnsafeLink(root) || root.fileName().toStdString() != installed.gameId.value() ||
        !activeFile.open(QIODevice::ReadOnly)) {
        return installFailure(ErrorCode::FileHashMismatch, "ゲームの導入情報を復元できません",
                              "active marker is missing or unsafe", false);
    }
    const auto document = QJsonDocument::fromJson(activeFile.readAll());
    const auto object = document.object();
    if (!document.isObject() || object.value("schemaVersion").toInt() != 1 ||
        object.value("version").toString().toStdString() != installed.version.value()) {
        return installFailure(ErrorCode::FileHashMismatch, "ゲームの導入情報を復元できません",
                              "active marker version mismatch", false);
    }
    const auto releaseRoot =
        QDir(root.absoluteFilePath())
            .filePath("releases/" + QString::fromStdString(installed.version.value()));
    const auto entrypoint = QString::fromStdString(installed.entrypoint);
    if (!QFileInfo(releaseRoot).isDir() || hasUnsafeLink(releaseRoot, entrypoint) ||
        !QFileInfo(QDir(releaseRoot).filePath(entrypoint)).isFile()) {
        return installFailure(ErrorCode::LaunchExecutableMissing,
                              "ゲームの実行ファイルがありません",
                              "active release entrypoint is missing or unsafe", false);
    }
    return OperationResult::success();
}

/** @brief save dataを残してゲーム本体を削除する */
OperationResult GameInstallationService::uninstall(const InstalledGame& installed) {
    const QFileInfo root(QString::fromStdString(installed.gameRoot));
    const auto activeFile = QDir(root.absoluteFilePath()).filePath(".launcher/active.json");
    if (isUnsafeLink(root) || root.fileName().toStdString() != installed.gameId.value() ||
        !QFileInfo::exists(activeFile)) {
        return installFailure(ErrorCode::InstallPermissionDenied,
                              "安全性を確認できないため削除を中止しました",
                              "game root identity marker is missing", false);
    }
    if (!QDir(root.absoluteFilePath()).removeRecursively()) {
        return installFailure(ErrorCode::InstallPermissionDenied,
                              "ゲームを完全に削除できませんでした\n残った場所: " +
                                  root.absoluteFilePath().toStdString(),
                              root.absoluteFilePath().toStdString(), true);
    }
    return OperationResult::success();
}

/** @brief 失敗したstagingとchunk cacheを削除する */
OperationResult GameInstallationService::cleanupTemporary(const InstalledGame& installed) {
    QMutexLocker operationLock(&operationMutex_);
    return InstallationStorage::cleanup(installed);
}

/** @brief rootからrelative pathまでにunsafe linkがないかを検証する */
// traversal境界を維持するためrootと相対pathを分離
// NOLINTNEXTLINE(bugprone-easily-swappable-parameters)
bool GameInstallationService::hasUnsafeLink(const QString& root, const QString& relativePath) {
    QDir current(root);
    const auto components = relativePath.split('/', Qt::SkipEmptyParts);
    for (const auto& component : components) {
        const QFileInfo candidate(current.filePath(component));
        if (isUnsafeLink(candidate)) {
            return true;
        }
        current.setPath(candidate.absoluteFilePath());
    }
    return false;
}

} // namespace pandd
