#pragma once

#include "application/Ports.h"

#include <atomic>
#include <functional>
#include <mutex>

namespace pandd {

/** @brief UIから利用するランチャー操作のApplication Facade */
class LauncherService final {
  public:
    /** @brief 状態変更通知関数 */
    using StateCallback = std::function<void(const GameId&, InstallState, const OperationError&)>;

    /** @brief 必要なPortを借用して構築する */
    LauncherService(IGameCatalogRepository& catalogRepository,
                    IGameReleaseRepository& releaseRepository,
                    ILauncherReleaseRepository& launcherReleaseRepository,
                    IInstalledGameRepository& installedRepository,
                    ISettingsRepository& settingsRepository,
                    IGameInstallationService& installationService,
                    IGameProcessService& processService, IStartupService& startupService,
                    ILauncherUpdateService& updateService, IClock& clock,
                    SemanticVersion currentVersion);

    /** @brief 設定、導入状態、カタログ、お知らせを読み込む */
    OperationResult load();

    /** @brief カタログとお知らせを再取得する */
    OperationResult refreshCatalog();

    /** @brief 指定ゲームを新規導入または更新する */
    OperationResult installOrUpdate(const GameId& gameId, const ProgressCallback& progress);

    /** @brief 既存ゲームdirectoryを正規releaseと照合して登録する */
    OperationResult locateExisting(const GameId& gameId, const std::string& sourceDirectory,
                                   const ProgressCallback& progress);

    /** @brief activeリリースを検証する */
    OperationResult verify(const GameId& gameId);

    /** @brief 検証後に必要ファイルを安全な再導入で修復する */
    OperationResult repair(const GameId& gameId, const ProgressCallback& progress);

    /** @brief ゲーム本体をアンインストールする */
    OperationResult uninstall(const GameId& gameId);

    /** @brief 指定ゲームの失敗した一時dataを削除する */
    OperationResult cleanupTemporary(const GameId& gameId);

    /** @brief 正規entrypointを起動して終了まで監視する */
    OperationResult launch(const GameId& gameId);

    /** @brief 設定に従い起動前更新を完了させる */
    OperationResult prepareLaunch(const GameId& gameId, const ProgressCallback& progress);

    /** @brief 実行中の操作へキャンセルを要求する */
    void cancel();

    /** @brief 指定ゲームの取得を一時停止する */
    void pause(const GameId& gameId);

    /** @brief 指定ゲームの取得を再開する */
    void resume(const GameId& gameId);

    /** @brief 設定をOS状態と永続ストアへ反映する */
    OperationResult saveSettings(const LauncherSettings& settings);

    /** @brief Launcher更新を確認する */
    OperationResult checkLauncherUpdate();

    /** @brief Launcher更新をMaintenance Toolへ委譲する */
    OperationResult applyLauncherUpdate();

    /** @brief 最後に確認したLauncher更新状態を返す */
    [[nodiscard]] LauncherUpdateStatus launcherUpdateStatus() const;

    /** @brief 取得済みLauncher更新履歴を返す */
    [[nodiscard]] const std::vector<LauncherChangelogEntry>& launcherChangelog() const;

    /** @brief 現在のカタログを返す */
    [[nodiscard]] const std::vector<GameCatalogEntry>& catalog() const;

    /** @brief 現在のお知らせを返す */
    [[nodiscard]] const std::vector<Announcement>& announcements() const;

    /** @brief 現在の導入済みゲームを返す */
    [[nodiscard]] const std::vector<InstalledGame>& installedGames() const;

    /** @brief 現在の設定を返す */
    [[nodiscard]] const LauncherSettings& settings() const;

    /** @brief 指定ゲームの安定したsave data directoryを返す */
    [[nodiscard]] std::optional<std::string> saveDirectory(const GameId& gameId) const;

    /** @brief manifest名からplatform別save data rootを解決する */
    [[nodiscard]] static std::string resolveSaveDirectory(const std::string& saveDirectoryName);

    /** @brief 状態変更通知を登録する */
    void setStateCallback(StateCallback callback);

  private:
    /** @brief 対象ゲームのカタログ要素を検索する */
    [[nodiscard]] const GameCatalogEntry* findCatalogEntry(const GameId& gameId) const;

    /** @brief 対象ゲームの導入情報を検索する */
    [[nodiscard]] InstalledGame* findInstalled(const GameId& gameId);

    /** @brief 状態変更をUIへ通知する */
    void notifyState(const GameId& gameId, InstallState state,
                     const OperationError& error = OperationError{});

    /** @brief game releaseが現在Launcherで処理可能か検証する */
    [[nodiscard]] OperationResult ensureLauncherCompatible(const GameRelease& release) const;

    IGameCatalogRepository& catalogRepository_;
    IGameReleaseRepository& releaseRepository_;
    ILauncherReleaseRepository& launcherReleaseRepository_;
    IInstalledGameRepository& installedRepository_;
    ISettingsRepository& settingsRepository_;
    IGameInstallationService& installationService_;
    IGameProcessService& processService_;
    IStartupService& startupService_;
    ILauncherUpdateService& updateService_;
    IClock& clock_;
    SemanticVersion currentVersion_;
    std::optional<LauncherRelease> latestLauncherRelease_;
    std::vector<LauncherChangelogEntry> launcherChangelog_;
    LauncherSettings settings_;
    std::vector<GameCatalogEntry> catalog_;
    std::vector<Announcement> announcements_;
    std::vector<InstalledGame> installed_;
    std::atomic_bool cancelled_{false};
    std::atomic_int activeOperations_{0};
    StateCallback stateCallback_;
};

} // namespace pandd
