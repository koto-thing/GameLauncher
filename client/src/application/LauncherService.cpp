#include "application/LauncherService.h"
#include "application/Localization.h"

#include <algorithm>
#include <cstdlib>
#include <filesystem>
#include <stdexcept>

namespace pandd {
namespace {

/** @brief 例外を安定したネットワークエラーへ変換する */
OperationResult loadFailure(const std::exception& exception) {
    return OperationResult::failure({
        .code = ErrorCode::NetworkOffline,
        .userMessage = "配布サーバーへ接続できません。接続を確認して再試行してください",
        .detail = exception.what(),
        .retryable = true,
    });
}

/** @brief 永続化前後で共通の設定値制約を検証する */
OperationResult validateSettings(const LauncherSettings& settings) {
    // 公開pathへ使う言語tagを検証
    if (!isValidLocaleTag(settings.language)) {
        return OperationResult::failure({ErrorCode::ManifestInvalid,
                                         "対応していない言語が選択されています",
                                         "unsupported launcher language", false});
    }
    // install rootを絶対pathに限定
    if (settings.installRoot.empty() ||
        !std::filesystem::path(settings.installRoot).is_absolute()) {
        return OperationResult::failure({ErrorCode::ManifestInvalid,
                                         "ゲーム保存先には絶対パスを指定してください",
                                         "install root must be an absolute path", false});
    }
    // 不正値による実質的な無制限化を防止
    if (settings.downloadLimitBytesPerSecond > 1024ULL * 1024ULL * 1024ULL) {
        return OperationResult::failure({ErrorCode::ManifestInvalid,
                                         "速度上限は1 GB/s以下にしてください",
                                         "download limit out of range", false});
    }
    return OperationResult::success();
}

/** @brief 長時間操作数をscope単位で追跡する */
class ActiveOperation final {
  public:
    /** @brief 操作数を増やす */
    explicit ActiveOperation(std::atomic_int& count) : count_(count) { ++count_; }

    /** @brief 操作数を戻す */
    ~ActiveOperation() { --count_; }

    /** @brief 二重減算を防ぐためcopyを禁止する */
    ActiveOperation(const ActiveOperation&) = delete;

    /** @brief 二重減算を防ぐためcopy代入を禁止する */
    ActiveOperation& operator=(const ActiveOperation&) = delete;

  private:
    std::atomic_int& count_;
};

} // namespace

LauncherService::LauncherService(
    IGameCatalogRepository& catalogRepository, IGameReleaseRepository& releaseRepository,
    ILauncherReleaseRepository& launcherReleaseRepository,
    IInstalledGameRepository& installedRepository, ISettingsRepository& settingsRepository,
    IGameInstallationService& installationService, IGameProcessService& processService,
    IStartupService& startupService, ILauncherUpdateService& updateService, IClock& clock,
    SemanticVersion currentVersion)
    : catalogRepository_(catalogRepository), releaseRepository_(releaseRepository),
      launcherReleaseRepository_(launcherReleaseRepository),
      installedRepository_(installedRepository), settingsRepository_(settingsRepository),
      installationService_(installationService), processService_(processService),
      startupService_(startupService), updateService_(updateService), clock_(clock),
      currentVersion_(std::move(currentVersion)) {}

OperationResult LauncherService::load() {
    try {
        // 設定を検証してから他の状態を読み込む
        settings_ = settingsRepository_.load();
        const auto validation = validateSettings(settings_);
        if (!validation.ok) {
            return validation;
        }
        // 有効化markerと一致する導入記録だけを保持
        installed_ = installedRepository_.loadAll();
        for (auto iterator = installed_.begin(); iterator != installed_.end();) {
            if (installationService_.validateActivation(*iterator).ok) {
                ++iterator;
                continue;
            }
            // 壊れたlocal recordだけを外しgame dataは修復操作まで保持
            const auto removal = installedRepository_.remove(iterator->gameId);
            if (!removal.ok) {
                return removal;
            }
            iterator = installed_.erase(iterator);
        }
        return refreshCatalog();
    } catch (const std::exception& exception) {
        return OperationResult::failure({ErrorCode::InstallPermissionDenied,
                                         "ランチャー情報を読み込めません", exception.what(), true});
    }
}

OperationResult LauncherService::refreshCatalog() {
    try {
        // 同じ言語の表示データを一まとまりとして更新
        auto catalog = catalogRepository_.fetchCatalog(settings_.language);
        auto announcements = catalogRepository_.fetchAnnouncements(settings_.language);
        catalog_ = std::move(catalog);
        announcements_ = std::move(announcements);
        return OperationResult::success();
    } catch (const std::exception& exception) {
        return loadFailure(exception);
    }
}

OperationResult LauncherService::installOrUpdate(const GameId& gameId,
                                                 const ProgressCallback& progress) {
    ActiveOperation operation(activeOperations_);
    // catalog登録とprocess状態を操作開始前に検証
    const auto* entry = findCatalogEntry(gameId);
    if (entry == nullptr) {
        return OperationResult::failure({ErrorCode::ManifestInvalid,
                                         "ゲーム情報を再読み込みしてください",
                                         "game missing from catalog", true});
    }
    if (processService_.isRunning(gameId)) {
        return OperationResult::failure({ErrorCode::GameAlreadyRunning,
                                         "ゲームの終了後に更新してください",
                                         "active game process blocks update", true});
    }
    if (!settings_.continueOtherDownloadsWhilePlaying &&
        std::any_of(installed_.begin(), installed_.end(),
                    [this](const auto& game) { return processService_.isRunning(game.gameId); })) {
        return OperationResult::failure({ErrorCode::GameAlreadyRunning,
                                         "実行中のゲームを終了してからダウンロードしてください",
                                         "download while another game runs is disabled", true});
    }

    // 取得から永続化までの状態遷移をUIへ通知
    try {
        cancelled_ = false;
        notifyState(gameId, InstallState::Resolving);
        const auto release = releaseRepository_.fetchLatestRelease(entry->latestReleaseUrl);
        const auto compatibility = ensureLauncherCompatible(release);
        if (!compatibility.ok) {
            notifyState(gameId, InstallState::Failed, compatibility.error);
            return compatibility;
        }
        const std::filesystem::path gameRoot =
            std::filesystem::path(settings_.installRoot) / gameId.value();

        // activeリリースを変更せずstagingへ取得
        notifyState(gameId, InstallState::Downloading);
        auto result = installationService_.install(release, gameRoot.string(),
                                                   settings_.downloadLimitBytesPerSecond, progress,
                                                   cancelled_);
        if (!result.ok) {
            notifyState(gameId, InstallState::Failed, result.error);
            return result;
        }

        // 切替完了後だけ導入記録を更新
        InstalledGame installed{release.gameId,           release.version,
                                gameRoot.string(),        release.entrypoint,
                                release.workingDirectory, release.saveDirectoryName,
                                release.totalSize};
        result = installedRepository_.save(installed);
        if (!result.ok) {
            notifyState(gameId, InstallState::Failed, result.error);
            return result;
        }
        if (auto* current = findInstalled(gameId); current != nullptr) {
            *current = installed;
        } else {
            installed_.push_back(installed);
        }
        notifyState(gameId, InstallState::Ready);
        return OperationResult::success();
    } catch (const std::exception& exception) {
        auto result = loadFailure(exception);
        notifyState(gameId, InstallState::Failed, result.error);
        return result;
    }
}

OperationResult LauncherService::locateExisting(const GameId& gameId,
                                                const std::string& sourceDirectory,
                                                const ProgressCallback& progress) {
    ActiveOperation operation(activeOperations_);
    // catalogから照合対象の正規releaseを解決
    const auto* entry = findCatalogEntry(gameId);
    if (entry == nullptr) {
        return OperationResult::failure({ErrorCode::ManifestInvalid,
                                         "ゲーム情報を再読み込みしてください",
                                         "game missing from catalog", true});
    }
    try {
        // source directory全体を正規releaseと照合
        notifyState(gameId, InstallState::Verifying);
        const auto release = releaseRepository_.fetchLatestRelease(entry->latestReleaseUrl);
        const auto compatibility = ensureLauncherCompatible(release);
        if (!compatibility.ok) {
            notifyState(gameId, InstallState::Failed, compatibility.error);
            return compatibility;
        }
        const auto gameRoot =
            (std::filesystem::path(settings_.installRoot) / gameId.value()).string();
        auto result =
            installationService_.importExisting(release, sourceDirectory, gameRoot, progress);
        if (!result.ok) {
            notifyState(gameId, InstallState::Failed, result.error);
            return result;
        }

        // 検証済みreleaseを有効化した後だけ導入記録へ追加
        InstalledGame installed{
            release.gameId,     release.version,          gameRoot,
            release.entrypoint, release.workingDirectory, release.saveDirectoryName,
            release.totalSize};
        result = installedRepository_.save(installed);
        if (!result.ok) {
            notifyState(gameId, InstallState::Failed, result.error);
            return result;
        }
        if (auto* current = findInstalled(gameId); current != nullptr) {
            *current = installed;
        } else {
            installed_.push_back(installed);
        }
        notifyState(gameId, InstallState::Ready);
        return OperationResult::success();
    } catch (const std::exception& exception) {
        auto result = loadFailure(exception);
        notifyState(gameId, InstallState::Failed, result.error);
        return result;
    }
}

OperationResult LauncherService::verify(const GameId& gameId) {
    ActiveOperation operation(activeOperations_);
    // 導入記録と最新release情報の両方を要求
    auto* installed = findInstalled(gameId);
    const auto* entry = findCatalogEntry(gameId);
    if (installed == nullptr || entry == nullptr) {
        return OperationResult::failure({ErrorCode::ManifestInvalid,
                                         "このゲームはインストールされていません",
                                         "verify target is unavailable", false});
    }
    try {
        // 最新manifestを基準にactive releaseを検証
        notifyState(gameId, InstallState::Verifying);
        const auto release = releaseRepository_.fetchLatestRelease(entry->latestReleaseUrl);
        const auto compatibility = ensureLauncherCompatible(release);
        if (!compatibility.ok) {
            notifyState(gameId, InstallState::Failed, compatibility.error);
            return compatibility;
        }
        auto result = installationService_.verify(*installed, release);
        notifyState(gameId, result.ok ? InstallState::Ready : InstallState::Failed, result.error);
        return result;
    } catch (const std::exception& exception) {
        auto result = loadFailure(exception);
        notifyState(gameId, InstallState::Failed, result.error);
        return result;
    }
}

OperationResult LauncherService::repair(const GameId& gameId, const ProgressCallback& progress) {
    ActiveOperation operation(activeOperations_);
    // 正常な場合は再取得せず完了
    auto result = verify(gameId);
    if (result.ok) {
        return result;
    }
    // 破損時だけ安全な再導入へ移行
    notifyState(gameId, InstallState::Repairing);
    return installOrUpdate(gameId, progress);
}

OperationResult LauncherService::uninstall(const GameId& gameId) {
    ActiveOperation operation(activeOperations_);
    auto* installed = findInstalled(gameId);
    if (installed == nullptr) {
        return OperationResult::success();
    }
    if (processService_.isRunning(gameId)) {
        return OperationResult::failure({ErrorCode::GameAlreadyRunning,
                                         "ゲームを終了してからアンインストールしてください",
                                         "active game process blocks uninstall", true});
    }

    // save dataは対象外にしてゲームrootだけを削除
    auto result = installationService_.uninstall(*installed);
    if (result.ok) {
        result = installedRepository_.remove(gameId);
    }
    if (result.ok) {
        std::erase_if(installed_,
                      [&gameId](const InstalledGame& value) { return value.gameId == gameId; });
        notifyState(gameId, InstallState::NotInstalled);
    }
    return result;
}

OperationResult LauncherService::cleanupTemporary(const GameId& gameId) {
    ActiveOperation operation(activeOperations_);
    auto* installed = findInstalled(gameId);
    if (installed == nullptr) {
        return OperationResult::failure({ErrorCode::ManifestInvalid,
                                         "このゲームはインストールされていません",
                                         "temporary cleanup target is unavailable", false});
    }
    if (processService_.isRunning(gameId)) {
        return OperationResult::failure({ErrorCode::GameAlreadyRunning,
                                         "ゲームを終了してから一時データを削除してください",
                                         "active game process blocks temporary cleanup", true});
    }
    return installationService_.cleanupTemporary(*installed);
}

OperationResult LauncherService::launch(const GameId& gameId) {
    // 永続化済みの導入情報を起動契約として使用
    auto* installed = findInstalled(gameId);
    if (installed == nullptr) {
        return OperationResult::failure({ErrorCode::LaunchExecutableMissing,
                                         "ゲームをインストールしてください",
                                         "missing installed state", false});
    }
    // process終了callbackでReady状態へ戻す
    notifyState(gameId, InstallState::Running);
    auto result = processService_.launch(
        *installed, resolveSaveDirectory(installed->saveDirectoryName),
        [this, gameId](int, bool) { notifyState(gameId, InstallState::Ready); });
    if (!result.ok) {
        notifyState(gameId, InstallState::Failed, result.error);
    }
    return result;
}

OperationResult LauncherService::prepareLaunch(const GameId& gameId,
                                               const ProgressCallback& progress) {
    ActiveOperation operation(activeOperations_);
    // 設定で無効な場合や未導入の場合は更新確認を省略
    auto* installed = findInstalled(gameId);
    const auto* entry = findCatalogEntry(gameId);
    if (installed == nullptr || entry == nullptr || !settings_.checkGameUpdateBeforeLaunch) {
        return OperationResult::success();
    }
    try {
        // 最新releaseが新しい場合だけ更新を適用
        notifyState(gameId, InstallState::CheckingUpdate);
        const auto latest = releaseRepository_.fetchLatestRelease(entry->latestReleaseUrl);
        const auto compatibility = ensureLauncherCompatible(latest);
        if (!compatibility.ok) {
            notifyState(gameId, InstallState::Failed, compatibility.error);
            return compatibility;
        }
        if (latest.version > installed->version) {
            return installOrUpdate(gameId, progress);
        }
        notifyState(gameId, InstallState::Ready);
        return OperationResult::success();
    } catch (const std::exception& exception) {
        auto result = loadFailure(exception);
        notifyState(gameId, InstallState::Failed, result.error);
        return result;
    }
}

void LauncherService::cancel() { cancelled_ = true; }

void LauncherService::pause(const GameId& gameId) {
    installationService_.pause();
    notifyState(gameId, InstallState::Paused);
}

void LauncherService::resume(const GameId& gameId) {
    installationService_.resume();
    notifyState(gameId, InstallState::Downloading);
}

OperationResult LauncherService::saveSettings(const LauncherSettings& settings) {
    const auto validation = validateSettings(settings);
    if (!validation.ok) {
        return validation;
    }

    // OS設定が失敗した場合は保存値だけを成功扱いにしない
    auto result = startupService_.apply(settings.startOnLogin, settings.startMinimized);
    if (!result.ok) {
        return result;
    }
    result = settingsRepository_.save(settings);
    if (result.ok) {
        settings_ = settings;
    }
    return result;
}

OperationResult LauncherService::checkLauncherUpdate() {
    try {
        // metadataと履歴を同じ言語で取得
        const auto release =
            launcherReleaseRepository_.fetchLatestLauncherRelease(settings_.language);
        auto changelog = launcherReleaseRepository_.fetchLauncherChangelog(settings_.language);
        latestLauncherRelease_ = release;
        launcherChangelog_ = std::move(changelog);
        // 確認日時を結果判定より先に永続化
        settings_.lastLauncherUpdateCheck = clock_.nowUtc();
        auto result = settingsRepository_.save(settings_);
        if (!result.ok) {
            return result;
        }
        if (release.version <= currentVersion_) {
            return OperationResult::success();
        }

        // 公開metadataとMaintenance Toolの両方が更新を認識することを確認
        return updateService_.check();
    } catch (const std::exception& exception) {
        return OperationResult::failure({ErrorCode::LauncherUpdateFailed,
                                         "ランチャーの更新情報を確認できません", exception.what(),
                                         true});
    }
}

OperationResult LauncherService::applyLauncherUpdate() {
    // 適用対象がなければ何もせず成功
    if (!latestLauncherRelease_.has_value() || latestLauncherRelease_->version <= currentVersion_) {
        return OperationResult::success();
    }
    // file操作中の自己更新を拒否
    if (activeOperations_.load() > 0) {
        return OperationResult::failure({ErrorCode::LauncherUpdateFailed,
                                         "ゲームの処理が完了してから更新してください",
                                         "launcher update blocked by an active operation", true});
    }
    // game process実行中の自己更新を拒否
    for (const auto& game : installed_) {
        if (processService_.isRunning(game.gameId)) {
            return OperationResult::failure({ErrorCode::GameAlreadyRunning,
                                             "ゲームを終了してからランチャーを更新してください",
                                             "launcher update blocked by a game process", true});
        }
    }
    return updateService_.apply();
}

LauncherUpdateStatus LauncherService::launcherUpdateStatus() const {
    // 未確認時は現在versionを最新versionとして返す
    LauncherUpdateStatus status;
    status.currentVersion = currentVersion_;
    status.latestVersion = currentVersion_;
    status.checkedAt = settings_.lastLauncherUpdateCheck;
    if (latestLauncherRelease_.has_value()) {
        status.latestVersion = latestLauncherRelease_->version;
        status.updateAvailable = latestLauncherRelease_->version > currentVersion_;
        status.mandatory = latestLauncherRelease_->mandatory && status.updateAvailable;
        status.title = latestLauncherRelease_->title;
    }
    return status;
}

const std::vector<LauncherChangelogEntry>& LauncherService::launcherChangelog() const {
    return launcherChangelog_;
}

const std::vector<GameCatalogEntry>& LauncherService::catalog() const { return catalog_; }

const std::vector<Announcement>& LauncherService::announcements() const { return announcements_; }

const std::vector<InstalledGame>& LauncherService::installedGames() const { return installed_; }

const LauncherSettings& LauncherService::settings() const { return settings_; }

std::optional<std::string> LauncherService::saveDirectory(const GameId& gameId) const {
    // game IDに対応する導入記録を検索
    const auto iterator =
        std::find_if(installed_.begin(), installed_.end(),
                     [&gameId](const auto& value) { return value.gameId == gameId; });
    if (iterator == installed_.end()) {
        return std::nullopt;
    }
    return resolveSaveDirectory(iterator->saveDirectoryName);
}

void LauncherService::setStateCallback(StateCallback callback) {
    stateCallback_ = std::move(callback);
}

const GameCatalogEntry* LauncherService::findCatalogEntry(const GameId& gameId) const {
    const auto iterator =
        std::find_if(catalog_.begin(), catalog_.end(),
                     [&gameId](const auto& value) { return value.gameId == gameId; });
    return iterator == catalog_.end() ? nullptr : &*iterator;
}

InstalledGame* LauncherService::findInstalled(const GameId& gameId) {
    const auto iterator =
        std::find_if(installed_.begin(), installed_.end(),
                     [&gameId](const auto& value) { return value.gameId == gameId; });
    return iterator == installed_.end() ? nullptr : &*iterator;
}

void LauncherService::notifyState(const GameId& gameId, InstallState state,
                                  const OperationError& error) {
    if (stateCallback_) {
        stateCallback_(gameId, state, error);
    }
}

OperationResult LauncherService::ensureLauncherCompatible(const GameRelease& release) const {
    if (release.minimumLauncherVersion > currentVersion_) {
        return OperationResult::failure(
            {ErrorCode::LauncherUpdateFailed, "先にランチャーを更新してください",
             "game release requires launcher " + release.minimumLauncherVersion.value(), false});
    }
    return OperationResult::success();
}

std::string LauncherService::resolveSaveDirectory(const std::string& saveDirectoryName) {
#if defined(_WIN32)
    // Unity標準のWindows save rootへ解決
    const auto* profile = std::getenv("USERPROFILE");
    return (std::filesystem::path(profile == nullptr ? "." : profile) / "AppData" / "LocalLow" /
            "PandD_org" / saveDirectoryName)
        .string();
#elif defined(__APPLE__)
    // macOSのApplication Support配下へ解決
    const auto* home = std::getenv("HOME");
    return (std::filesystem::path(home == nullptr ? "." : home) / "Library" /
            "Application Support" / "PandD_org" / saveDirectoryName)
        .string();
#else
    // XDG data rootを優先してLinux save pathを解決
    const auto* xdg = std::getenv("XDG_DATA_HOME");
    std::filesystem::path base;
    if (xdg != nullptr && *xdg != '\0') {
        base = xdg;
    } else {
        const auto* home = std::getenv("HOME");
        base = std::filesystem::path(home == nullptr ? "." : home) / ".local" / "share";
    }
    return (base / "PandD_org" / saveDirectoryName).string();
#endif
}

} // namespace pandd
