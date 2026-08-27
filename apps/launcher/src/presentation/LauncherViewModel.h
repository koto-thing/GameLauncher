#pragma once

#include "application/LauncherService.h"

#include <QObject>
#include <QThreadPool>

#include <functional>

namespace pandd {

/** @brief LauncherServiceをQt signalへ変換する画面状態Adapter */
class LauncherViewModel final : public QObject {
    Q_OBJECT

  public:
    /** @brief Application Facadeを借用して構築する */
    explicit LauncherViewModel(LauncherService& service, QObject* parent = nullptr);

    /** @brief 実行中taskをcancelして完了まで待機する */
    ~LauncherViewModel() override;

    /** @brief 初期データを非同期に読み込む */
    void initialize();

    /** @brief 最新カタログを返す */
    [[nodiscard]] const std::vector<GameCatalogEntry>& catalog() const;

    /** @brief 導入済みゲームを返す */
    [[nodiscard]] const std::vector<InstalledGame>& installedGames() const;

    /** @brief お知らせを返す */
    [[nodiscard]] const std::vector<Announcement>& announcements() const;

    /** @brief 現在設定を返す */
    [[nodiscard]] const LauncherSettings& settings() const;

    /** @brief 取得済みランチャー更新履歴を返す */
    [[nodiscard]] const std::vector<LauncherChangelogEntry>& launcherChangelog() const;

    /** @brief 指定ゲームのsave data directoryを返す */
    [[nodiscard]] QString saveDirectory(const QString& gameId) const;

    /** @brief ゲームを非同期に導入または更新する */
    void installOrUpdate(const QString& gameId);

    /** @brief 選択directoryの既存ゲームを非同期検証して取り込む */
    void locateExisting(const QString& gameId, const QString& sourceDirectory);

    /** @brief ゲームを起動する */
    void launch(const QString& gameId);

    /** @brief ゲームファイルを非同期検証する */
    void verify(const QString& gameId);

    /** @brief ゲームファイルを非同期修復する */
    void repair(const QString& gameId);

    /** @brief ゲームを非同期アンインストールする */
    void uninstall(const QString& gameId);

    /** @brief 失敗した一時dataを非同期削除する */
    void cleanupTemporary(const QString& gameId);

    /** @brief 設定を非同期保存する */
    void saveSettings(LauncherSettings settings);

    /** @brief Maintenance Toolで更新有無を確認する */
    void checkLauncherUpdate();

    /** @brief Maintenance Toolへ更新適用を委譲する */
    void applyLauncherUpdate();

    /** @brief 実行中処理へキャンセルを要求する */
    void cancel();

    /** @brief 取得を一時停止する */
    void pause(const QString& gameId);

    /** @brief 取得を再開する */
    void resume(const QString& gameId);

  signals:
    /** @brief 初期データを読み終えたことを通知する */
    void loaded();

    /** @brief 表示データが変化したことを通知する */
    void dataChanged();

    /** @brief 利用者向けエラーを通知する */
    void errorOccurred(const QString& message, bool retryable);

    /** @brief ゲーム状態変更を通知する */
    void gameStateChanged(const QString& gameId, int state);

    /** @brief 進捗表示値を通知する */
    void progressChanged(const QString& gameId, quint64 received, quint64 total,
                         quint64 bytesPerSecond, int completedFiles, int totalFiles);

    /** @brief ランチャー更新確認結果を通知する */
    void launcherUpdateChecked(const QString& currentVersion, const QString& latestVersion,
                               const QString& title, const QString& checkedAt, bool updateAvailable,
                               bool mandatory);

    /** @brief Maintenance Tool起動成功を通知する */
    void launcherUpdateStarted();

  private:
    /** @brief Application操作をthread poolで実行する */
    void runAsync(std::function<OperationResult()> operation, bool refreshOnSuccess = false,
                  bool notifyLoaded = false);

    LauncherService& service_;
    QThreadPool operationPool_;
    std::vector<GameCatalogEntry> catalog_;
    std::vector<InstalledGame> installedGames_;
    std::vector<Announcement> announcements_;
    std::vector<LauncherChangelogEntry> launcherChangelog_;
    LauncherSettings settings_;
};

} // namespace pandd
