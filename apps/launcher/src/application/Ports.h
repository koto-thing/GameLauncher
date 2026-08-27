#pragma once

#include "domain/Models.h"

#include <atomic>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace pandd {

/** @brief カタログ取得Port */
class IGameCatalogRepository {
  public:
    /** @brief Portのデストラクター */
    virtual ~IGameCatalogRepository() = default;

    /** @brief 対象言語のカタログを取得する */
    virtual std::vector<GameCatalogEntry> fetchCatalog(const std::string& language) = 0;

    /** @brief 対象言語のお知らせを取得する */
    virtual std::vector<Announcement> fetchAnnouncements(const std::string& language) = 0;
};

/** @brief ゲームリリース取得Port */
class IGameReleaseRepository {
  public:
    /** @brief Portのデストラクター */
    virtual ~IGameReleaseRepository() = default;

    /** @brief 指定URLから検証済みリリースを取得する */
    virtual GameRelease fetchLatestRelease(const std::string& releaseUrl) = 0;
};

/** @brief ランチャーrelease metadata取得Port */
class ILauncherReleaseRepository {
  public:
    /** @brief Portのデストラクター */
    virtual ~ILauncherReleaseRepository() = default;

    /** @brief 対象言語・現在platformの最新releaseを取得する */
    virtual LauncherRelease fetchLatestLauncherRelease(const std::string& language) = 0;

    /** @brief 対象言語のランチャー更新履歴を取得する */
    virtual std::vector<LauncherChangelogEntry>
    fetchLauncherChangelog(const std::string& language) = 0;
};

/** @brief 導入済みゲーム永続化Port */
class IInstalledGameRepository {
  public:
    /** @brief Portのデストラクター */
    virtual ~IInstalledGameRepository() = default;

    /** @brief 全導入済みゲームを読み込む */
    virtual std::vector<InstalledGame> loadAll() = 0;

    /** @brief 導入済みゲームを原子的に保存する */
    virtual OperationResult save(const InstalledGame& game) = 0;

    /** @brief 導入記録を削除する */
    virtual OperationResult remove(const GameId& gameId) = 0;
};

/** @brief ランチャー設定永続化Port */
class ISettingsRepository {
  public:
    /** @brief Portのデストラクター */
    virtual ~ISettingsRepository() = default;

    /** @brief 保存済み設定または既定値を読み込む */
    virtual LauncherSettings load() = 0;

    /** @brief 設定を原子的に保存する */
    virtual OperationResult save(const LauncherSettings& settings) = 0;
};

/** @brief 安全なリリース配置Port */
class IGameInstallationService {
  public:
    /** @brief Portのデストラクター */
    virtual ~IGameInstallationService() = default;

    /** @brief stagingへ取得して検証後にリリースを切り替える */
    virtual OperationResult install(const GameRelease& release, const std::string& gameRoot,
                                    std::uint64_t speedLimit, const ProgressCallback& progress,
                                    std::atomic_bool& cancelled) = 0;

    /** @brief activeリリース全体の完全性を検証する */
    virtual OperationResult verify(const InstalledGame& installed, const GameRelease& release) = 0;

    /** @brief 永続記録とgame rootのactive markerが一致するか検証する */
    virtual OperationResult validateActivation(const InstalledGame& installed) = 0;

    /** @brief ゲーム本体だけを削除しsave dataを保持する */
    virtual OperationResult uninstall(const InstalledGame& installed) = 0;

    /** @brief 既存directoryを完全検証して管理releaseへ取り込む */
    virtual OperationResult importExisting(const GameRelease& release,
                                           const std::string& sourceDirectory,
                                           const std::string& gameRoot,
                                           const ProgressCallback& progress) = 0;

    /** @brief 失敗した取得のstaging dataだけを削除する */
    virtual OperationResult cleanupTemporary(const InstalledGame& installed) = 0;

    /** @brief 実行中取得を一時停止する */
    virtual void pause() = 0;

    /** @brief 一時停止中取得を再開する */
    virtual void resume() = 0;
};

/** @brief ゲームプロセス制御Port */
class IGameProcessService {
  public:
    /** @brief ゲーム終了通知関数 */
    using ExitCallback = std::function<void(int exitCode, bool crashed)>;

    /** @brief Portのデストラクター */
    virtual ~IGameProcessService() = default;

    /** @brief shellを介さずmain processを起動し監視する */
    virtual OperationResult launch(const InstalledGame& installed, const std::string& saveDirectory,
                                   ExitCallback onExit) = 0;

    /** @brief 指定ゲームが実行中かを返す */
    [[nodiscard]] virtual bool isRunning(const GameId& gameId) const = 0;
};

/** @brief OSログイン時起動Port */
class IStartupService {
  public:
    /** @brief Portのデストラクター */
    virtual ~IStartupService() = default;

    /** @brief OSの起動登録を設定値へ同期する */
    virtual OperationResult apply(bool enabled, bool minimized) = 0;
};

/** @brief Qt IFW Maintenance Tool制御Port */
class ILauncherUpdateService {
  public:
    /** @brief Portのデストラクター */
    virtual ~ILauncherUpdateService() = default;

    /** @brief Maintenance Toolで更新有無を確認する */
    virtual OperationResult check() = 0;

    /** @brief Maintenance Toolを起動して更新適用を委譲する */
    virtual OperationResult apply() = 0;
};

/** @brief 再現可能に差し替えられるUTC時計Port */
class IClock {
  public:
    /** @brief Portのデストラクター */
    virtual ~IClock() = default;

    /** @brief 現在時刻をUTC RFC 3339で返す */
    virtual std::string nowUtc() = 0;
};

} // namespace pandd
