#include "infrastructure/PlatformServices.h"
#include "infrastructure/PlayStatistics.h"

#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QPointer>
#include <QSignalSpy>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTemporaryDir>
#include <QTest>
#include <QUuid>

#include <functional>
#include <vector>

using namespace pandd;

/** @brief 必要な場合だけ実clientの契約payloadをcross-language検証用に保存する */
bool captureContractEnvelope(const QJsonObject& envelope) {
    const auto path = qEnvironmentVariable("PANDD_STATISTICS_CONTRACT_CAPTURE");
    if (path.isEmpty()) {
        return true;
    }

    QFile file(path);
    return file.open(QIODevice::WriteOnly | QIODevice::Truncate) &&
           file.write(QJsonDocument(envelope).toJson()) > 0;
}

/** @brief テスト専用connectionで保存済み統計を読み書きする */
void withStatisticsDatabase(const QString& directory,
                            const std::function<void(QSqlDatabase&)>& action) {
    const auto name = QUuid::createUuid().toString(QUuid::WithoutBraces);
    {
        auto database = QSqlDatabase::addDatabase("QSQLITE", name);
        database.setDatabaseName(QDir(directory).filePath("play-statistics.sqlite"));
        if (database.open()) {
            action(database);
        }

        database.close();
    }

    QSqlDatabase::removeDatabase(name);
}

/** @brief 保存済みセッションの契約payloadを取得する */
QJsonObject storedSession(const QString& directory, const QString& id) {
    QJsonObject result;
    withStatisticsDatabase(directory, [&](QSqlDatabase& database) {
        QSqlQuery query(database);
        query.prepare("SELECT payload FROM sessions WHERE session_id=?");
        query.addBindValue(id);
        if (query.exec() && query.next()) {
            result = QJsonDocument::fromJson(query.value(0).toString().toUtf8()).object();
        }
    });

    return result;
}

/** @brief 保存済みセッションの未送信フラグを取得する */
int pendingSession(const QString& directory, const QString& id) {
    int result = -1;
    withStatisticsDatabase(directory, [&](QSqlDatabase& database) {
        QSqlQuery query(database);
        query.prepare("SELECT pending FROM sessions WHERE session_id=?");
        query.addBindValue(id);
        if (query.exec() && query.next()) {
            result = query.value(0).toInt();
        }
    });

    return result;
}

/** @brief HTTP応答を保留して再送とrevision競合を再現するfixture */
class StatisticsHttpServer final : public QTcpServer {
    Q_OBJECT

  public:
    /** @brief 捕捉した一つのHTTP要求 */
    struct Request {
        QByteArray headers;
        QJsonObject document;
        QPointer<QTcpSocket> socket;
    };

    std::vector<Request> requests;

    /** @brief loopbackの空きportで待ち受ける */
    bool start() { return listen(QHostAddress::LocalHost, 0); }

    /** @brief fixtureのAPI rootを返す */
    QUrl endpoint() const { return QUrl("http://127.0.0.1:" + QString::number(serverPort())); }

    /** @brief 捕捉した要求へ指定statusとJSONを応答する */
    void respond(int index, int status, const QJsonObject& document = {}) {
        auto socket = requests.at(static_cast<std::size_t>(index)).socket;
        if (!socket) {
            return;
        }

        const auto body = status == 204 ? QByteArray() : QJsonDocument(document).toJson();
        socket->write("HTTP/1.1 " + QByteArray::number(status) +
                      " Fixture\r\nContent-Type: "
                      "application/json\r\nConnection: close\r\nContent-Length: " +
                      QByteArray::number(body.size()) + "\r\n\r\n" + body);
        socket->disconnectFromHost();
    }

    /** @brief 要求内の全セッションのrevisionを受理する */
    void acknowledge(int index) {
        QJsonArray accepted;
        for (const auto& value :
             requests.at(static_cast<std::size_t>(index)).document["sessions"].toArray()) {
            const auto session = value.toObject();
            accepted.append(QJsonObject{{"sessionId", session["sessionId"]},
                                        {"revision", session["revision"]}});
        }

        respond(index, 200, {{"accepted", accepted}});
    }

  protected:
    /** @brief request全体が到着するまでbufferを維持する */
    void incomingConnection(qintptr descriptor) override {
        auto* socket = new QTcpSocket(this);
        socket->setSocketDescriptor(descriptor);
        connect(socket, &QTcpSocket::disconnected, socket, &QObject::deleteLater);
        connect(socket, &QTcpSocket::readyRead, this, [this, socket] {
            if (socket->property("captured").toBool()) {
                return;
            }

            auto bytes = socket->property("request").toByteArray() + socket->readAll();
            socket->setProperty("request", bytes);
            const auto separator = bytes.indexOf("\r\n\r\n");
            if (separator < 0) {
                return;
            }

            const auto headers = bytes.left(separator);
            qint64 length = 0;
            for (const auto& line : headers.split('\n')) {
                if (line.toLower().startsWith("content-length:")) {
                    length = line.mid(sizeof("content-length:") - 1).trimmed().toLongLong();
                }
            }

            if (bytes.size() - separator - 4 < length) {
                return;
            }

            socket->setProperty("captured", true);
            requests.push_back({headers,
                                QJsonDocument::fromJson(bytes.mid(separator + 4, length)).object(),
                                socket});
        });
    }
};

/** @brief 同意・永続化・計測中断・HTTP再送・実process監視を検証する */
class PlayStatisticsTests final : public QObject {
    Q_OBJECT

  private slots:
    /** @brief 初期状態は端末内だけに保存し、日別秒数と合計を一致させる */
    void localHistoryAndDuration() {
        QTemporaryDir directory;
        QVERIFY(directory.isValid());
        PlayStatisticsService statistics(directory.path(), {});
        QVERIFY(!statistics.sharingEnabled());
        QVERIFY(!statistics.uploadAvailable());
        const auto id = statistics.startSession("sample-game", "1.0.0");
        QTest::qWait(1100);
        statistics.checkpoint();
        statistics.finishSession(id, 0, false);
        statistics.recordLaunchFailure("sample-game", "1.0.0");

        const auto summary = statistics.localSummary("sample-game");
        QCOMPARE(summary.launchCount, 1);
        QVERIFY(summary.totalDurationSeconds >= 1);
        QCOMPARE(summary.launchFailureCount, 1);
        QCOMPARE(summary.interruptedCount, 0);
        QVERIFY(!summary.lastPlayedAt.isEmpty());
        const auto payload = storedSession(directory.path(), id);
        QCOMPARE(payload["outcome"].toString(), "normal");
        QCOMPARE(payload["exitCode"].toInt(), 0);
        QCOMPARE(payload["crashed"].toBool(), false);
        qint64 dailyTotal = 0;
        for (const auto& day : payload["dailyDurations"].toArray()) {
            dailyTotal += day.toObject()["durationSeconds"].toInteger();
        }

        QCOMPARE(dailyTotal, payload["durationSeconds"].toInteger());
        QCOMPARE(pendingSession(directory.path(), id), 0);
        statistics.clearLocalHistory();
        QCOMPARE(statistics.localSummary("sample-game").launchCount, 0);
        QCOMPARE(statistics.localSummary("sample-game").launchFailureCount, 0);
    }

    /** @brief 同意前の履歴と既に実行中のゲームを後から送信しない */
    void consentDoesNotBackfillAndPersists() {
        QTemporaryDir directory;
        StatisticsHttpServer server;
        QVERIFY(server.start());
        QString installationId;
        QString token;
        {
            PlayStatisticsService statistics(directory.path(), server.endpoint());
            const auto historical = statistics.startSession("sample-game", "1.0.0");
            statistics.finishSession(historical, 0, false);
            const auto beforeConsent = statistics.startSession("sample-game", "1.0.0");
            statistics.setSharingEnabled(true);
            QVERIFY(statistics.sharingEnabled());
            statistics.finishSession(beforeConsent, 0, false);
            const auto afterConsent = statistics.startSession("sample-game", "1.0.0");
            if (qEnvironmentVariableIsSet("PANDD_STATISTICS_CONTRACT_CAPTURE")) {
                QTest::qSleep(1100);
            }

            statistics.finishSession(afterConsent, 0, false);
            statistics.uploadPending();
            QTRY_COMPARE(server.requests.size(), 1U);
            const auto envelope = server.requests.front().document;
            QVERIFY(captureContractEnvelope(envelope));
            QCOMPARE(envelope["sessions"].toArray().size(), 1);
            QCOMPARE(envelope["sessions"].toArray().first().toObject()["sessionId"].toString(),
                     afterConsent);
            installationId = envelope["installationId"].toString();
            token = envelope["installationToken"].toString();
            QCOMPARE(token.size(), 64);
            QVERIFY(!QUuid(installationId).isNull());
            server.acknowledge(0);
            QTRY_COMPARE(pendingSession(directory.path(), afterConsent), 0);
        }

        {
            PlayStatisticsService statistics(directory.path(), server.endpoint());
            QVERIFY(statistics.sharingEnabled());
            statistics.setSharingEnabled(false);
            const auto disabled = statistics.startSession("sample-game", "1.0.0");
            statistics.finishSession(disabled, 0, false);
            statistics.setSharingEnabled(true);
            const auto enabled = statistics.startSession("sample-game", "1.0.0");
            statistics.finishSession(enabled, 0, false);
            statistics.uploadPending();
            QTRY_COMPARE(server.requests.size(), 2U);
            const auto envelope = server.requests.back().document;
            QCOMPARE(envelope["installationId"].toString(), installationId);
            QCOMPARE(envelope["installationToken"].toString(), token);
            QCOMPARE(envelope["sessions"].toArray().size(), 1);
            QCOMPARE(envelope["sessions"].toArray().first().toObject()["sessionId"].toString(),
                     enabled);
            statistics.setSharingEnabled(false);
            QCOMPARE(pendingSession(directory.path(), enabled), 0);
        }

        PlayStatisticsService statistics(directory.path(), server.endpoint());
        QVERIFY(!statistics.sharingEnabled());
        QCOMPARE(statistics.localSummary("sample-game").launchCount, 5);
    }

    /** @brief 古い受理応答が並行して保存された新revisionを消さない */
    void preservesNewRevisionDuringAcknowledgment() {
        QTemporaryDir directory;
        StatisticsHttpServer server;
        QVERIFY(server.start());
        PlayStatisticsService statistics(directory.path(), server.endpoint());
        statistics.setSharingEnabled(true);
        const auto id = statistics.startSession("sample-game", "1.0.0");
        statistics.uploadPending();
        QTRY_COMPARE(server.requests.size(), 1U);
        QCOMPARE(server.requests.front()
                     .document["sessions"]
                     .toArray()
                     .first()
                     .toObject()["revision"]
                     .toInt(),
                 1);
        statistics.checkpoint();
        QCOMPARE(storedSession(directory.path(), id)["revision"].toInt(), 2);
        server.acknowledge(0);

        QTRY_COMPARE_WITH_TIMEOUT(server.requests.size(), 2U, 4000);
        const auto second =
            server.requests.back().document["sessions"].toArray().first().toObject();
        QCOMPARE(second["sessionId"].toString(), id);
        QCOMPARE(second["revision"].toInt(), 2);
        QCOMPARE(pendingSession(directory.path(), id), 1);
        server.acknowledge(1);
        QTRY_COMPARE(pendingSession(directory.path(), id), 0);
        statistics.finishSession(id, 0, false);
        QCOMPARE(pendingSession(directory.path(), id), 1);
        statistics.uploadPending();
        QTRY_COMPARE(server.requests.size(), 3U);
        const auto third = server.requests.back().document["sessions"].toArray().first().toObject();
        QCOMPARE(third["revision"].toInt(), 3);
        QCOMPARE(third["outcome"].toString(), "normal");
        server.acknowledge(2);
        QTRY_COMPARE(pendingSession(directory.path(), id), 0);
    }

    /** @brief 起動時の回復は最後に保存された時間を推測で増やさない */
    void recoversUnfinishedSessionWithoutAddingTime() {
        QTemporaryDir directory;
        QString id;
        {
            PlayStatisticsService statistics(directory.path(), {});
            id = statistics.startSession("sample-game", "1.0.0");
            statistics.interruptAll();
        }

        auto payload = storedSession(directory.path(), id);
        payload["outcome"] = "running";
        payload["endedAt"] = QJsonValue::Null;
        payload["durationSeconds"] = 123;
        const int revision = payload["revision"].toInt();
        withStatisticsDatabase(directory.path(), [&](QSqlDatabase& database) {
            QSqlQuery query(database);
            query.prepare("UPDATE sessions SET outcome='running',duration_seconds=123,payload=? "
                          "WHERE session_id=?");
            query.addBindValue(QString::fromUtf8(QJsonDocument(payload).toJson()));
            query.addBindValue(id);
            QVERIFY(query.exec());
        });

        QTest::qWait(100);
        PlayStatisticsService statistics(directory.path(), {});
        const auto recovered = storedSession(directory.path(), id);
        QCOMPARE(recovered["outcome"].toString(), "interrupted");
        QCOMPARE(recovered["durationSeconds"].toInt(), 123);
        QCOMPARE(recovered["revision"].toInt(), revision + 1);
        QCOMPARE(recovered["endedAt"].toString(), payload["lastObservedAt"].toString());
        QCOMPARE(statistics.localSummary("sample-game").interruptedCount, 1);
        QCOMPARE(statistics.localSummary("sample-game").totalDurationSeconds, 123);
    }

    /** @brief 非0終了とOSクラッシュを別の値として記録する */
    void distinguishesExitCodeFromCrash() {
        QTemporaryDir directory;
        PlayStatisticsService statistics(directory.path(), {});
        const auto nonzero = statistics.startSession("sample-game", "1.0.0");
        statistics.finishSession(nonzero, 42, false);
        const auto crash = statistics.startSession("sample-game", "1.0.0");
        statistics.finishSession(crash, 9, true);
        const auto cleanAbnormal = storedSession(directory.path(), nonzero);
        const auto crashed = storedSession(directory.path(), crash);
        QCOMPARE(cleanAbnormal["outcome"].toString(), "abnormal");
        QCOMPARE(cleanAbnormal["exitCode"].toInt(), 42);
        QCOMPARE(cleanAbnormal["crashed"].toBool(), false);
        QCOMPARE(crashed["outcome"].toString(), "abnormal");
        QCOMPARE(crashed["crashed"].toBool(), true);
        QVERIFY(crashed["exitCode"].isNull());
    }

    /** @brief 削除失敗では資格を保持し、再試行成功後は新しい匿名資格を発行する */
    void retriesRemoteDeletionAndRotatesCredentials() {
        QTemporaryDir directory;
        StatisticsHttpServer server;
        QVERIFY(server.start());
        PlayStatisticsService statistics(directory.path(), server.endpoint());
        statistics.setSharingEnabled(true);
        const auto id = statistics.startSession("sample-game", "1.0.0");
        statistics.finishSession(id, 0, false);
        statistics.uploadPending();
        QTRY_COMPARE(server.requests.size(), 1U);
        const auto installation = server.requests.front().document["installationId"].toString();
        const auto token = server.requests.front().document["installationToken"].toString();
        server.acknowledge(0);
        QTRY_COMPARE(pendingSession(directory.path(), id), 0);
        QSignalSpy deleted(&statistics, &PlayStatisticsService::remoteDeletionFinished);
        statistics.requestRemoteDeletion();
        QVERIFY(!statistics.sharingEnabled());
        QTRY_COMPARE(server.requests.size(), 2U);
        QVERIFY(server.requests.back().headers.startsWith("DELETE /v1/installations/" +
                                                          installation.toLatin1() + " HTTP/1.1"));
        QVERIFY(server.requests.back().headers.contains("Bearer " + token.toLatin1()));
        server.respond(1, 503);
        QTRY_COMPARE(deleted.count(), 1);
        QCOMPARE(deleted.first().first().toBool(), false);
        statistics.requestRemoteDeletion();
        QTRY_COMPARE(server.requests.size(), 3U);
        QVERIFY(server.requests.back().headers.contains("Bearer " + token.toLatin1()));
        server.respond(2, 204);
        QTRY_COMPARE(deleted.count(), 2);
        QCOMPARE(deleted.last().first().toBool(), true);
        statistics.setSharingEnabled(true);
        const auto next = statistics.startSession("sample-game", "1.0.0");
        statistics.finishSession(next, 0, false);
        statistics.uploadPending();
        QTRY_COMPARE(server.requests.size(), 4U);
        QVERIFY(server.requests.back().document["installationId"].toString() != installation);
        QVERIFY(server.requests.back().document["installationToken"].toString() != token);
        statistics.setSharingEnabled(false);
    }

    /** @brief 一時障害では再送し、恒久拒否は次のセッションを妨げない */
    void retriesTransientErrorsAndSkipsRejectedRevisions() {
        QTemporaryDir directory;
        StatisticsHttpServer server;
        QVERIFY(server.start());
        PlayStatisticsService statistics(directory.path(), server.endpoint());
        statistics.setSharingEnabled(true);
        const auto first = statistics.startSession("sample-game", "1.0.0");
        statistics.finishSession(first, 0, false);
        statistics.uploadPending();
        QTRY_COMPARE(server.requests.size(), 1U);
        server.respond(0, 503);
        QTRY_COMPARE_WITH_TIMEOUT(server.requests.size(), 2U, 5000);
        QCOMPARE(server.requests.front().document["sessions"],
                 server.requests.back().document["sessions"]);
        QCOMPARE(pendingSession(directory.path(), first), 1);
        server.respond(1, 400);
        QTRY_COMPARE(pendingSession(directory.path(), first), 0);
        QCOMPARE(statistics.localSummary("sample-game").launchCount, 1);

        const auto next = statistics.startSession("sample-game", "1.0.0");
        statistics.finishSession(next, 0, false);
        statistics.uploadPending();
        QTRY_COMPARE(server.requests.size(), 3U);
        QCOMPARE(server.requests.back().document["sessions"].toArray().size(), 1);
        QCOMPARE(server.requests.back()
                     .document["sessions"]
                     .toArray()
                     .first()
                     .toObject()["sessionId"]
                     .toString(),
                 next);
        server.respond(2, 401);
        QTRY_VERIFY(!statistics.sharingEnabled());
        QCOMPARE(pendingSession(directory.path(), next), 0);
    }

    /** @brief ローカル履歴の消去が送信済みデータの削除要求を中断しない */
    void localHistoryClearDoesNotCancelRemoteDeletion() {
        QTemporaryDir directory;
        StatisticsHttpServer server;
        QVERIFY(server.start());
        PlayStatisticsService statistics(directory.path(), server.endpoint());
        statistics.setSharingEnabled(true);
        const auto id = statistics.startSession("sample-game", "1.0.0");
        statistics.finishSession(id, 0, false);
        QSignalSpy deleted(&statistics, &PlayStatisticsService::remoteDeletionFinished);
        statistics.requestRemoteDeletion();
        QTRY_COMPARE(server.requests.size(), 1U);
        statistics.clearLocalHistory();
        QCOMPARE(statistics.localSummary("sample-game").launchCount, 0);
        server.respond(0, 204);
        QTRY_COMPARE(deleted.count(), 1);
        QVERIFY(deleted.first().first().toBool());
        statistics.setSharingEnabled(true);
        QVERIFY(statistics.sharingEnabled());
    }

    /** @brief 保存上限と90日集計を適用して古い送信待ちを破棄する */
    void boundsHistoryAndPendingSessions() {
        QTemporaryDir directory;
        PlayStatisticsService statistics(directory.path(), {});
        statistics.setSharingEnabled(true);
        const auto id = statistics.startSession("sample-game", "1.0.0");
        statistics.finishSession(id, 0, false);
        const auto templatePayload = storedSession(directory.path(), id);
        const auto stale = statistics.startSession("sample-game", "1.0.0");
        statistics.finishSession(stale, 0, false);
        withStatisticsDatabase(directory.path(), [&](QSqlDatabase& database) {
            QVERIFY(database.transaction());
            QSqlQuery insert(database);
            insert.prepare("INSERT INTO sessions(session_id,game_id,started_at,last_observed_at,"
                           "outcome,duration_seconds,revision,payload,eligible,pending) "
                           "VALUES(?,?,?,?, 'normal',0,2,?,1,1)");
            for (int index = 0; index < 10003; ++index) {
                auto payload = templatePayload;
                const auto key = QUuid::createUuid().toString(QUuid::WithoutBraces);
                const auto now = QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);
                payload["sessionId"] = key;
                insert.bindValue(0, key);
                insert.bindValue(1, "sample-game");
                insert.bindValue(2, now);
                insert.bindValue(3, now);
                insert.bindValue(4, QString::fromUtf8(QJsonDocument(payload).toJson()));
                QVERIFY(insert.exec());
            }

            QVERIFY(database.commit());
            QSqlQuery old(database);
            old.prepare("UPDATE sessions SET started_at=?,last_observed_at=? WHERE session_id=?");
            const auto timestamp =
                QDateTime::currentDateTimeUtc().addDays(-91).toString(Qt::ISODateWithMs);
            old.addBindValue(timestamp);
            old.addBindValue(timestamp);
            old.addBindValue(id);
            QVERIFY(old.exec());

            old.prepare("UPDATE sessions SET started_at=?,last_observed_at=? WHERE session_id=?");
            const auto staleTimestamp =
                QDateTime::currentDateTimeUtc().addDays(-31).toString(Qt::ISODateWithMs);
            old.addBindValue(staleTimestamp);
            old.addBindValue(staleTimestamp);
            old.addBindValue(stale);
            QVERIFY(old.exec());
        });

        statistics.checkpoint();
        QCOMPARE(pendingSession(directory.path(), id), -1);
        QCOMPARE(pendingSession(directory.path(), stale), 0);
        QCOMPARE(statistics.localSummary("sample-game").launchCount, 10004);
        int pending = -1;
        withStatisticsDatabase(directory.path(), [&](QSqlDatabase& database) {
            QSqlQuery query(database);
            QVERIFY(query.exec("SELECT COUNT(*) FROM sessions WHERE pending=1"));
            QVERIFY(query.next());
            pending = query.value(0).toInt();
        });

        QCOMPARE(pending, 10000);
        statistics.setSharingEnabled(false);
    }

    /** @brief 同意の保存に失敗したときは送信を停止し、回復後の再試行を保存する */
    void stopsSharingAndReportsFailedConsentPersistence() {
        QTemporaryDir directory;
        StatisticsHttpServer server;
        QVERIFY(server.start());
        {
            PlayStatisticsService statistics(directory.path(), server.endpoint());
            statistics.setSharingEnabled(true);
            const auto id = statistics.startSession("sample-game", "1.0.0");
            statistics.finishSession(id, 0, false);
            QSignalSpy errors(&statistics, &PlayStatisticsService::persistenceError);

            // Serviceの実connectionを読み取り専用にして保存障害を再現
            QString connection;
            for (const auto& name : QSqlDatabase::connectionNames()) {
                auto database = QSqlDatabase::database(name);
                if (database.databaseName() ==
                    QDir(directory.path()).filePath("play-statistics.sqlite")) {
                    connection = name;
                    QSqlQuery readOnly(database);
                    QVERIFY(readOnly.exec("PRAGMA query_only=ON"));
                    break;
                }
            }

            QVERIFY(!connection.isEmpty());

            // 送信直前のpruneが失敗しても停止後にHTTP要求を作らない
            statistics.uploadPending();
            QTRY_COMPARE(errors.count(), 1);
            QVERIFY(!statistics.sharingEnabled());
            QVERIFY(!statistics.uploadAvailable());
            statistics.setSharingEnabled(false);
            statistics.uploadPending();
            QCOMPARE(server.requests.size(), 0U);

            // 保存先が回復すれば同じOFF指定でも永続化を再試行
            {
                QSqlQuery writable(QSqlDatabase::database(connection));
                QVERIFY(writable.exec("PRAGMA query_only=OFF"));
            }

            statistics.setSharingEnabled(false);
            QCOMPARE(pendingSession(directory.path(), id), 0);
            QVERIFY(statistics.uploadAvailable());
        }

        PlayStatisticsService restored(directory.path(), server.endpoint());
        QVERIFY(!restored.sharingEnabled());
    }

    /** @brief 実QProcessで瞬時終了・非0終了・実行file欠落を記録する */
    void observesActualProcessLifecycle() {
        QTemporaryDir directory;
        PlayStatisticsService statistics(QDir(directory.path()).filePath("statistics"), {});
        QtGameProcessService processes;
        processes.setPlayStatisticsService(&statistics);

        // 同じfixtureを通常起動と非0終了用の名前で配置
        const auto root = QDir(directory.path()).filePath("game/releases/1.0.0");
        QVERIFY(QDir().mkpath(root));
#if defined(Q_OS_WIN)
        const QString normalFile("normal.exe");
        const QString nonzeroFile("crash.exe");
        const QString abortedFile("abort.exe");
#else
        const QString normalFile("normal");
        const QString nonzeroFile("crash");
        const QString abortedFile("abort");
#endif

        QVERIFY(QFile::copy(PANDD_PROCESS_FIXTURE_PATH, QDir(root).filePath(normalFile)));
        QVERIFY(QFile::copy(PANDD_PROCESS_FIXTURE_PATH, QDir(root).filePath(nonzeroFile)));
        QVERIFY(QFile::copy(PANDD_PROCESS_FIXTURE_PATH, QDir(root).filePath(abortedFile)));
        InstalledGame installed;
        installed.gameId = GameId("sample-game");
        installed.version = SemanticVersion("1.0.0");
        installed.gameRoot = QDir(directory.path()).filePath("game").toStdString();
        installed.entrypoint = normalFile.toStdString();
        installed.workingDirectory = ".";
        int exits = 0;
        QVERIFY(processes
                    .launch(installed, QDir(directory.path()).filePath("save").toStdString(),
                            [&](int exitCode, bool abnormal) {
                                QCOMPARE(exitCode, 0);
                                QCOMPARE(abnormal, false);
                                ++exits;
                            })
                    .ok);
        QTRY_COMPARE(exits, 1);
        QTRY_VERIFY(!processes.isRunning(installed.gameId));
        QCOMPARE(statistics.localSummary("sample-game").launchCount, 1);

        installed.entrypoint = nonzeroFile.toStdString();
        QVERIFY(processes
                    .launch(installed, QDir(directory.path()).filePath("save").toStdString(),
                            [&](int exitCode, bool abnormal) {
                                QCOMPARE(exitCode, 42);
                                QCOMPARE(abnormal, true);
                                ++exits;
                            })
                    .ok);
        QTRY_COMPARE(exits, 2);
        QTRY_VERIFY(!processes.isRunning(installed.gameId));
        QCOMPARE(statistics.localSummary("sample-game").launchCount, 2);
        int nonzeroNormalExit = 0;
        withStatisticsDatabase(
            QDir(directory.path()).filePath("statistics"), [&](QSqlDatabase& database) {
                QSqlQuery query(database);
                QVERIFY(query.exec("SELECT payload FROM sessions"));
                while (query.next()) {
                    const auto payload =
                        QJsonDocument::fromJson(query.value(0).toString().toUtf8()).object();
                    if (payload["exitCode"].toInt() == 42 && !payload["crashed"].toBool()) {
                        ++nonzeroNormalExit;
                    }
                }
            });

        QCOMPARE(nonzeroNormalExit, 1);

        // OS強制終了ではQtのundefined exit codeを統計へ保存しない
        installed.entrypoint = abortedFile.toStdString();
        QVERIFY(processes
                    .launch(installed, QDir(directory.path()).filePath("save").toStdString(),
                            [&](int exitCode, bool abnormal) {
                                Q_UNUSED(exitCode)
                                QCOMPARE(abnormal, true);
                                ++exits;
                            })
                    .ok);
        QTRY_COMPARE(exits, 3);
        QTRY_VERIFY(!processes.isRunning(installed.gameId));
        QCOMPARE(statistics.localSummary("sample-game").launchCount, 3);
        int actualCrashes = 0;
        withStatisticsDatabase(
            QDir(directory.path()).filePath("statistics"), [&](QSqlDatabase& database) {
                QSqlQuery query(database);
                QVERIFY(query.exec("SELECT payload FROM sessions"));
                while (query.next()) {
                    const auto payload =
                        QJsonDocument::fromJson(query.value(0).toString().toUtf8()).object();
                    if (payload["crashed"].toBool()) {
                        ++actualCrashes;
                        QVERIFY(payload["exitCode"].isNull());
                    }
                }
            });

        QCOMPARE(actualCrashes, 1);
        installed.entrypoint = "missing-game.exe";
        QVERIFY(!processes.launch(installed, "", {}).ok);
        QCOMPARE(statistics.localSummary("sample-game").launchFailureCount, 1);

        // 存在しても実行できないfileは起動失敗として計上
        QFile invalid(QDir(root).filePath("invalid.exe"));
        QVERIFY(invalid.open(QIODevice::WriteOnly));
        invalid.write("not an executable");
        invalid.close();
        installed.entrypoint = "invalid.exe";
        QVERIFY(
            !processes.launch(installed, QDir(directory.path()).filePath("save").toStdString(), {})
                 .ok);
        QCOMPARE(statistics.localSummary("sample-game").launchFailureCount, 2);
    }
};

QTEST_GUILESS_MAIN(PlayStatisticsTests)
#include "PlayStatisticsTests.moc"
