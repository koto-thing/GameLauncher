#include "presentation/LauncherViewModel.h"

#include <QCoreApplication>
#include <QDir>
#include <QMetaObject>
#include <QThreadPool>

#include <algorithm>

namespace pandd {
namespace {

/** @brief 安定Error Codeを現在言語の利用者メッセージへ変換する */
QString localizedError(const OperationError& error, const std::string& language) {
    Q_UNUSED(language)
    switch (error.code) {
    case ErrorCode::NetworkOffline:
        return QCoreApplication::translate(
            "LauncherErrors", "配布サーバーへ接続できません。接続を確認して再試行してください");
    case ErrorCode::DownloadHttpError:
    case ErrorCode::DownloadRangeUnsupported:
        return QCoreApplication::translate(
            "LauncherErrors", "ゲームファイルを取得できませんでした。再試行してください");
    case ErrorCode::ManifestInvalid:
    case ErrorCode::ManifestSignatureInvalid:
        return QCoreApplication::translate(
            "LauncherErrors", "リリース情報が不正なため、安全のため操作を停止しました");
    case ErrorCode::FileHashMismatch:
        return QCoreApplication::translate(
            "LauncherErrors", "ゲームファイルが破損しています。修復を実行してください");
    case ErrorCode::DiskSpaceInsufficient:
        return QCoreApplication::translate("LauncherErrors", "空き容量が不足しています");
    case ErrorCode::InstallPermissionDenied:
        return QDir::isAbsolutePath(QString::fromStdString(error.detail))
                   ? QCoreApplication::translate("LauncherErrors",
                                                 "操作を完了できませんでした。残っている場所: %1")
                         .arg(QString::fromStdString(error.detail))
                   : QCoreApplication::translate("LauncherErrors", "選択した場所へ書き込めません");
    case ErrorCode::GameAlreadyRunning:
        return QCoreApplication::translate("LauncherErrors",
                                           "ゲームを終了してから操作を続けてください");
    case ErrorCode::LaunchExecutableMissing:
        return QCoreApplication::translate(
            "LauncherErrors", "ゲームの実行ファイルがありません。修復を実行してください");
    case ErrorCode::LauncherUpdateFailed:
        return QCoreApplication::translate("LauncherErrors", "ランチャーの更新操作に失敗しました");
    case ErrorCode::OperationCancelled:
        return QCoreApplication::translate("LauncherErrors", "操作をキャンセルしました");
    case ErrorCode::None:
        return {};
    }
    return QCoreApplication::translate("LauncherErrors", "操作に失敗しました");
}

} // namespace

LauncherViewModel::LauncherViewModel(LauncherService& service, QObject* parent)
    : QObject(parent), service_(service), catalog_(service.catalog()),
      installedGames_(service.installedGames()), announcements_(service.announcements()),
      launcherChangelog_(service.launcherChangelog()), settings_(service.settings()) {
    // 状態を直列更新するためbackground処理を一つに制限
    operationPool_.setMaxThreadCount(1);

    // Application層の状態変更をUI thread上のsignalへ変換
    service_.setStateCallback(
        [this](const GameId& gameId, InstallState state, const OperationError&) {
            QMetaObject::invokeMethod(this, [this, id = gameId.value(), state] {
                emit gameStateChanged(QString::fromStdString(id), static_cast<int>(state));
            });
        });
}

LauncherViewModel::~LauncherViewModel() {
    // callback先の破棄より先に実行中taskを停止
    service_.cancel();
    operationPool_.clear();
    operationPool_.waitForDone();
    service_.setStateCallback({});
}

void LauncherViewModel::initialize() {
    runAsync([this] { return service_.load(); }, true, true);
}

const std::vector<GameCatalogEntry>& LauncherViewModel::catalog() const { return catalog_; }

const std::vector<InstalledGame>& LauncherViewModel::installedGames() const {
    return installedGames_;
}

const std::vector<Announcement>& LauncherViewModel::announcements() const { return announcements_; }

const LauncherSettings& LauncherViewModel::settings() const { return settings_; }

const std::vector<LauncherChangelogEntry>& LauncherViewModel::launcherChangelog() const {
    return launcherChangelog_;
}

QString LauncherViewModel::saveDirectory(const QString& gameId) const {
    // 導入記録から対象gameを検索してplatform別save pathへ変換
    const auto iterator = std::find_if(installedGames_.begin(), installedGames_.end(),
                                       [&gameId](const auto& installed) {
                                           return installed.gameId.value() == gameId.toStdString();
                                       });
    return iterator == installedGames_.end()
               ? QString{}
               : QString::fromStdString(
                     LauncherService::resolveSaveDirectory(iterator->saveDirectoryName));
}

void LauncherViewModel::installOrUpdate(const QString& gameId) {
    const auto id = gameId.toStdString();
    // 長時間処理と進捗通知をUI threadから分離
    runAsync(
        [this, id] {
            return service_.installOrUpdate(GameId(id), [this, id](const DownloadProgress& value) {
                QMetaObject::invokeMethod(this, [this, id, value] {
                    emit progressChanged(QString::fromStdString(id), value.receivedBytes,
                                         value.totalBytes, value.bytesPerSecond,
                                         static_cast<int>(value.completedFiles),
                                         static_cast<int>(value.totalFiles));
                });
            });
        },
        true);
}

void LauncherViewModel::locateExisting(const QString& gameId, const QString& sourceDirectory) {
    const auto id = gameId.toStdString();
    const auto source = sourceDirectory.toStdString();
    // 検証と取込みをbackgroundで実行し進捗だけをUIへ転送
    runAsync(
        [this, id, source] {
            return service_.locateExisting(
                GameId(id), source, [this, id](const DownloadProgress& value) {
                    QMetaObject::invokeMethod(this, [this, id, value] {
                        emit progressChanged(QString::fromStdString(id), value.receivedBytes,
                                             value.totalBytes, value.bytesPerSecond,
                                             static_cast<int>(value.completedFiles),
                                             static_cast<int>(value.totalFiles));
                    });
                });
        },
        true);
}

void LauncherViewModel::launch(const QString& gameId) {
    const auto id = gameId.toStdString();
    // 必要な更新を完了してからgame processを起動
    operationPool_.start([this, id] {
        const auto prepared =
            service_.prepareLaunch(GameId(id), [this, id](const DownloadProgress& value) {
                QMetaObject::invokeMethod(this, [this, id, value] {
                    emit progressChanged(QString::fromStdString(id), value.receivedBytes,
                                         value.totalBytes, value.bytesPerSecond,
                                         static_cast<int>(value.completedFiles),
                                         static_cast<int>(value.totalFiles));
                });
            });
        const auto launched =
            prepared.ok ? service_.launch(GameId(id)) : OperationResult::success();
        // background側で最新snapshotを取得
        const auto catalog = service_.catalog();
        const auto installed = service_.installedGames();
        const auto announcements = service_.announcements();
        const auto settings = service_.settings();
        // 結果とsnapshotをUI threadへまとめて反映
        QMetaObject::invokeMethod(
            this, [this, prepared, launched, catalog, installed, announcements, settings] {
                if (!prepared.ok) {
                    emit errorOccurred(localizedError(prepared.error, settings_.language),
                                       prepared.error.retryable);
                    return;
                }
                catalog_ = catalog;
                installedGames_ = installed;
                announcements_ = announcements;
                settings_ = settings;
                emit dataChanged();
                if (!launched.ok) {
                    emit errorOccurred(localizedError(launched.error, settings_.language),
                                       launched.error.retryable);
                }
            });
    });
}

void LauncherViewModel::verify(const QString& gameId) {
    runAsync([this, id = gameId.toStdString()] { return service_.verify(GameId(id)); });
}

void LauncherViewModel::repair(const QString& gameId) {
    const auto id = gameId.toStdString();
    runAsync(
        [this, id] {
            return service_.repair(GameId(id), [this, id](const DownloadProgress& value) {
                QMetaObject::invokeMethod(this, [this, id, value] {
                    emit progressChanged(QString::fromStdString(id), value.receivedBytes,
                                         value.totalBytes, value.bytesPerSecond,
                                         static_cast<int>(value.completedFiles),
                                         static_cast<int>(value.totalFiles));
                });
            });
        },
        true);
}

void LauncherViewModel::uninstall(const QString& gameId) {
    runAsync([this, id = gameId.toStdString()] { return service_.uninstall(GameId(id)); }, true);
}

void LauncherViewModel::cleanupTemporary(const QString& gameId) {
    runAsync([this, id = gameId.toStdString()] { return service_.cleanupTemporary(GameId(id)); });
}

void LauncherViewModel::saveSettings(LauncherSettings settings) {
    runAsync([this, settings = std::move(settings)] { return service_.saveSettings(settings); },
             true);
}

void LauncherViewModel::checkLauncherUpdate() {
    // 公開metadataと更新toolの確認をbackgroundで実行
    operationPool_.start([this] {
        const auto result = service_.checkLauncherUpdate();
        const auto status = service_.launcherUpdateStatus();
        const auto settings = service_.settings();
        const auto changelog = service_.launcherChangelog();
        // 確認結果と更新履歴をUI threadへ反映
        QMetaObject::invokeMethod(this, [this, result, status, settings, changelog] {
            if (!result.ok) {
                emit errorOccurred(localizedError(result.error, settings_.language),
                                   result.error.retryable);
                return;
            }
            settings_ = settings;
            launcherChangelog_ = changelog;
            emit launcherUpdateChecked(QString::fromStdString(status.currentVersion.value()),
                                       QString::fromStdString(status.latestVersion.value()),
                                       QString::fromStdString(status.title),
                                       QString::fromStdString(status.checkedAt),
                                       status.updateAvailable, status.mandatory);
        });
    });
}

void LauncherViewModel::applyLauncherUpdate() {
    // 更新toolの起動がUIを停止させないようbackgroundで実行
    operationPool_.start([this] {
        const auto result = service_.applyLauncherUpdate();
        QMetaObject::invokeMethod(this, [this, result] {
            if (!result.ok) {
                emit errorOccurred(localizedError(result.error, settings_.language),
                                   result.error.retryable);
                return;
            }
            emit launcherUpdateStarted();
        });
    });
}

void LauncherViewModel::cancel() { service_.cancel(); }

void LauncherViewModel::pause(const QString& gameId) {
    service_.pause(GameId(gameId.toStdString()));
}

void LauncherViewModel::resume(const QString& gameId) {
    service_.resume(GameId(gameId.toStdString()));
}

void LauncherViewModel::runAsync(std::function<OperationResult()> operation, bool refreshOnSuccess,
                                 bool notifyLoaded) {
    // Application操作を単一workerへ投入
    operationPool_.start([this, operation = std::move(operation), refreshOnSuccess, notifyLoaded] {
        OperationResult result;
        // UI境界へ例外を漏らさず安定した操作結果へ変換
        try {
            result = operation();
        } catch (const std::exception& exception) {
            result = OperationResult::failure({ErrorCode::ManifestInvalid,
                                               "処理中に予期しないエラーが発生しました",
                                               exception.what(), true});
        }
        // 成功時だけ一貫した最新snapshotを取得
        const auto catalog = result.ok ? service_.catalog() : std::vector<GameCatalogEntry>{};
        const auto installed = result.ok ? service_.installedGames() : std::vector<InstalledGame>{};
        const auto announcements =
            result.ok ? service_.announcements() : std::vector<Announcement>{};
        const auto settings = result.ok ? service_.settings() : LauncherSettings{};
        // signal送出と画面状態更新をUI threadへ戻す
        QMetaObject::invokeMethod(this, [this, result, refreshOnSuccess, notifyLoaded, catalog,
                                         installed, announcements, settings] {
            if (!result.ok) {
                emit errorOccurred(localizedError(result.error, settings_.language),
                                   result.error.retryable);
                return;
            }
            catalog_ = catalog;
            installedGames_ = installed;
            announcements_ = announcements;
            settings_ = settings;
            if (refreshOnSuccess) {
                emit dataChanged();
            }
            if (notifyLoaded) {
                emit loaded();
            }
        });
    });
}

} // namespace pandd
