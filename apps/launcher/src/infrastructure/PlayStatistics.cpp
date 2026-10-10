#include "infrastructure/PlayStatistics.h"

#include <QCoreApplication>
#include <QDateTime>
#include <QDir>
#include <QElapsedTimer>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QPointer>
#include <QRandomGenerator>
#include <QSqlDatabase>
#include <QSqlError>
#include <QSqlQuery>
#include <QThread>
#include <QTimeZone>
#include <QTimer>
#include <QUuid>

#include <algorithm>
#include <map>
#include <vector>

#if defined(Q_OS_WIN)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif

namespace pandd {
namespace {

// 統計APIから受け取る応答の最大byte数
constexpr qint64 maximumResponseBytes = 128LL * 1024;

/** @brief UTC日時をAPI契約のRFC 3339文字列に変換する */
QString utcText(const QDateTime& time) { return time.toUTC().toString(Qt::ISODateWithMs); }

/** @brief 端末別データの削除資格に使う256bitの乱数を生成する */
QString newInstallationToken() {
    QByteArray bytes;
    bytes.reserve(32);

    // OS由来の乱数をbyte列へ直接保存
    for (int index = 0; index < 8; ++index) {
        const quint32 random = QRandomGenerator::system()->generate();
        bytes.append(reinterpret_cast<const char*>(&random), sizeof(random));
    }

    return QString::fromLatin1(bytes.toHex());
}

/** @brief Windowsで休止とスリープを除いた単調増加時計を取得する */
qint64 awakeMilliseconds() {
#if defined(Q_OS_WIN)
    ULONGLONG ticks = 0;
    if (QueryUnbiasedInterruptTime(&ticks)) {
        return static_cast<qint64>(ticks / 10000);
    }
#endif

    return -1;
}

/** @brief 累積ミリ秒を日別の整数秒へ分け、合計秒と一致させる */
QJsonArray dailySeconds(const std::map<QString, qint64>& milliseconds) {
    QJsonArray result;
    qint64 accumulated = 0;
    qint64 precedingSeconds = 0;

    // 前日からの端数を繰り越して丸め誤差による合計の不一致を防止
    for (const auto& [date, amount] : milliseconds) {
        accumulated += amount;
        const auto seconds = accumulated / 1000;
        result.append(QJsonObject{{"date", date}, {"durationSeconds", seconds - precedingSeconds}});
        precedingSeconds = seconds;
    }

    return result;
}

/** @brief 観測した実行時間を日本時間の日付境界で分割する */
void addDailyDuration(std::map<QString, qint64>& milliseconds, QDateTime begin, qint64 duration) {
    const QTimeZone japan(9 * 3600);

    // UTC+09の翌日0時までを一つの日付として集計
    while (duration > 0) {
        const auto local = begin.toTimeZone(japan);
        const QDateTime nextDay(local.date().addDays(1), QTime(0, 0), japan);
        const auto amount = std::min(duration, begin.msecsTo(nextDay));
        if (amount <= 0) {
            break;
        }

        milliseconds[local.date().toString(Qt::ISODate)] += amount;
        begin = begin.addMSecs(amount);
        duration -= amount;
    }
}

} // namespace

/** @brief QObjectの所有thread内で使用するDBと観測中セッション */
struct PlayStatisticsService::State {
    /** @brief 一回のゲーム起動に対応する累積観測値 */
    struct ActiveSession {
        QJsonObject payload;
        QElapsedTimer timer;
        qint64 lastAwakeMilliseconds{-1};
        qint64 durationMilliseconds{0};
        QDateTime lastObserved;
        std::map<QString, qint64> dailyMilliseconds;
        bool eligible{false};
    };

    PlayStatisticsService* owner;
    QSqlDatabase database;
    QString connectionName;
    QUrl endpoint;
    QNetworkAccessManager network;
    QPointer<QNetworkReply> reply;
    QTimer checkpoints;
    QTimer uploads;
    std::map<QString, ActiveSession> active;
    QString installationId;
    QString installationToken;
    bool sharing{false};
    bool deleting{false};
    bool storageWritable{false};
    bool persistenceReported{false};
    bool persistedConsent{false};
    int failures{0};

    /** @brief APIとtimerをServiceのthreadに固定して構築する */
    explicit State(PlayStatisticsService* service, QUrl api)
        : owner(service), endpoint(std::move(api)), network(service), checkpoints(service),
          uploads(service) {
        checkpoints.setInterval(30000);
        uploads.setSingleShot(true);
    }

    /** @brief 専用connectionでSQLを実行し、統計の失敗だけをログへ記録する */
    bool execute(const QString& sql) const {
        QSqlQuery query(database);
        if (query.exec(sql)) {
            return true;
        }

        qWarning("Play statistics SQL failed: %s", qPrintable(query.lastError().text()));
        return false;
    }

    /** @brief 指定されたmetadataを読む */
    QString metadata(const QString& key) const {
        if (!database.isOpen()) {
            return {};
        }

        QSqlQuery query(database);
        query.prepare("SELECT value FROM metadata WHERE key = ?");
        query.addBindValue(key);
        return query.exec() && query.next() ? query.value(0).toString() : QString();
    }

    /** @brief 指定されたmetadataを原子的に更新する */
    bool setMetadata(const char* key, const QString& value) const {
        if (!database.isOpen()) {
            return false;
        }

        QSqlQuery query(database);
        query.prepare("INSERT INTO metadata(key,value) VALUES(?,?) "
                      "ON CONFLICT(key) DO UPDATE SET value=excluded.value");
        query.addBindValue(QString::fromLatin1(key));
        query.addBindValue(value);
        return query.exec();
    }

    /** @brief セッションの最新スナップショットだけを保存する */
    bool save(const QJsonObject& payload, bool eligible) {
        if (!database.isOpen() || !storageWritable) {
            return false;
        }

        QSqlQuery query(database);
        query.prepare(
            "INSERT INTO sessions(session_id,game_id,started_at,last_observed_at,"
            "outcome,duration_seconds,revision,payload,eligible,pending) "
            "VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET "
            "last_observed_at=excluded.last_observed_at,outcome=excluded.outcome,"
            "duration_seconds=excluded.duration_seconds,revision=excluded.revision,"
            "payload=excluded.payload,eligible=excluded.eligible,pending=excluded.pending");
        query.addBindValue(payload["sessionId"].toString());
        query.addBindValue(payload["gameId"].toString());
        query.addBindValue(payload["startedAt"].toString());
        query.addBindValue(payload["lastObservedAt"].toString());
        query.addBindValue(payload["outcome"].toString());
        query.addBindValue(payload["durationSeconds"].toInteger());
        query.addBindValue(payload["revision"].toInt());
        query.addBindValue(
            QString::fromUtf8(QJsonDocument(payload).toJson(QJsonDocument::Compact)));
        query.addBindValue(eligible);
        query.addBindValue(eligible && sharing);
        if (query.exec()) {
            return true;
        }

        qWarning("Play statistics session save failed: %s", qPrintable(query.lastError().text()));
        reportPersistenceError();
        return false;
    }

    /** @brief 現在の起動情報からAPI契約のセッションを作成する */
    QJsonObject newPayload(const QString& gameId, const QString& gameVersion) const {
        const auto now = utcText(QDateTime::currentDateTimeUtc());
        return {{"sessionId", QUuid::createUuid().toString(QUuid::WithoutBraces)},
                {"revision", 1},
                {"gameId", gameId},
                {"gameVersion", gameVersion},
                {"launcherVersion", QString(PANDD_LAUNCHER_VERSION)},
                {"environment", QString(PANDD_DISTRIBUTION_ENV)},
                {"startedAt", now},
                {"lastObservedAt", now},
                {"endedAt", QJsonValue::Null},
                {"durationSeconds", 0},
                {"outcome", "running"},
                {"exitCode", QJsonValue::Null},
                {"crashed", QJsonValue::Null},
                {"dailyDurations", QJsonArray()}};
    }

    /** @brief 休止を除いた単調時計の差分を累積し、日付ごとに配分する */
    void observe(ActiveSession& session) const {
        qint64 delta = session.timer.restart();
#if defined(Q_OS_WIN)
        // Windowsの標準単調時計は休止を含むためOSのawake clockを使用
        const qint64 awake = awakeMilliseconds();
        delta = awake >= 0 && session.lastAwakeMilliseconds >= 0
                    ? std::max<qint64>(0, awake - session.lastAwakeMilliseconds)
                    : 0;
        session.lastAwakeMilliseconds = awake;
#endif

        // OS時計が後退してもAPI上の観測日時と累積時間の順序を維持
        const auto now = QDateTime::currentDateTimeUtc();
        const auto minimum = session.lastObserved.addMSecs(delta);
        const auto observed = now > minimum ? now : minimum;
        addDailyDuration(session.dailyMilliseconds, observed.addMSecs(-delta), delta);
        session.durationMilliseconds += delta;
        session.lastObserved = observed;
        session.payload["lastObservedAt"] = utcText(observed);
        session.payload["durationSeconds"] = session.durationMilliseconds / 1000;
        session.payload["dailyDurations"] = dailySeconds(session.dailyMilliseconds);
        session.payload["revision"] = session.payload["revision"].toInt() + 1;
    }

    /** @brief 履歴90日と未送信30日・10000件の保持上限を適用する */
    void prune() {
        if (!database.isOpen() || !storageWritable) {
            return;
        }

        const auto now = QDateTime::currentDateTimeUtc();
        QSqlQuery query(database);
        query.prepare("DELETE FROM sessions WHERE outcome <> 'running' AND last_observed_at < ?");
        query.addBindValue(utcText(now.addDays(-90)));
        if (!query.exec()) {
            reportPersistenceError();
            return;
        }

        query.prepare("UPDATE sessions SET pending=0,eligible=0 WHERE last_observed_at < ?");
        query.addBindValue(utcText(now.addDays(-30)));
        if (!query.exec()) {
            reportPersistenceError();
            return;
        }

        if (!execute("UPDATE sessions SET pending=0,eligible=0 WHERE session_id IN "
                     "(SELECT session_id FROM sessions WHERE pending=1 "
                     "ORDER BY last_observed_at DESC,session_id DESC LIMIT -1 OFFSET 10000)")) {
            reportPersistenceError();
        }
    }

    /** @brief 未完了の保存済みセッションを推測で延長せず中断へ変更する */
    void recoverInterrupted() {
        if (!storageWritable) {
            return;
        }

        QSqlQuery query(database);
        if (!query.exec("SELECT payload,eligible FROM sessions WHERE outcome='running'")) {
            return;
        }

        std::vector<std::pair<QJsonObject, bool>> interrupted;
        while (query.next()) {
            auto payload = QJsonDocument::fromJson(query.value(0).toString().toUtf8()).object();
            payload["outcome"] = "interrupted";
            payload["endedAt"] = payload["lastObservedAt"];
            payload["revision"] = payload["revision"].toInt() + 1;
            interrupted.emplace_back(std::move(payload), query.value(1).toBool());
        }

        // 読み取りqueryを閉じてから同じtableへ更新を反映
        query.finish();
        for (const auto& [payload, eligible] : interrupted) {
            if (!save(payload, eligible)) {
                break;
            }
        }
    }

    /** @brief 再送待ちを維持しながら進行中HTTP要求を解除する */
    void abortRequest() {
        if (!reply) {
            return;
        }

        reply->disconnect(owner);
        reply->abort();
        reply->deleteLater();
        reply.clear();
    }

    /** @brief 保存故障時は今回の送信を停止し、保存できなかったことを一度通知する */
    void reportPersistenceError() {
        storageWritable = false;
        sharing = false;
        uploads.stop();
        if (!deleting) {
            abortRequest();
        }

        for (auto& [id, session] : active) {
            Q_UNUSED(id)
            session.eligible = false;
        }

        if (!persistenceReported) {
            persistenceReported = true;
            const bool consentMayRemain = persistedConsent;
            QTimer::singleShot(0, owner, [service = owner, consentMayRemain] {
                const auto message =
                    consentMayRemain
                        ? QCoreApplication::translate(
                              "PlayStatisticsService",
                              "統計情報を保存できませんでした。この起動中の送信は停止しました。"
                              "設定を保存できないため、再起動後に送信が再開する場合があります。"
                              "保存先の空き容量と書き込み権限を確認してください")
                        : QCoreApplication::translate(
                              "PlayStatisticsService",
                              "統計情報を保存できなかったため、今回の送信を停止しました。"
                              "保存先の空き容量と書き込み権限を確認してください");
                emit service->persistenceError(message);
                emit service->statisticsChanged();
            });
        }
    }

    /** @brief 同意と接続先がある場合だけ送信を予約する */
    void scheduleUpload(int milliseconds = 1000) {
        if (sharing && owner->uploadAvailable() && !deleting && !uploads.isActive()) {
            uploads.start(milliseconds);
        }
    }

    /** @brief ビルド設定のAPI rootに相対endpointを追加する */
    QUrl apiUrl(const QString& route) const {
        QUrl result(endpoint);
        QString path = result.path();
        if (path.endsWith('/')) {
            path.chop(1);
        }

        result.setPath(path + route);
        return result;
    }
};

/** @brief SQLiteの専用connectionと保存・送信timerを初期化する */
PlayStatisticsService::PlayStatisticsService(QString dataDirectory, QUrl endpoint, QObject* parent)
    : QObject(parent), state_(std::make_unique<State>(this, std::move(endpoint))) {
    Q_ASSERT(QThread::currentThread() == thread());
    state_->connectionName =
        "play-statistics-" + QUuid::createUuid().toString(QUuid::WithoutBraces);
    state_->database = QSqlDatabase::addDatabase("QSQLITE", state_->connectionName);
    QDir().mkpath(dataDirectory);
    state_->database.setDatabaseName(QDir(dataDirectory).filePath("play-statistics.sqlite"));
    state_->database.setConnectOptions("QSQLITE_BUSY_TIMEOUT=250");

    // 統計保存先の故障はゲーム起動へ伝播させない
    if (state_->database.open()) {
        const bool initialized =
            state_->execute("PRAGMA journal_mode=WAL") &&
            state_->execute(
                "CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)") &&
            state_->execute(
                "CREATE TABLE IF NOT EXISTS sessions("
                "session_id TEXT PRIMARY KEY,game_id TEXT NOT NULL,started_at TEXT NOT NULL,"
                "last_observed_at TEXT NOT NULL,outcome TEXT NOT NULL,duration_seconds INTEGER NOT "
                "NULL,"
                "revision INTEGER NOT NULL,payload TEXT NOT NULL,eligible INTEGER NOT NULL,"
                "pending INTEGER NOT NULL)") &&
            state_->execute("CREATE INDEX IF NOT EXISTS sessions_game ON sessions(game_id)") &&
            state_->execute("CREATE INDEX IF NOT EXISTS sessions_pending ON "
                            "sessions(pending,last_observed_at)");

        state_->installationId = state_->metadata("installationId");
        state_->installationToken = state_->metadata("installationToken");
        const bool savedConsent = state_->metadata("sharingEnabled") == "true" &&
                                  !state_->installationId.isEmpty() &&
                                  !state_->installationToken.isEmpty();
        state_->persistedConsent = savedConsent;

        // 読み取り専用DBの古い同意だけを根拠に自動送信を再開しない
        state_->storageWritable =
            initialized && state_->database.transaction() &&
            state_->setMetadata("sharingEnabled", savedConsent ? "true" : "false") &&
            state_->database.commit();
        if (!state_->storageWritable) {
            state_->database.rollback();
            state_->reportPersistenceError();
        }

        state_->sharing = state_->storageWritable && savedConsent;
        state_->recoverInterrupted();
        state_->prune();
    } else {
        qWarning("Play statistics database cannot be opened: %s",
                 qPrintable(state_->database.lastError().text()));
        state_->reportPersistenceError();
    }

    // GUIイベントを妨げない周期保存と非同期送信
    connect(&state_->checkpoints, &QTimer::timeout, this, &PlayStatisticsService::checkpoint);
    connect(&state_->uploads, &QTimer::timeout, this, &PlayStatisticsService::uploadPending);
    if (QCoreApplication::instance()) {
        QCoreApplication::instance()->installNativeEventFilter(this);
        connect(QCoreApplication::instance(), &QCoreApplication::aboutToQuit, this,
                &PlayStatisticsService::interruptAll);
    }

    state_->checkpoints.start();
    state_->scheduleUpload();
}

/** @brief 未完了観測を保存し、専用SQL connectionを閉じる */
PlayStatisticsService::~PlayStatisticsService() {
    Q_ASSERT(QThread::currentThread() == thread());
    if (QCoreApplication::instance()) {
        QCoreApplication::instance()->removeNativeEventFilter(this);
    }

    interruptAll();
    state_->abortRequest();
    state_->database.close();
    state_->database = QSqlDatabase();
    QSqlDatabase::removeDatabase(state_->connectionName);
}

/** @brief 保存された送信同意状態を返す */
bool PlayStatisticsService::sharingEnabled() const {
    Q_ASSERT(QThread::currentThread() == thread());
    return state_->sharing;
}

/** @brief HTTPSまたはloopback開発APIが利用可能かを返す */
bool PlayStatisticsService::uploadAvailable() const {
    const auto& endpoint = state_->endpoint;
    const auto host = endpoint.host().toLower();
    const bool loopback = host == "localhost" || host == "127.0.0.1" || host == "::1";
    return state_->database.isOpen() && state_->storageWritable && endpoint.isValid() &&
           !host.isEmpty() && endpoint.userInfo().isEmpty() && !endpoint.hasQuery() &&
           !endpoint.hasFragment() &&
           (endpoint.scheme() == "https" || (endpoint.scheme() == "http" && loopback));
}

/** @brief データ削除のHTTP要求が進行中かを返す */
bool PlayStatisticsService::remoteDeletionInProgress() const {
    Q_ASSERT(QThread::currentThread() == thread());
    return state_->deleting;
}

/** @brief 送信同意を反映し、過去・実行中セッションの後付け送信を防ぐ */
void PlayStatisticsService::setSharingEnabled(bool enabled) {
    Q_ASSERT(QThread::currentThread() == thread());
    if ((enabled == state_->sharing && !state_->persistenceReported) ||
        (enabled && state_->deleting)) {
        return;
    }

    if (enabled) {
        if (!state_->database.isOpen() || !state_->database.transaction()) {
            state_->reportPersistenceError();
            return;
        }

        // 同意後に作成する新規セッションだけに使用する匿名資格を保存
        if (state_->installationId.isEmpty()) {
            state_->installationId = QUuid::createUuid().toString(QUuid::WithoutBraces);
            state_->installationToken = newInstallationToken();
        }

        const bool saved = state_->execute("UPDATE sessions SET pending=0,eligible=0") &&
                           state_->setMetadata("installationId", state_->installationId) &&
                           state_->setMetadata("installationToken", state_->installationToken) &&
                           state_->setMetadata("sharingEnabled", "true");
        if (!saved || !state_->database.commit()) {
            state_->database.rollback();
            state_->reportPersistenceError();
            return;
        }

        state_->sharing = true;
        state_->persistedConsent = true;
        state_->storageWritable = true;
        state_->persistenceReported = false;
        for (auto& [id, session] : state_->active) {
            Q_UNUSED(id)
            session.eligible = false;
        }

        state_->failures = 0;
        state_->scheduleUpload();
    } else {
        // 削除資格を保持して送信を止め、全未送信履歴の送信資格を破棄
        state_->sharing = false;
        state_->uploads.stop();
        state_->abortRequest();
        for (auto& [id, session] : state_->active) {
            Q_UNUSED(id)
            session.eligible = false;
        }

        const bool saved = state_->database.isOpen() && state_->database.transaction() &&
                           state_->setMetadata("sharingEnabled", "false") &&
                           state_->execute("UPDATE sessions SET pending=0,eligible=0") &&
                           state_->database.commit();
        if (!saved) {
            state_->database.rollback();
            state_->reportPersistenceError();
        } else {
            state_->storageWritable = true;
            state_->persistenceReported = false;
            state_->persistedConsent = false;
        }
    }

    emit statisticsChanged();
}

/** @brief 起動成功・実行時間・計測中断・起動失敗を端末内DBから集計する */
PlayStatisticsSummary PlayStatisticsService::localSummary(const QString& gameId) const {
    Q_ASSERT(QThread::currentThread() == thread());
    PlayStatisticsSummary result;
    if (!state_->database.isOpen()) {
        return result;
    }

    QSqlQuery query(state_->database);
    query.prepare("SELECT SUM(outcome <> 'launch_failed'),SUM(duration_seconds),"
                  "SUM(outcome = 'interrupted'),SUM(outcome = 'launch_failed'),"
                  "MAX(CASE WHEN outcome <> 'launch_failed' THEN started_at END) "
                  "FROM sessions WHERE game_id = ? AND started_at >= ?");
    query.addBindValue(gameId);
    query.addBindValue(utcText(QDateTime::currentDateTimeUtc().addDays(-90)));
    if (query.exec() && query.next()) {
        result.launchCount = query.value(0).toLongLong();
        result.totalDurationSeconds = query.value(1).toLongLong();
        result.interruptedCount = query.value(2).toLongLong();
        result.launchFailureCount = query.value(3).toLongLong();
        result.lastPlayedAt = query.value(4).toString();
    }

    return result;
}

/** @brief 端末内履歴と送信待ちを削除して現在の観測を解除する */
void PlayStatisticsService::clearLocalHistory() {
    Q_ASSERT(QThread::currentThread() == thread());
    if (!state_->deleting) {
        state_->abortRequest();
    }
    state_->active.clear();
    if (state_->database.isOpen()) {
        if (!state_->execute("DELETE FROM sessions")) {
            state_->reportPersistenceError();
        } else {
            state_->execute("PRAGMA wal_checkpoint(TRUNCATE)");
        }
    }

    emit statisticsChanged();
}

/** @brief 起動が実際に成功した時点から新しいセッションを観測する */
QString PlayStatisticsService::startSession(const QString& gameId, const QString& gameVersion) {
    Q_ASSERT(QThread::currentThread() == thread());
    State::ActiveSession session;
    session.payload = state_->newPayload(gameId, gameVersion);
    session.lastObserved =
        QDateTime::fromString(session.payload["startedAt"].toString(), Qt::ISODateWithMs);
    session.eligible = state_->sharing;
    session.lastAwakeMilliseconds = awakeMilliseconds();
    session.timer.start();
    const auto id = session.payload["sessionId"].toString();
    if (!state_->save(session.payload, session.eligible)) {
        session.eligible = false;
    }
    state_->active.emplace(id, std::move(session));
    state_->scheduleUpload();
    emit statisticsChanged();
    return id;
}

/** @brief 正常・非0終了・OSクラッシュを区別して最終観測を保存する */
void PlayStatisticsService::finishSession(const QString& sessionId, int exitCode, bool crashed) {
    Q_ASSERT(QThread::currentThread() == thread());
    const auto found = state_->active.find(sessionId);
    if (found == state_->active.end()) {
        return;
    }

    auto& session = found->second;
    state_->observe(session);
    session.payload["endedAt"] = session.payload["lastObservedAt"];
    session.payload["outcome"] = crashed || exitCode != 0 ? "abnormal" : "normal";
    session.payload["exitCode"] = crashed ? QJsonValue(QJsonValue::Null) : QJsonValue(exitCode);
    session.payload["crashed"] = crashed;
    state_->save(session.payload, session.eligible);
    state_->active.erase(found);
    state_->prune();
    state_->scheduleUpload();
    emit statisticsChanged();
}

/** @brief 起動に至らなかった試行を実行時間0秒で保存する */
void PlayStatisticsService::recordLaunchFailure(const QString& gameId, const QString& gameVersion) {
    Q_ASSERT(QThread::currentThread() == thread());
    auto payload = state_->newPayload(gameId, gameVersion);
    payload["outcome"] = "launch_failed";
    payload["endedAt"] = payload["startedAt"];
    state_->save(payload, state_->sharing);
    state_->prune();
    state_->scheduleUpload();
    emit statisticsChanged();
}

/** @brief 30秒ごとの累積時間を保存して容量上限を適用する */
void PlayStatisticsService::checkpoint() {
    Q_ASSERT(QThread::currentThread() == thread());
    for (auto& [id, session] : state_->active) {
        Q_UNUSED(id)
        state_->observe(session);
        state_->save(session.payload, session.eligible);
    }

    state_->prune();
    state_->scheduleUpload();
    emit statisticsChanged();
}

/** @brief 観測できた範囲だけを保存して全セッションを中断する */
void PlayStatisticsService::interruptAll() {
    Q_ASSERT(QThread::currentThread() == thread());
    for (auto& [id, session] : state_->active) {
        Q_UNUSED(id)
        state_->observe(session);
        session.payload["outcome"] = "interrupted";
        session.payload["endedAt"] = session.payload["lastObservedAt"];
        state_->save(session.payload, session.eligible);
    }

    state_->active.clear();
    state_->scheduleUpload();
    emit statisticsChanged();
}

/** @brief 同意後の未送信セッションを送信し、受理されたrevisionだけを確認済みにする */
void PlayStatisticsService::uploadPending() {
    Q_ASSERT(QThread::currentThread() == thread());
    if (!state_->sharing || !uploadAvailable() || state_->reply || state_->deleting) {
        return;
    }

    state_->prune();

    // 保持期間の更新に失敗して送信停止へ移った場合もHTTP要求を作らない
    if (!state_->sharing || !uploadAvailable()) {
        return;
    }

    QSqlQuery query(state_->database);
    if (!query.exec("SELECT payload FROM sessions WHERE pending=1 AND eligible=1 "
                    "ORDER BY last_observed_at,session_id LIMIT 100")) {
        return;
    }

    QJsonArray sessions;
    std::map<QString, int> sentRevisions;
    while (query.next()) {
        const auto session = QJsonDocument::fromJson(query.value(0).toString().toUtf8()).object();
        sessions.append(session);
        sentRevisions.emplace(session["sessionId"].toString(), session["revision"].toInt());
    }

    if (sessions.isEmpty()) {
        return;
    }

    const QJsonObject envelope{{"schemaVersion", 1},
                               {"installationId", state_->installationId},
                               {"installationToken", state_->installationToken},
                               {"sessions", sessions}};
    QNetworkRequest request(state_->apiUrl("/v1/play-sessions"));
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                         QNetworkRequest::ManualRedirectPolicy);
    request.setAttribute(QNetworkRequest::CookieLoadControlAttribute, QNetworkRequest::Manual);
    request.setAttribute(QNetworkRequest::CookieSaveControlAttribute, QNetworkRequest::Manual);
    request.setTransferTimeout(15000);
    auto* reply =
        state_->network.post(request, QJsonDocument(envelope).toJson(QJsonDocument::Compact));
    state_->reply = reply;
    reply->setReadBufferSize(maximumResponseBytes + 1);

    // 不正に大きい応答は読み取りbufferの上限で中止
    connect(reply, &QNetworkReply::readyRead, this, [reply] {
        if (reply->bytesAvailable() > maximumResponseBytes) {
            reply->abort();
        }
    });

    // 再送中に保存された新revisionを古い受理応答で消さない
    connect(reply, &QNetworkReply::finished, this, [this, reply, sentRevisions] {
        state_->reply.clear();
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const auto body = reply->readAll();
        QJsonParseError parse;
        const auto document = QJsonDocument::fromJson(body, &parse);
        const bool successful = reply->error() == QNetworkReply::NoError && status >= 200 &&
                                status < 300 && body.size() <= maximumResponseBytes &&
                                parse.error == QJsonParseError::NoError && document.isObject() &&
                                document.object()["accepted"].isArray();
        bool acknowledged = false;
        if (successful) {
            for (const auto& value : document.object()["accepted"].toArray()) {
                const auto accepted = value.toObject();
                const auto id = accepted["sessionId"].toString();
                const int revision = accepted["revision"].toInt();
                const auto sent = sentRevisions.find(id);
                if (sent == sentRevisions.end() || revision != sent->second) {
                    continue;
                }

                QSqlQuery confirm(state_->database);
                confirm.prepare("UPDATE sessions SET pending=0 WHERE session_id=? AND revision=?");
                confirm.addBindValue(id);
                confirm.addBindValue(revision);
                if (!confirm.exec()) {
                    state_->reportPersistenceError();
                    break;
                }

                acknowledged = true;
            }
        }

        reply->deleteLater();
        if (status == 401 || status == 403) {
            // 無効化された送信資格では新規履歴を送り続けない
            setSharingEnabled(false);
            qWarning("Play statistics sharing disabled after HTTP %d", status);
        } else if (status == 400 || status == 409 || status == 413 || status == 422) {
            // 恒久拒否されたrevisionだけを取り下げて後続セッションを妨げない
            for (const auto& [id, revision] : sentRevisions) {
                QSqlQuery reject(state_->database);
                reject.prepare("UPDATE sessions SET pending=0,eligible=0 "
                               "WHERE session_id=? AND revision=?");
                reject.addBindValue(id);
                reject.addBindValue(revision);
                if (reject.exec() && reject.numRowsAffected() > 0) {
                    const auto active = state_->active.find(id);
                    if (active != state_->active.end() &&
                        active->second.payload["revision"].toInt() == revision) {
                        active->second.eligible = false;
                    }
                }
            }

            qWarning("Play statistics rejected revisions omitted after HTTP %d", status);
            state_->failures = 0;
            state_->scheduleUpload();
        } else if (successful && acknowledged) {
            state_->failures = 0;
            state_->scheduleUpload();
        } else {
            state_->failures = std::min(state_->failures + 1, 9);
            state_->scheduleUpload(std::min(300000, 1000 * (1 << state_->failures)));
        }
    });
}

/** @brief 運営への送信を停止して匿名資格に対応する保存済みデータを削除する */
void PlayStatisticsService::requestRemoteDeletion() {
    Q_ASSERT(QThread::currentThread() == thread());
    if (state_->deleting) {
        return;
    }

    setSharingEnabled(false);
    state_->uploads.stop();
    state_->abortRequest();
    if (state_->installationId.isEmpty()) {
        emit remoteDeletionFinished(true);
        return;
    }

    if (!uploadAvailable()) {
        emit remoteDeletionFinished(false);
        return;
    }

    QNetworkRequest request(state_->apiUrl("/v1/installations/" + state_->installationId));
    request.setRawHeader("Authorization", "Bearer " + state_->installationToken.toLatin1());
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                         QNetworkRequest::ManualRedirectPolicy);
    request.setAttribute(QNetworkRequest::CookieLoadControlAttribute, QNetworkRequest::Manual);
    request.setAttribute(QNetworkRequest::CookieSaveControlAttribute, QNetworkRequest::Manual);
    request.setTransferTimeout(15000);
    auto* reply = state_->network.deleteResource(request);
    state_->reply = reply;
    state_->deleting = true;
    reply->setReadBufferSize(maximumResponseBytes + 1);
    connect(reply, &QNetworkReply::readyRead, this, [reply] {
        if (reply->bytesAvailable() > maximumResponseBytes) {
            reply->abort();
        }
    });

    // 削除失敗時は資格を残し、利用者が再試行できる状態を維持
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        state_->reply.clear();
        state_->deleting = false;
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const bool success =
            reply->error() == QNetworkReply::NoError && status >= 200 && status < 300;
        if (success) {
            state_->installationId.clear();
            state_->installationToken.clear();
            const bool saved =
                state_->database.transaction() && state_->setMetadata("installationId", "") &&
                state_->setMetadata("installationToken", "") && state_->database.commit();
            if (!saved) {
                state_->database.rollback();
                state_->reportPersistenceError();
            }
        }

        reply->deleteLater();
        emit remoteDeletionFinished(success);
        emit statisticsChanged();
    });
}

/** @brief Windowsの休止・復帰時に実行時間の日付境界を記録する */
bool PlayStatisticsService::nativeEventFilter(const QByteArray& eventType, void* message,
                                              qintptr* result) {
    Q_UNUSED(eventType)
    Q_UNUSED(result)
#if defined(Q_OS_WIN)
    const auto* nativeMessage = static_cast<MSG*>(message);
    if (nativeMessage->message == WM_POWERBROADCAST &&
        (nativeMessage->wParam == PBT_APMSUSPEND ||
         nativeMessage->wParam == PBT_APMRESUMEAUTOMATIC)) {
        checkpoint();
    }
#else
    Q_UNUSED(message)
#endif

    return false;
}

} // namespace pandd
