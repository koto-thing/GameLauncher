#pragma once

#include <QAbstractNativeEventFilter>
#include <QObject>
#include <QString>
#include <QUrl>

#include <memory>

namespace pandd {

/** @brief この端末で観測したゲーム別の利用履歴 */
struct PlayStatisticsSummary {
    qint64 launchCount{0};
    qint64 totalDurationSeconds{0};
    qint64 interruptedCount{0};
    qint64 launchFailureCount{0};
    QString lastPlayedAt;
};

/** @brief SQLiteで実行時間を保存し、同意がある新規セッションだけを非同期送信する */
class PlayStatisticsService final : public QObject, public QAbstractNativeEventFilter {
    Q_OBJECT

  public:
    /** @brief 専用保存先を開き、未完了記録を中断として回復する */
    PlayStatisticsService(QString dataDirectory, QUrl endpoint, QObject* parent = nullptr);

    /** @brief ゲームを停止せず観測を中断して保存する */
    ~PlayStatisticsService() override;

    /** @brief 運営への統計送信が有効かを返す */
    [[nodiscard]] bool sharingEnabled() const;

    /** @brief 有効な統計APIがビルドに設定されているかを返す */
    [[nodiscard]] bool uploadAvailable() const;

    /** @brief 運営へのデータ削除要求が進行中かを返す */
    [[nodiscard]] bool remoteDeletionInProgress() const;

    /** @brief 同意状態を永続化し、無効化時は未送信記録の送信資格を破棄する */
    void setSharingEnabled(bool enabled);

    /** @brief 指定ゲームの端末内履歴を集計する */
    [[nodiscard]] PlayStatisticsSummary localSummary(const QString& gameId) const;

    /** @brief 端末内履歴を消去し、現在のゲームの観測も終了する */
    void clearLocalHistory();

    /** @brief 起動成功したゲームの観測を開始してセッションIDを返す */
    [[nodiscard]] QString startSession(const QString& gameId, const QString& gameVersion);

    /** @brief 終了コードとOSのクラッシュ判定を分けて観測を終了する */
    void finishSession(const QString& sessionId, int exitCode, bool crashed);

    /** @brief 実行に至らなかった起動失敗を記録する */
    void recordLaunchFailure(const QString& gameId, const QString& gameVersion);

    /** @brief 全実行中セッションの累積時間を保存する */
    void checkpoint();

    /** @brief 全実行中セッションを最後の観測時点で中断する */
    void interruptAll();

    /** @brief 未送信の累積スナップショットを最大100件送信する */
    void uploadPending();

    /** @brief 同意を解除して送信済みの端末別データの削除を要求する */
    void requestRemoteDeletion();

    /** @brief Windowsの休止通知で日別時間の観測境界を保存する */
    bool nativeEventFilter(const QByteArray& eventType, void* message, qintptr* result) override;

  signals:
    /** @brief 同意状態または端末内の統計が変化したことを通知する */
    void statisticsChanged();

    /** @brief 運営へのデータ削除要求の成功または失敗を通知する */
    void remoteDeletionFinished(bool success);

    /** @brief 同意または履歴を保存できず送信を停止したことを通知する */
    void persistenceError(const QString& message);

  private:
    struct State;
    std::unique_ptr<State> state_;
};

} // namespace pandd
