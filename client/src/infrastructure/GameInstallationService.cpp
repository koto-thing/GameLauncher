#include "infrastructure/GameInstallationService.h"

#include <QCryptographicHash>
#include <QDebug>
#include <QDir>
#include <QDirIterator>
#include <QElapsedTimer>
#include <QEventLoop>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QSaveFile>
#include <QStorageInfo>
#include <QThread>
#include <QThreadPool>
#include <QUuid>
#include <QtConcurrentMap>

#include <algorithm>
#include <exception>
#include <limits>
#include <map>
#include <optional>
#include <set>

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

/** @brief 既存directoryをrollback可能なtrashへ移動する */
bool moveAside(const QString& source, const QString& trash) {
    if (!QFileInfo::exists(source)) {
        return true;
    }
    QDir().mkpath(QFileInfo(trash).absolutePath());
    QDir(trash).removeRecursively();
    return QDir().rename(source, trash);
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

GameInstallationService::GameInstallationService() = default;

void GameInstallationService::pause() { paused_ = true; }

void GameInstallationService::resume() { paused_ = false; }

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
                QFile source(sourcePath);
                if (!source.open(QIODevice::ReadOnly)) {
                    continue;
                }
                for (const auto& chunk : file.chunks) {
                    const auto cachePath =
                        QDir(chunksRoot).filePath(QString::fromStdString(chunk.sha256));
                    if (QFileInfo(cachePath).size() == static_cast<qint64>(chunk.size) &&
                        sha256(cachePath).toHex().toStdString() == chunk.sha256) {
                        continue;
                    }
                    if (!source.seek(static_cast<qint64>(chunk.offset))) {
                        break;
                    }
                    QSaveFile cached(cachePath);
                    QCryptographicHash hash(QCryptographicHash::Sha256);
                    std::uint64_t remaining = chunk.size;
                    bool copied = cached.open(QIODevice::WriteOnly);
                    while (copied && remaining > 0) {
                        const auto block = source.read(static_cast<qint64>(
                            std::min<std::uint64_t>(remaining, 1024ULL * 1024)));
                        copied = !block.isEmpty() && cached.write(block) == block.size();
                        if (copied) {
                            hash.addData(block);
                            remaining -= static_cast<std::uint64_t>(block.size());
                        }
                    }
                    if (!copied || remaining != 0 ||
                        hash.result().toHex().toStdString() != chunk.sha256 || !cached.commit()) {
                        cached.cancelWriting();
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
    std::atomic_uint64_t received{0};
    QList<PendingChunk> pending;
    for (const auto& [digest, item] : uniqueChunks) {
        if (QFileInfo(item.path).size() == static_cast<qint64>(item.chunk.size) &&
            sha256(item.path).toHex().toStdString() == digest) {
            received += item.chunk.size;
        } else {
            pending.push_back(item);
        }
    }
    QThreadPool downloadPool;
    downloadPool.setMaxThreadCount(3);
    QMutex resultMutex;
    QMutex throttleMutex;
    QElapsedTimer throttleTimer;
    throttleTimer.start();
    std::uint64_t throttledBytes = 0;
    std::optional<OperationResult> firstFailure;
    QtConcurrent::blockingMap(&downloadPool, pending, [&](const PendingChunk& item) {
        {
            QMutexLocker resultLock(&resultMutex);
            if (firstFailure.has_value()) {
                return;
            }
        }
        auto result = downloadChunk(item.chunk, item.path, operationId, speedLimit, received,
                                    release.totalSize, 0, release.files.size(), progress, cancelled,
                                    throttleMutex, throttleTimer, throttledBytes);
        if (!result.ok) {
            QMutexLocker resultLock(&resultMutex);
            if (!firstFailure.has_value()) {
                firstFailure = std::move(result);
            }
        }
    });
    if (firstFailure.has_value()) {
        return *firstFailure;
    }

    std::size_t completedFiles = 0;
    for (const auto& file : release.files) {
        if (cancelled) {
            QDir(stagingRoot).removeRecursively();
            return installFailure(ErrorCode::OperationCancelled, "ダウンロードをキャンセルしました",
                                  "operation cancelled", true);
        }
        if (hasUnsafeLink(stagedRelease, QString::fromStdString(file.path))) {
            return installFailure(ErrorCode::ManifestInvalid, "安全でない保存先を検出しました",
                                  "staging path crosses a symbolic link", false);
        }

        // 並列取得済みの検証済みchunkを参照
        std::vector<QString> verifiedChunks;
        for (const auto& chunk : file.chunks) {
            const QString partPath =
                QDir(chunksRoot).filePath(QString::fromStdString(chunk.sha256));
            if (QFileInfo(partPath).size() != static_cast<qint64>(chunk.size) ||
                sha256(partPath).toHex().toStdString() != chunk.sha256) {
                return installFailure(ErrorCode::FileHashMismatch,
                                      "ダウンロードしたチャンクが破損しています",
                                      "verified chunk disappeared before assembly", true);
            }
            verifiedChunks.push_back(partPath);
        }

        // 検証済みチャンクだけを順番に連結
        const QString destination = QDir(stagedRelease).filePath(QString::fromStdString(file.path));
        QDir().mkpath(QFileInfo(destination).absolutePath());
        QSaveFile output(destination);
        if (!output.open(QIODevice::WriteOnly)) {
            return installFailure(ErrorCode::InstallPermissionDenied,
                                  "ゲームファイルへ書き込めません",
                                  output.errorString().toStdString());
        }
        for (const auto& chunkPath : verifiedChunks) {
            QFile input(chunkPath);
            if (!input.open(QIODevice::ReadOnly)) {
                return installFailure(ErrorCode::InstallPermissionDenied,
                                      "一時ファイルを読み込めません",
                                      input.errorString().toStdString());
            }
            while (!input.atEnd()) {
                const auto block = input.read(qint64{1024} * 1024);
                if (block.isEmpty() || output.write(block) != block.size()) {
                    return installFailure(ErrorCode::InstallPermissionDenied,
                                          "ゲームファイルを構成できません",
                                          output.errorString().toStdString());
                }
            }
        }
        if (!output.commit() || QFileInfo(destination).size() != static_cast<qint64>(file.size) ||
            sha256(destination).toHex().toStdString() != file.sha256) {
            return installFailure(ErrorCode::FileHashMismatch,
                                  "ダウンロードしたファイルが破損しています",
                                  "assembled file hash mismatch: " + file.path, true);
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
            progress({received.load(), release.totalSize, 0, completedFiles, release.files.size()});
        }
    }

    auto result = activateRelease(release, gameRoot, stagingRoot);
    qInfo().noquote() << "operation=" + operationId
                      << "game=" + QString::fromStdString(release.gameId.value())
                      << "release=" + QString::fromStdString(release.version.value())
                      << (result.ok ? "event=install-complete" : "event=install-failed");
    return result;
}

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
    QDir(stagingRoot).removeRecursively();
    QDir().mkpath(stagedRelease);
    const QStorageInfo storage(stagedRelease);
    if (storage.isValid() && static_cast<std::uint64_t>(std::max<qint64>(
                                 0, storage.bytesAvailable())) < release.totalSize) {
        QDir(stagingRoot).removeRecursively();
        return installFailure(ErrorCode::DiskSpaceInsufficient,
                              "既存ゲームを取り込む空き容量が不足しています",
                              "insufficient disk space for existing game import", false);
    }
    std::uint64_t copiedBytes = 0;
    std::size_t completedFiles = 0;
    for (const auto& file : release.files) {
        const auto relativePath = QString::fromStdString(file.path);
        if (hasUnsafeLink(sourceRoot, relativePath) || hasUnsafeLink(stagedRelease, relativePath)) {
            QDir(stagingRoot).removeRecursively();
            return installFailure(ErrorCode::ManifestInvalid,
                                  "安全でないゲームファイルを検出しました",
                                  "existing game path crosses a symbolic link", false);
        }
        const QString source = QDir(sourceRoot).filePath(relativePath);
        if (QFileInfo(source).size() != static_cast<qint64>(file.size) ||
            sha256(source).toHex().toStdString() != file.sha256) {
            QDir(stagingRoot).removeRecursively();
            return installFailure(ErrorCode::FileHashMismatch,
                                  "選択したゲームは公開中の正規版と一致しません",
                                  "existing file verification failed: " + file.path, false);
        }

        const QString destination = QDir(stagedRelease).filePath(relativePath);
        QDir().mkpath(QFileInfo(destination).absolutePath());
        QFile input(source);
        QSaveFile output(destination);
        if (!input.open(QIODevice::ReadOnly) || !output.open(QIODevice::WriteOnly)) {
            QDir(stagingRoot).removeRecursively();
            return installFailure(ErrorCode::InstallPermissionDenied, "既存ゲームを取り込めません",
                                  "cannot open existing file or staging destination", true);
        }
        while (!input.atEnd()) {
            const auto block = input.read(qint64{1024} * 1024);
            if (block.isEmpty() || output.write(block) != block.size()) {
                QDir(stagingRoot).removeRecursively();
                return installFailure(ErrorCode::InstallPermissionDenied,
                                      "既存ゲームを取り込めません", "copy into staging failed",
                                      true);
            }
        }
        if (!output.commit() || sha256(destination).toHex().toStdString() != file.sha256) {
            QDir(stagingRoot).removeRecursively();
            return installFailure(ErrorCode::FileHashMismatch,
                                  "取り込んだゲームファイルを検証できません",
                                  "staged import hash mismatch", true);
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
    return activateRelease(release, gameRoot, stagingRoot);
}

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
            QFileInfo(path).size() != static_cast<qint64>(file.size) ||
            sha256(path).toHex().toStdString() != file.sha256) {
            return installFailure(ErrorCode::FileHashMismatch, "ゲームファイルの修復が必要です",
                                  "verification failed: " + file.path, true);
        }
    }
    return OperationResult::success();
}

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

OperationResult GameInstallationService::cleanupTemporary(const InstalledGame& installed) {
    const QFileInfo root(QString::fromStdString(installed.gameRoot));
    const QDir launcherRoot(QDir(root.absoluteFilePath()).filePath(".launcher"));
    const auto activeFile = launcherRoot.filePath("active.json");
    const QFileInfo staging(launcherRoot.filePath("staging"));
    const QFileInfo cache(launcherRoot.filePath("cache"));

    // 管理対象の識別markerと直下directoryを検証して削除範囲を固定
    if (isUnsafeLink(root) || root.fileName().toStdString() != installed.gameId.value() ||
        !QFileInfo::exists(activeFile)) {
        return installFailure(ErrorCode::InstallPermissionDenied,
                              "安全性を確認できないため一時データの削除を中止しました",
                              "game root identity marker is missing", false);
    }
    for (const auto& temporary : {staging, cache}) {
        if (!temporary.exists()) {
            continue;
        }
        if (isUnsafeLink(temporary) || !temporary.isDir() ||
            !QDir(temporary.absoluteFilePath()).removeRecursively()) {
            return installFailure(ErrorCode::InstallPermissionDenied,
                                  "一時データを完全に削除できませんでした",
                                  temporary.absoluteFilePath().toStdString(), true);
        }
    }
    return OperationResult::success();
}

OperationResult GameInstallationService::downloadChunk(
    // 同じ文字列型でもfilesystem対象と監査操作IDを区別
    // NOLINTNEXTLINE(bugprone-easily-swappable-parameters)
    const FileChunk& chunk, const QString& partPath, const QString& operationId,
    std::uint64_t speedLimit, std::atomic_uint64_t& aggregateReceived, std::uint64_t aggregateTotal,
    std::size_t completedFiles, std::size_t totalFiles, const ProgressCallback& progress,
    std::atomic_bool& cancelled, QMutex& throttleMutex, QElapsedTimer& throttleTimer,
    std::uint64_t& throttledBytes) {
    constexpr int maximumAttempts = 3;
    QNetworkAccessManager network;
    for (int attempt = 0; attempt < maximumAttempts; ++attempt) {
        QFile output(partPath);
        qint64 existing = output.exists() ? output.size() : 0;
        if (existing < 0 || existing > static_cast<qint64>(chunk.size)) {
            output.remove();
            existing = 0;
        }
        if (!output.open(QIODevice::WriteOnly | QIODevice::Append)) {
            return installFailure(ErrorCode::InstallPermissionDenied,
                                  "一時ファイルへ書き込めません",
                                  output.errorString().toStdString());
        }

        QNetworkRequest request(QUrl(QString::fromStdString(chunk.url)));
        request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                             QNetworkRequest::ManualRedirectPolicy);
        request.setTransferTimeout(30000);
        if (existing > 0) {
            request.setRawHeader("Range", "bytes=" + QByteArray::number(existing) + "-");
        }
        auto* reply = network.get(request);
        reply->setReadBufferSize(qint64{1024} * 1024);
        QEventLoop loop;
        std::uint64_t sessionBytes = 0;
        bool writeFailed = false;
        bool responseTooLarge = false;

        QObject::connect(reply, &QNetworkReply::readyRead, &loop, [&] {
            while (paused_ && !cancelled) {
                QThread::msleep(50);
            }
            if (cancelled || writeFailed) {
                reply->abort();
                return;
            }
            const auto data = reply->readAll();
            const auto remaining = chunk.size - static_cast<std::uint64_t>(existing) - sessionBytes;
            if (static_cast<std::uint64_t>(data.size()) > remaining) {
                responseTooLarge = true;
                reply->abort();
                return;
            }
            if (output.write(data) != data.size()) {
                writeFailed = true;
                reply->abort();
                return;
            }
            sessionBytes += static_cast<std::uint64_t>(data.size());
            if (speedLimit > 0) {
                QMutexLocker throttleLock(&throttleMutex);
                throttledBytes += static_cast<std::uint64_t>(data.size());
                const auto expectedMs = (throttledBytes * 1000ULL) / speedLimit;
                const auto elapsedMs = static_cast<std::uint64_t>(throttleTimer.elapsed());
                if (expectedMs > elapsedMs) {
                    QThread::msleep(static_cast<unsigned long>(expectedMs - elapsedMs));
                }
            }
            if (progress) {
                const auto elapsed = std::max<qint64>(1, throttleTimer.elapsed());
                progress(
                    {aggregateReceived.load() + static_cast<std::uint64_t>(existing) + sessionBytes,
                     aggregateTotal,
                     (aggregateReceived.load() + sessionBytes) * 1000ULL /
                         static_cast<std::uint64_t>(elapsed),
                     completedFiles, totalFiles});
            }
        });
        QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
        loop.exec();
        output.close();

        const auto status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const auto cloudflareRay = reply->rawHeader("CF-Ray");
        const auto error = reply->error();
        const auto errorText = reply->errorString();
        reply->deleteLater();
        if (cancelled) {
            return installFailure(ErrorCode::OperationCancelled, "ダウンロードをキャンセルしました",
                                  "operation cancelled", true);
        }
        if (writeFailed) {
            return installFailure(ErrorCode::InstallPermissionDenied,
                                  "一時ファイルへ書き込めません",
                                  "write failed while streaming chunk", true);
        }
        if (existing > 0 && status == 200) {
            // Rangeを無視した完全応答は既存partialへ連結せず最初から取得し直す
            QFile::remove(partPath);
            continue;
        }
        if (responseTooLarge) {
            QFile::remove(partPath);
            return installFailure(ErrorCode::DownloadHttpError,
                                  "配布データのサイズがマニフェストと一致しません",
                                  "chunk response exceeded its declared size", false);
        }
        if (error == QNetworkReply::NoError &&
            QFileInfo(partPath).size() == static_cast<qint64>(chunk.size) &&
            sha256(partPath).toHex().toStdString() == chunk.sha256) {
            aggregateReceived += chunk.size;
            return OperationResult::success();
        }
        if (status >= 400 && status < 500) {
            QFile::remove(partPath);
            return installFailure(
                ErrorCode::DownloadHttpError, "ゲームファイルを取得できません",
                "HTTP " + std::to_string(status) + ": " + errorText.toStdString() +
                    (cloudflareRay.isEmpty() ? std::string{}
                                             : " CF-Ray=" + cloudflareRay.toStdString()),
                false);
        }
        if (status >= 500 || QFileInfo(partPath).size() >= static_cast<qint64>(chunk.size)) {
            // HTTP error bodyや完全長の破損dataをRange再開の入力へ残さない
            QFile::remove(partPath);
        }
        qWarning().noquote() << "operation=" + operationId << "event=download-retry"
                             << "httpStatus=" + QString::number(status)
                             << "attempt=" + QString::number(attempt + 1);
        QThread::msleep(200UL * (1UL << static_cast<unsigned int>(attempt)));
    }
    return installFailure(ErrorCode::DownloadHttpError,
                          "通信が安定しません。しばらくして再試行してください",
                          "chunk retry limit reached", true);
}

QByteArray GameInstallationService::sha256(const QString& path) {
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) {
        return {};
    }
    QCryptographicHash hash(QCryptographicHash::Sha256);
    while (!file.atEnd()) {
        const auto block = file.read(qint64{1024} * 1024);
        if (block.isEmpty() && file.error() != QFile::NoError) {
            return {};
        }
        hash.addData(block);
    }
    return hash.result();
}

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

OperationResult GameInstallationService::writeActiveVersion(const QString& gameRoot,
                                                            const std::string& version) {
    const QString launcherRoot = QDir(gameRoot).filePath(".launcher");
    QDir().mkpath(launcherRoot);
    QSaveFile active(QDir(launcherRoot).filePath("active.json"));
    if (!active.open(QIODevice::WriteOnly) ||
        active.write(QJsonDocument(QJsonObject{{"schemaVersion", 1},
                                               {"version", QString::fromStdString(version)}})
                         .toJson(QJsonDocument::Indented)) < 0 ||
        !active.commit()) {
        return installFailure(ErrorCode::InstallPermissionDenied, "有効なゲーム版を記録できません",
                              active.errorString().toStdString(), true);
    }
    return OperationResult::success();
}

OperationResult
GameInstallationService::activateRelease(const GameRelease& release,
                                         // 各pathは異なる配置phaseを表現
                                         // NOLINTNEXTLINE(bugprone-easily-swappable-parameters)
                                         const QString& gameRoot, const QString& stagingRoot) {
    const QString launcherRoot = QDir(gameRoot).filePath(".launcher");
    const QString stagedRelease = QDir(stagingRoot).filePath("release");
    const QString finalRelease =
        QDir(gameRoot).filePath("releases/" + QString::fromStdString(release.version.value()));
    const QString trashRelease =
        QDir(launcherRoot).filePath("trash/" + QString::fromStdString(release.version.value()));
    QDir().mkpath(QDir(gameRoot).filePath("releases"));
    QDir().mkpath(QDir(launcherRoot).filePath("trash"));

    // 完全検証後だけactive releaseをrollback可能に切り替え
    if (!moveAside(finalRelease, trashRelease) || !QDir().rename(stagedRelease, finalRelease)) {
        if (QFileInfo::exists(trashRelease) && !QFileInfo::exists(finalRelease)) {
            QDir().rename(trashRelease, finalRelease);
        }
        return installFailure(ErrorCode::InstallPermissionDenied, "ゲームの更新を有効化できません",
                              "atomic release directory switch failed", true);
    }
    auto result = writeActiveVersion(gameRoot, release.version.value());
    if (!result.ok) {
        QDir(finalRelease).removeRecursively();
        QDir().rename(trashRelease, finalRelease);
        return result;
    }
    QDir(stagingRoot).removeRecursively();
    cleanOldReleases(gameRoot, QString::fromStdString(release.version.value()));
    return OperationResult::success();
}

// rootとactive versionを異なるdomain値として受け取る
// NOLINTNEXTLINE(bugprone-easily-swappable-parameters)
void GameInstallationService::cleanOldReleases(const QString& gameRoot,
                                               const QString& activeVersion) {
    QDir releases(QDir(gameRoot).filePath("releases"));
    auto entries = releases.entryInfoList(QDir::Dirs | QDir::NoDotAndDotDot, QDir::Time);
    bool previousKept = false;
    for (const auto& entry : entries) {
        if (entry.fileName() == activeVersion) {
            continue;
        }
        if (!previousKept) {
            previousKept = true;
            continue;
        }
        QDir(entry.absoluteFilePath()).removeRecursively();
    }
}

} // namespace pandd
