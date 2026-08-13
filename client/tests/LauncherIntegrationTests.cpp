#include "application/LauncherService.h"
#include "infrastructure/GameInstallationService.h"
#include "infrastructure/JsonCodec.h"
#include "infrastructure/PlatformServices.h"
#include "infrastructure/QtRepositories.h"

#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTemporaryDir>
#include <QTest>
#include <QtConcurrentRun>

#include <filesystem>
#include <limits>

using namespace pandd;

/** @brief Range対応の再現可能なローカルfixture server */
class FixtureHttpServer final : public QTcpServer {
    Q_OBJECT

  public:
    /** @brief 配信内容を保持してserverを構築する */
    // Failure count and HTTP status are separate fixture controls despite sharing int.
    // NOLINTNEXTLINE(bugprone-easily-swappable-parameters)
    explicit FixtureHttpServer(QByteArray content, int transientFailures = 0,
                               int permanentStatus = 0, bool ignoreRange = false,
                               int firstDisconnectBytes = 0)
        : content_(std::move(content)), transientFailures_(transientFailures),
          permanentStatus_(permanentStatus), ignoreRange_(ignoreRange),
          firstDisconnectBytes_(firstDisconnectBytes) {}

    /** @brief localhostの空きportで待ち受ける */
    bool start() { return listen(QHostAddress::LocalHost, 0); }

    /** @brief Range requestを受信したかを返す */
    [[nodiscard]] bool rangeRequested() const { return rangeRequested_; }

    /** @brief 受信したrequest数を返す */
    [[nodiscard]] int requestCount() const { return requestCount_; }

  protected:
    /** @brief 接続ごとに最小HTTP応答を処理する */
    void incomingConnection(qintptr socketDescriptor) override {
        auto* socket = new QTcpSocket(this);
        socket->setSocketDescriptor(socketDescriptor);
        connect(socket, &QTcpSocket::readyRead, this, [this, socket] {
            const auto request = socket->readAll();
            ++requestCount_;
            if (permanentStatus_ != 0 || transientFailures_ > 0) {
                const auto status = permanentStatus_ != 0 ? permanentStatus_ : 503;
                if (transientFailures_ > 0) {
                    --transientFailures_;
                }
                const QByteArray body("fixture error");
                QByteArray response =
                    "HTTP/1.1 " + QByteArray::number(status) +
                    " Error\r\nContent-Length: " + QByteArray::number(body.size()) +
                    "\r\nConnection: close\r\n\r\n" + body;
                socket->write(response);
                socket->disconnectFromHost();
                return;
            }
            qint64 offset = 0;
            const auto marker = request.indexOf("Range: bytes=");
            if (marker >= 0) {
                const auto start = marker + static_cast<int>(QByteArray("Range: bytes=").size());
                const auto end = request.indexOf('-', start);
                rangeRequested_ = true;
                if (!ignoreRange_) {
                    offset = request.mid(start, end - start).toLongLong();
                }
            }
            if (requestCount_ == 1 && firstDisconnectBytes_ > 0 && marker < 0) {
                // 完全長headerに対してbody途中で切断し、次requestのRange再開を誘発する
                const auto partial = content_.first(firstDisconnectBytes_);
                QByteArray response =
                    "HTTP/1.1 200 OK\r\nContent-Length: " + QByteArray::number(content_.size()) +
                    "\r\nConnection: close\r\n\r\n" + partial;
                socket->write(response);
                socket->disconnectFromHost();
                return;
            }
            const auto body = content_.mid(offset);
            QByteArray response =
                offset > 0 ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n";
            response += "Content-Length: " + QByteArray::number(body.size()) + "\r\n";
            if (offset > 0) {
                response += "Content-Range: bytes " + QByteArray::number(offset) + "-" +
                            QByteArray::number(content_.size() - 1) + "/" +
                            QByteArray::number(content_.size()) + "\r\n";
            }
            response += "Connection: close\r\n\r\n" + body;
            socket->write(response);
            socket->disconnectFromHost();
        });
        connect(socket, &QTcpSocket::disconnected, socket, &QObject::deleteLater);
    }

  private:
    QByteArray content_;
    int transientFailures_{0};
    int permanentStatus_{0};
    bool ignoreRange_{false};
    int firstDisconnectBytes_{0};
    int requestCount_{0};
    bool rangeRequested_{false};
};

/** @brief LauncherServiceの自己更新規則を隔離して検証するFake Port群 */
class FakePorts final : public IGameCatalogRepository,
                        public IGameReleaseRepository,
                        public ILauncherReleaseRepository,
                        public IInstalledGameRepository,
                        public ISettingsRepository,
                        public IGameInstallationService,
                        public IGameProcessService,
                        public IStartupService,
                        public ILauncherUpdateService,
                        public IClock {
  public:
    /** @brief 一件の固定catalogを返す */
    std::vector<GameCatalogEntry> fetchCatalog(const std::string&) override {
        return {{GameId("sample-game"), "Sample", {}, {}, {}, "fixture-release"}};
    }

    /** @brief 空のお知らせを返す */
    std::vector<Announcement> fetchAnnouncements(const std::string&) override { return {}; }

    /** @brief 固定game releaseを返す */
    GameRelease fetchLatestRelease(const std::string&) override { return gameRelease; }

    /** @brief 固定launcher releaseを返す */
    LauncherRelease fetchLatestLauncherRelease(const std::string&) override {
        return launcherRelease;
    }

    /** @brief 固定launcher更新履歴を返す */
    std::vector<LauncherChangelogEntry> fetchLauncherChangelog(const std::string&) override {
        return changelog;
    }

    /** @brief 固定導入状態を返す */
    std::vector<InstalledGame> loadAll() override { return installed; }

    /** @brief 導入状態保存を成功させる */
    OperationResult save(const InstalledGame&) override { return OperationResult::success(); }

    /** @brief 導入状態削除を成功させる */
    OperationResult remove(const GameId&) override { return OperationResult::success(); }

    /** @brief 固定設定を返す */
    LauncherSettings load() override { return settings; }

    /** @brief 設定保存内容を記録する */
    OperationResult save(const LauncherSettings& value) override {
        settings = value;
        ++settingsSaveCount;
        return OperationResult::success();
    }

    /** @brief game導入を成功させる */
    OperationResult install(const GameRelease&, const std::string&, std::uint64_t,
                            const ProgressCallback&, std::atomic_bool&) override {
        return OperationResult::success();
    }

    /** @brief game検証を成功させる */
    OperationResult verify(const InstalledGame&, const GameRelease&) override {
        return OperationResult::success();
    }

    /** @brief active marker検証を成功させる */
    OperationResult validateActivation(const InstalledGame&) override {
        return OperationResult::success();
    }

    /** @brief game削除を成功させる */
    OperationResult uninstall(const InstalledGame&) override { return OperationResult::success(); }

    /** @brief 既存game取り込みを成功させる */
    OperationResult importExisting(const GameRelease&, const std::string&, const std::string&,
                                   const ProgressCallback&) override {
        return OperationResult::success();
    }

    /** @brief 一時data削除を成功させる */
    OperationResult cleanupTemporary(const InstalledGame&) override {
        return OperationResult::success();
    }

    /** @brief Fake取得を一時停止する */
    void pause() override {}

    /** @brief Fake取得を再開する */
    void resume() override {}

    /** @brief game起動を成功させる */
    OperationResult launch(const InstalledGame&, const std::string&, ExitCallback) override {
        return OperationResult::success();
    }

    /** @brief 設定された実行状態を返す */
    [[nodiscard]] bool isRunning(const GameId&) const override { return running; }

    /** @brief startup設定を成功させる */
    OperationResult apply(bool, bool) override { return OperationResult::success(); }

    /** @brief Maintenance Tool確認回数を記録する */
    OperationResult check() override {
        ++updateCheckCount;
        return OperationResult::success();
    }

    /** @brief Maintenance Tool適用回数を記録する */
    OperationResult apply() override {
        ++updateApplyCount;
        return OperationResult::success();
    }

    /** @brief 固定UTC時刻を返す */
    std::string nowUtc() override { return "2026-08-10T00:00:00Z"; }

    LauncherSettings settings;
    GameRelease gameRelease;
    LauncherRelease launcherRelease;
    std::vector<LauncherChangelogEntry> changelog;
    std::vector<InstalledGame> installed;
    bool running{false};
    int settingsSaveCount{0};
    int updateCheckCount{0};
    int updateApplyCount{0};
};

/** @brief 単一chunkのIntegration Test用releaseを作成する */
GameRelease fixtureRelease(const QByteArray& content, const QUrl& url,
                           const QByteArray& expectedHash = {}) {
    const auto hash = expectedHash.isEmpty()
                          ? QCryptographicHash::hash(content, QCryptographicHash::Sha256).toHex()
                          : expectedHash;
    GameRelease release;
    release.gameId = GameId("sample-game");
    release.version = SemanticVersion("1.0.0");
    release.engine = "godot";
    release.entrypoint = "bin/game";
    release.workingDirectory = "bin";
    release.saveDirectoryName = "sample-game";
    release.totalSize = static_cast<std::uint64_t>(content.size());
    release.signature = "fixture";
    release.files = {{"bin/game",
                      static_cast<std::uint64_t>(content.size()),
                      hash.toStdString(),
                      true,
                      {{0, static_cast<std::uint64_t>(content.size()), hash.toStdString(),
                        url.toString().toStdString()}}}};
    return release;
}

/** @brief 永続化、署名、Range再開、active切替のIntegration Test */
class LauncherIntegrationTests final : public QObject {
    Q_OBJECT

  private slots:
    /** @brief RFC 8032の既知vectorを検証する */
    void verifiesEd25519Signature();

    /** @brief localhost類似名を開発用HTTP例外として扱わない */
    void rejectsLookalikeLocalhost();

    /** @brief 設定と導入状態を原子的に往復できる */
    void persistsState();

    /** @brief 不正設定をOS適用・永続化より前に拒否する */
    void validatesSettingsBeforePersistence();

    /** @brief InstallStateをResolvingからReadyまで順に通知する */
    void reportsInstallStateTransitions();

    /** @brief 部分chunkからRange再開してactive releaseへ切り替える */
    void resumesAndActivatesRelease();

    /** @brief 同一content chunkを次releaseでnetwork再取得しない */
    void reusesContentAddressedChunkAcrossReleases();

    /** @brief cache削除後も正常chunkをactive版から戻して破損箇所だけ取得する */
    void redownloadsOnlyCorruptChunkAfterCacheCleanup();

    /** @brief 正規版と完全一致する既存ゲームだけを取り込む */
    void importsVerifiedExistingGame();

    /** @brief 5xxを再試行して正常dataへ回復する */
    void retriesTransientServerFailure();

    /** @brief body途中切断後に保存済みbyteからRange再開する */
    void resumesAfterMidstreamDisconnect();

    /** @brief Range非対応serverでは部分dataを破棄して全体取得へ戻る */
    void fallsBackWhenRangeIsUnsupported();

    /** @brief 4xxを再試行せず打ち切る */
    void stopsOnClientError();

    /** @brief SHA不一致を受理せずactive releaseを維持する */
    void rejectsHashMismatch();

    /** @brief manifest宣言を超えるserver応答を即時破棄する */
    void rejectsOversizedServerResponse();

    /** @brief cancel時にactive releaseを作らない */
    void cancelsDownloadWithoutActivation();

    /** @brief staging必要量が空き容量を超える場合は取得前に停止する */
    void rejectsInsufficientDiskSpace();

    /** @brief launcher管理directoryを作れない場合は安全に停止する */
    void rejectsUnwritableLayout();

    /** @brief launcher管理directoryのsymlink脱出を最初の書込前に拒否する */
    void rejectsLinkedManagementDirectory();

    /** @brief 設定した共有速度上限を超えて取得しない */
    void honorsDownloadSpeedLimit();

    /** @brief launcher更新metadata、必須更新、適用を接続する */
    void checksAndAppliesLauncherUpdate();

    /** @brief IFW配布layoutからMaintenance Toolの正しい場所を解決する */
    void resolvesMaintenanceToolFromInstalledLayout();

    /** @brief 公開launcher更新履歴契約を解析する */
    void parsesLauncherChangelogContract();

    /** @brief additional propertyと小数sizeをJSON境界で拒否する */
    void rejectsNonContractJson();

    /** @brief Unity、Godot、Siv3D相当processとcrash終了を監視する */
    void launchesEngineFixturesAndReportsCrash();
};

void LauncherIntegrationTests::verifiesEd25519Signature() {
    const OpenSslEd25519Verifier verifier("11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=");
    QVERIFY(verifier.verify({}, "5VZDAMNgrHKQhuLMgG6CioSHfx645dl02HPgZSJJAVVfuIIVkKM7rMYeOXAc+"
                                "bRr0lv18FlbviRlUUFDjnoQCw=="));
    QVERIFY(!verifier.verify("tampered", "5VZDAMNgrHKQhuLMgG6CioSHfx645dl02HPgZSJJAVVfuIIVkKM7rMYeO"
                                         "XAc+bRr0lv18FlbviRlUUFDjnoQCw=="));
}

void LauncherIntegrationTests::rejectsLookalikeLocalhost() {
    const auto key = QByteArray(32, 'x').toBase64();
    bool rejected = false;
    try {
        StaticContentRepository repository(QUrl("http://notlocalhost.example/"), key);
    } catch (const std::invalid_argument&) {
        rejected = true;
    }
    QVERIFY(rejected);

    // Fixture server用のloopback完全一致だけはHTTPを許可する
    StaticContentRepository repository(QUrl("http://127.0.0.1/"), key);
}

void LauncherIntegrationTests::persistsState() {
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    JsonStateRepository repository(directory.path());
    auto settings = repository.load();
    settings.language = "en-US";
    settings.downloadLimitBytesPerSecond = 123456;
    QVERIFY(repository.save(settings).ok);
    QCOMPARE(repository.load().language, std::string("en-US"));
    QCOMPARE(repository.load().downloadLimitBytesPerSecond, std::uint64_t(123456));

    const InstalledGame installed{GameId("sample-game"),
                                  SemanticVersion("1.0.0"),
                                  directory.filePath("sample-game").toStdString(),
                                  "bin/game",
                                  "bin",
                                  "sample-game"};
    QVERIFY(repository.save(installed).ok);
    QCOMPARE(repository.loadAll().size(), std::size_t(1));
    QVERIFY(repository.remove(installed.gameId).ok);
    QVERIFY(repository.loadAll().empty());
}

void LauncherIntegrationTests::validatesSettingsBeforePersistence() {
    FakePorts ports;
    ports.settings.installRoot = QDir::tempPath().toStdString();
    LauncherService service(ports, ports, ports, ports, ports, ports, ports, ports, ports, ports,
                            SemanticVersion("1.0.0"));
    QVERIFY(service.load().ok);

    auto settings = ports.settings;
    settings.language = "unsupported";
    QVERIFY(!service.saveSettings(settings).ok);
    settings = ports.settings;
    settings.installRoot = "relative/path";
    QVERIFY(!service.saveSettings(settings).ok);
    settings = ports.settings;
    settings.downloadLimitBytesPerSecond = 1024ULL * 1024ULL * 1024ULL + 1;
    QVERIFY(!service.saveSettings(settings).ok);
    QCOMPARE(ports.settingsSaveCount, 0);

    settings = ports.settings;
    settings.language = "en-US";
    QVERIFY(service.saveSettings(settings).ok);
    QCOMPARE(ports.settingsSaveCount, 1);
}

void LauncherIntegrationTests::reportsInstallStateTransitions() {
    FakePorts ports;
    ports.settings.installRoot = QDir::tempPath().toStdString();
    ports.gameRelease =
        fixtureRelease(QByteArray("fixture"), QUrl("https://downloads.pandd.org/blob"));
    LauncherService service(ports, ports, ports, ports, ports, ports, ports, ports, ports, ports,
                            SemanticVersion("1.0.0"));
    QVERIFY(service.load().ok);
    std::vector<InstallState> states;
    service.setStateCallback([&states](const GameId&, InstallState state, const OperationError&) {
        states.push_back(state);
    });

    QVERIFY(service.installOrUpdate(GameId("sample-game"), {}).ok);
    QCOMPARE(states.size(), std::size_t(3));
    QCOMPARE(states[0], InstallState::Resolving);
    QCOMPARE(states[1], InstallState::Downloading);
    QCOMPARE(states[2], InstallState::Ready);
    QCOMPARE(service.installedGames().size(), std::size_t(1));
}

void LauncherIntegrationTests::resumesAndActivatesRelease() {
    const QByteArray content("fixture-game-binary");
    FixtureHttpServer server(content);
    QVERIFY(server.start());
    const auto hash = QCryptographicHash::hash(content, QCryptographicHash::Sha256).toHex();
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    const auto gameRoot = directory.filePath("sample-game");

    GameRelease release;
    release.gameId = GameId("sample-game");
    release.version = SemanticVersion("1.0.0");
    release.engine = "godot";
    release.entrypoint = "bin/game";
    release.workingDirectory = "bin";
    release.saveDirectoryName = "sample-game";
    release.totalSize = static_cast<std::uint64_t>(content.size());
    release.signature = "fixture";
    release.files = {
        {"bin/game",
         static_cast<std::uint64_t>(content.size()),
         hash.toStdString(),
         true,
         {{0, static_cast<std::uint64_t>(content.size()), hash.toStdString(),
           QString("http://127.0.0.1:%1/blob").arg(server.serverPort()).toStdString()}}}};

    // 前回終了時の部分fileを用意してRange経路を通す
    const auto partDirectory = QDir(gameRoot).filePath(".launcher/cache/sha256");
    QDir().mkpath(partDirectory);
    QFile part(QDir(partDirectory).filePath(hash));
    QVERIFY(part.open(QIODevice::WriteOnly));
    QCOMPARE(part.write(content.first(5)), qint64(5));
    part.close();

    GameInstallationService service;
    std::atomic_bool cancelled{false};
    auto future = QtConcurrent::run(
        [&] { return service.install(release, gameRoot.toStdString(), 0, {}, cancelled); });
    while (!future.isFinished()) {
        QCoreApplication::processEvents(QEventLoop::AllEvents, 20);
        QTest::qWait(1);
    }
    QVERIFY(future.result().ok);
    QVERIFY(server.rangeRequested());
    QFile installed(QDir(gameRoot).filePath("releases/1.0.0/bin/game"));
    QVERIFY(installed.open(QIODevice::ReadOnly));
    QCOMPARE(installed.readAll(), content);
    QVERIFY(QFileInfo::exists(QDir(gameRoot).filePath(".launcher/active.json")));
}

void LauncherIntegrationTests::reusesContentAddressedChunkAcrossReleases() {
    const QByteArray content("shared-content-addressed-game-chunk");
    FixtureHttpServer server(content);
    QVERIFY(server.start());
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    const auto url = QUrl(QString("http://127.0.0.1:%1/blob").arg(server.serverPort()));
    auto release = fixtureRelease(content, url);
    const auto gameRoot = directory.filePath("sample-game");
    GameInstallationService service;
    std::atomic_bool cancelled{false};

    auto install = [&](const SemanticVersion& version) {
        release.version = version;
        auto future = QtConcurrent::run(
            [&] { return service.install(release, gameRoot.toStdString(), 0, {}, cancelled); });
        while (!future.isFinished()) {
            QCoreApplication::processEvents(QEventLoop::AllEvents, 20);
            QTest::qWait(1);
        }
        return future.result();
    };

    QVERIFY(install(SemanticVersion("1.0.0")).ok);
    QCOMPARE(server.requestCount(), 1);
    QVERIFY(install(SemanticVersion("2.0.0")).ok);
    QCOMPARE(server.requestCount(), 1);
    QVERIFY(QFileInfo::exists(QDir(gameRoot).filePath("releases/1.0.0/bin/game")));
    QVERIFY(QFileInfo::exists(QDir(gameRoot).filePath("releases/2.0.0/bin/game")));
}

void LauncherIntegrationTests::redownloadsOnlyCorruptChunkAfterCacheCleanup() {
    const QByteArray firstContent("first-game-file");
    const QByteArray secondContent("second-game-file");
    FixtureHttpServer firstServer(firstContent);
    FixtureHttpServer secondServer(secondContent);
    QVERIFY(firstServer.start());
    QVERIFY(secondServer.start());
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    auto release = fixtureRelease(
        firstContent, QUrl(QString("http://127.0.0.1:%1/first").arg(firstServer.serverPort())));
    const auto secondHash =
        QCryptographicHash::hash(secondContent, QCryptographicHash::Sha256).toHex();
    release.files.push_back(
        {"data/second.bin",
         static_cast<std::uint64_t>(secondContent.size()),
         secondHash.toStdString(),
         false,
         {{0, static_cast<std::uint64_t>(secondContent.size()), secondHash.toStdString(),
           QUrl(QString("http://127.0.0.1:%1/second").arg(secondServer.serverPort()))
               .toString()
               .toStdString()}}});
    release.totalSize += static_cast<std::uint64_t>(secondContent.size());
    const auto gameRoot = directory.filePath("sample-game");
    GameInstallationService service;
    std::atomic_bool cancelled{false};
    auto install = [&] {
        auto future = QtConcurrent::run(
            [&] { return service.install(release, gameRoot.toStdString(), 0, {}, cancelled); });
        while (!future.isFinished()) {
            QCoreApplication::processEvents(QEventLoop::AllEvents, 20);
            QTest::qWait(1);
        }
        return future.result();
    };
    QVERIFY(install().ok);
    QCOMPARE(firstServer.requestCount(), 1);
    QCOMPARE(secondServer.requestCount(), 1);

    const InstalledGame installed{release.gameId,           release.version,
                                  gameRoot.toStdString(),   release.entrypoint,
                                  release.workingDirectory, release.saveDirectoryName};
    QVERIFY(service.cleanupTemporary(installed).ok);
    QFile corrupted(QDir(gameRoot).filePath("releases/1.0.0/bin/game"));
    QVERIFY(corrupted.open(QIODevice::WriteOnly | QIODevice::Truncate));
    QCOMPARE(corrupted.write(QByteArray(firstContent.size(), 'X')),
             static_cast<qint64>(firstContent.size()));
    corrupted.close();

    const auto repair = install();
    QVERIFY2(repair.ok, repair.error.detail.c_str());
    QCOMPARE(firstServer.requestCount(), 2);
    QCOMPARE(secondServer.requestCount(), 1);
}

void LauncherIntegrationTests::importsVerifiedExistingGame() {
    const QByteArray content("existing-game-binary");
    const auto hash = QCryptographicHash::hash(content, QCryptographicHash::Sha256).toHex();
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    const auto sourceRoot = directory.filePath("existing");
    QDir().mkpath(QDir(sourceRoot).filePath("bin"));
    QFile source(QDir(sourceRoot).filePath("bin/game.exe"));
    QVERIFY(source.open(QIODevice::WriteOnly));
    QCOMPARE(source.write(content), static_cast<qint64>(content.size()));
    source.close();

    GameRelease release;
    release.gameId = GameId("sample-game");
    release.version = SemanticVersion("1.0.0");
    release.engine = "godot";
    release.entrypoint = "bin/game.exe";
    release.workingDirectory = "bin";
    release.saveDirectoryName = "sample-game";
    release.totalSize = static_cast<std::uint64_t>(content.size());
    release.signature = "fixture";
    release.files = {{"bin/game.exe",
                      static_cast<std::uint64_t>(content.size()),
                      hash.toStdString(),
                      true,
                      {{0, static_cast<std::uint64_t>(content.size()), hash.toStdString(),
                        "http://127.0.0.1/unused"}}}};

    GameInstallationService service;
    const auto gameRoot = directory.filePath("managed/sample-game");
    QVERIFY(
        service.importExisting(release, sourceRoot.toStdString(), gameRoot.toStdString(), {}).ok);
    QFile imported(QDir(gameRoot).filePath("releases/1.0.0/bin/game.exe"));
    QVERIFY(imported.open(QIODevice::ReadOnly));
    QCOMPARE(imported.readAll(), content);

    // cleanupはactive releaseを残しstagingだけを削除
    const auto temporaryPath = QDir(gameRoot).filePath(".launcher/staging/failed/chunk.part");
    QDir().mkpath(QFileInfo(temporaryPath).absolutePath());
    QFile temporaryFile(temporaryPath);
    QVERIFY(temporaryFile.open(QIODevice::WriteOnly));
    temporaryFile.write("partial");
    temporaryFile.close();
    const auto cachePath = QDir(gameRoot).filePath(".launcher/cache/sha256/unused");
    QDir().mkpath(QFileInfo(cachePath).absolutePath());
    QFile cacheFile(cachePath);
    QVERIFY(cacheFile.open(QIODevice::WriteOnly));
    cacheFile.write("cached");
    cacheFile.close();
    const InstalledGame installed{release.gameId,           release.version,
                                  gameRoot.toStdString(),   release.entrypoint,
                                  release.workingDirectory, release.saveDirectoryName};
    QVERIFY(service.cleanupTemporary(installed).ok);
    QVERIFY(!QFileInfo::exists(QDir(gameRoot).filePath(".launcher/staging")));
    QVERIFY(!QFileInfo::exists(QDir(gameRoot).filePath(".launcher/cache")));
    QVERIFY(QFileInfo::exists(QDir(gameRoot).filePath(".launcher/active.json")));
    QVERIFY(service.validateActivation(installed).ok);

    QFile activeMarker(QDir(gameRoot).filePath(".launcher/active.json"));
    QVERIFY(activeMarker.open(QIODevice::WriteOnly | QIODevice::Truncate));
    activeMarker.write(R"({"schemaVersion":1,"version":"9.9.9"})");
    activeMarker.close();
    QVERIFY(!service.validateActivation(installed).ok);

    // 余分なfileがあるdirectoryは正規releaseとして登録しない
    QFile extra(QDir(sourceRoot).filePath("unexpected.txt"));
    QVERIFY(extra.open(QIODevice::WriteOnly));
    extra.write("unexpected");
    extra.close();
    const auto otherRoot = directory.filePath("managed/other-game");
    QVERIFY(
        !service.importExisting(release, sourceRoot.toStdString(), otherRoot.toStdString(), {}).ok);
    QVERIFY(!QFileInfo::exists(QDir(otherRoot).filePath(".launcher/active.json")));
}

void LauncherIntegrationTests::retriesTransientServerFailure() {
    const QByteArray content(qsizetype{128} * 1024, 'R');
    FixtureHttpServer server(content, 2);
    QVERIFY(server.start());
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    const auto release =
        fixtureRelease(content, QUrl(QString("http://127.0.0.1:%1/blob").arg(server.serverPort())));

    GameInstallationService service;
    std::atomic_bool cancelled{false};
    auto future = QtConcurrent::run([&] {
        return service.install(release, directory.filePath("sample-game").toStdString(), 0, {},
                               cancelled);
    });
    while (!future.isFinished()) {
        QCoreApplication::processEvents(QEventLoop::AllEvents, 20);
        QTest::qWait(1);
    }
    QVERIFY(future.result().ok);
    QCOMPARE(server.requestCount(), 3);
}

void LauncherIntegrationTests::resumesAfterMidstreamDisconnect() {
    const QByteArray content(qsizetype{128} * 1024, 'D');
    FixtureHttpServer server(content, 0, 0, false, 16 * 1024);
    QVERIFY(server.start());
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    const auto release =
        fixtureRelease(content, QUrl(QString("http://127.0.0.1:%1/blob").arg(server.serverPort())));
    GameInstallationService service;
    std::atomic_bool cancelled{false};

    auto future = QtConcurrent::run([&] {
        return service.install(release, directory.filePath("sample-game").toStdString(), 0, {},
                               cancelled);
    });
    while (!future.isFinished()) {
        QCoreApplication::processEvents(QEventLoop::AllEvents, 20);
        QTest::qWait(1);
    }
    QVERIFY(future.result().ok);
    QVERIFY(server.rangeRequested());
    QCOMPARE(server.requestCount(), 2);
}

void LauncherIntegrationTests::fallsBackWhenRangeIsUnsupported() {
    const QByteArray content("range-fallback-content");
    FixtureHttpServer server(content, 0, 0, true);
    QVERIFY(server.start());
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    const auto release =
        fixtureRelease(content, QUrl(QString("http://127.0.0.1:%1/blob").arg(server.serverPort())));
    const auto partDirectory = directory.filePath("sample-game/.launcher/cache/sha256");
    QDir().mkpath(partDirectory);
    const auto hash = QCryptographicHash::hash(content, QCryptographicHash::Sha256).toHex();
    QFile part(QDir(partDirectory).filePath(hash));
    QVERIFY(part.open(QIODevice::WriteOnly));
    part.write(content.first(4));
    part.close();

    GameInstallationService service;
    std::atomic_bool cancelled{false};
    auto future = QtConcurrent::run([&] {
        return service.install(release, directory.filePath("sample-game").toStdString(), 0, {},
                               cancelled);
    });
    while (!future.isFinished()) {
        QCoreApplication::processEvents(QEventLoop::AllEvents, 20);
        QTest::qWait(1);
    }
    QVERIFY(future.result().ok);
    QVERIFY(server.rangeRequested());
    QCOMPARE(server.requestCount(), 2);
}

void LauncherIntegrationTests::stopsOnClientError() {
    const QByteArray content("not-found");
    FixtureHttpServer server(content, 0, 404);
    QVERIFY(server.start());
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    const auto release =
        fixtureRelease(content, QUrl(QString("http://127.0.0.1:%1/blob").arg(server.serverPort())));

    GameInstallationService service;
    std::atomic_bool cancelled{false};
    auto future = QtConcurrent::run([&] {
        return service.install(release, directory.filePath("sample-game").toStdString(), 0, {},
                               cancelled);
    });
    while (!future.isFinished()) {
        QCoreApplication::processEvents(QEventLoop::AllEvents, 20);
        QTest::qWait(1);
    }
    QVERIFY(!future.result().ok);
    QCOMPARE(future.result().error.code, ErrorCode::DownloadHttpError);
    QCOMPARE(server.requestCount(), 1);
}

void LauncherIntegrationTests::rejectsHashMismatch() {
    const QByteArray content("tampered-content");
    FixtureHttpServer server(content);
    QVERIFY(server.start());
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    const auto release =
        fixtureRelease(content, QUrl(QString("http://127.0.0.1:%1/blob").arg(server.serverPort())),
                       QByteArray(64, '0'));

    GameInstallationService service;
    std::atomic_bool cancelled{false};
    auto future = QtConcurrent::run([&] {
        return service.install(release, directory.filePath("sample-game").toStdString(), 0, {},
                               cancelled);
    });
    while (!future.isFinished()) {
        QCoreApplication::processEvents(QEventLoop::AllEvents, 20);
        QTest::qWait(1);
    }
    QVERIFY(!future.result().ok);
    QVERIFY(!QFileInfo::exists(directory.filePath("sample-game/.launcher/active.json")));
    QCOMPARE(server.requestCount(), 3);
}

void LauncherIntegrationTests::rejectsOversizedServerResponse() {
    const QByteArray expected("bounded-content");
    FixtureHttpServer server(expected + QByteArray(qsizetype{64} * 1024, 'X'));
    QVERIFY(server.start());
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    const auto release = fixtureRelease(
        expected, QUrl(QString("http://127.0.0.1:%1/blob").arg(server.serverPort())));
    GameInstallationService service;
    std::atomic_bool cancelled{false};

    auto future = QtConcurrent::run([&] {
        return service.install(release, directory.filePath("sample-game").toStdString(), 0, {},
                               cancelled);
    });
    while (!future.isFinished()) {
        QCoreApplication::processEvents(QEventLoop::AllEvents, 20);
        QTest::qWait(1);
    }
    QVERIFY(!future.result().ok);
    QCOMPARE(future.result().error.code, ErrorCode::DownloadHttpError);
    QVERIFY(!QFileInfo::exists(directory.filePath("sample-game/.launcher/active.json")));
}

void LauncherIntegrationTests::cancelsDownloadWithoutActivation() {
    const QByteArray content(qsizetype{64} * 1024, 'C');
    FixtureHttpServer server(content);
    QVERIFY(server.start());
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    const auto release =
        fixtureRelease(content, QUrl(QString("http://127.0.0.1:%1/blob").arg(server.serverPort())));

    GameInstallationService service;
    std::atomic_bool cancelled{true};
    auto future = QtConcurrent::run([&] {
        return service.install(release, directory.filePath("sample-game").toStdString(), 0, {},
                               cancelled);
    });
    while (!future.isFinished()) {
        QCoreApplication::processEvents(QEventLoop::AllEvents, 20);
        QTest::qWait(1);
    }
    QCOMPARE(future.result().error.code, ErrorCode::OperationCancelled);
    QVERIFY(!QFileInfo::exists(directory.filePath("sample-game/.launcher/active.json")));
}

void LauncherIntegrationTests::rejectsInsufficientDiskSpace() {
    const QByteArray content("disk-preflight-fixture");
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    auto release = fixtureRelease(content, QUrl("http://127.0.0.1/unused"));
    release.totalSize = std::numeric_limits<std::uint64_t>::max();
    GameInstallationService service;
    std::atomic_bool cancelled{false};

    const auto result =
        service.install(release, directory.filePath("sample-game").toStdString(), 0, {}, cancelled);
    QVERIFY(!result.ok);
    QCOMPARE(result.error.code, ErrorCode::DiskSpaceInsufficient);
}

void LauncherIntegrationTests::rejectsUnwritableLayout() {
    const QByteArray content("permission-fixture");
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    const auto gameRoot = directory.filePath("sample-game");
    QDir().mkpath(gameRoot);
    QFile launcherMarker(QDir(gameRoot).filePath(".launcher"));
    QVERIFY(launcherMarker.open(QIODevice::WriteOnly));
    launcherMarker.write("blocks directory creation");
    launcherMarker.close();
    const auto release = fixtureRelease(content, QUrl("http://127.0.0.1/unused"));
    GameInstallationService service;
    std::atomic_bool cancelled{false};

    const auto result = service.install(release, gameRoot.toStdString(), 0, {}, cancelled);
    QVERIFY(!result.ok);
    QCOMPARE(result.error.code, ErrorCode::InstallPermissionDenied);
    QVERIFY(!QFileInfo::exists(QDir(gameRoot).filePath(".launcher/active.json")));
}

void LauncherIntegrationTests::rejectsLinkedManagementDirectory() {
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    const auto gameRoot = directory.filePath("sample-game");
    const auto outside = directory.filePath("outside");
    QVERIFY(QDir().mkpath(gameRoot));
    QVERIFY(QDir().mkpath(outside));
    std::error_code linkError;
    std::filesystem::create_directory_symlink(
        std::filesystem::path(outside.toStdString()),
        std::filesystem::path(QDir(gameRoot).filePath(".launcher").toStdString()), linkError);
    if (linkError) {
        QSKIP("This host does not permit directory symlink creation");
    }
    const auto release = fixtureRelease(QByteArray("unused"), QUrl("http://127.0.0.1/unused"));
    GameInstallationService service;
    std::atomic_bool cancelled{false};

    const auto result = service.install(release, gameRoot.toStdString(), 0, {}, cancelled);
    QVERIFY(!result.ok);
    QCOMPARE(result.error.code, ErrorCode::ManifestInvalid);
    QVERIFY(QDir(outside).entryList(QDir::AllEntries | QDir::NoDotAndDotDot).isEmpty());
}

void LauncherIntegrationTests::honorsDownloadSpeedLimit() {
    const QByteArray content(qsizetype{192} * 1024, 'S');
    FixtureHttpServer server(content);
    QVERIFY(server.start());
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    const auto release =
        fixtureRelease(content, QUrl(QString("http://127.0.0.1:%1/blob").arg(server.serverPort())));

    GameInstallationService service;
    std::atomic_bool cancelled{false};
    QElapsedTimer timer;
    timer.start();
    auto future = QtConcurrent::run([&] {
        return service.install(release, directory.filePath("sample-game").toStdString(),
                               std::uint64_t{128} * 1024, {}, cancelled);
    });
    while (!future.isFinished()) {
        QCoreApplication::processEvents(QEventLoop::AllEvents, 20);
        QTest::qWait(1);
    }
    QVERIFY(future.result().ok);
    QVERIFY2(timer.elapsed() >= 1400, "download completed faster than the configured limit");
}

void LauncherIntegrationTests::resolvesMaintenanceToolFromInstalledLayout() {
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
#if defined(Q_OS_MACOS)
    const auto applicationDirectory =
        QDir(directory.path()).filePath("PandD Game Launcher.app/Contents/MacOS");
    const auto expected =
        QDir(directory.path()).filePath("maintenancetool.app/Contents/MacOS/maintenancetool");
#elif defined(Q_OS_WIN)
    const auto applicationDirectory = QDir(directory.path()).filePath("bin");
    const auto expected = QDir(directory.path()).filePath("maintenancetool.exe");
#else
    const auto applicationDirectory = QDir(directory.path()).filePath("bin");
    const auto expected = QDir(directory.path()).filePath("maintenancetool");
#endif
    QCOMPARE(MaintenanceToolService::executablePathForApplicationDirectory(applicationDirectory),
             expected);
}

void LauncherIntegrationTests::checksAndAppliesLauncherUpdate() {
    FakePorts ports;
    ports.settings.language = "ja-JP";
    ports.settings.installRoot = QDir::tempPath().toStdString();
    ports.launcherRelease = {1,
                             SemanticVersion("2.0.0"),
                             true,
                             "Critical security update",
                             "2026-08-10T00:00:00Z",
                             "https://downloads.koto-thing.com/ifw"};
    LauncherService service(ports, ports, ports, ports, ports, ports, ports, ports, ports, ports,
                            SemanticVersion("1.0.0"));
    QVERIFY(service.load().ok);
    auto invalidSettings = ports.settings;
    invalidSettings.language = "fr_FR";
    QVERIFY(!service.saveSettings(invalidSettings).ok);
    QVERIFY(service.checkLauncherUpdate().ok);

    const auto status = service.launcherUpdateStatus();
    QVERIFY(status.updateAvailable);
    QVERIFY(status.mandatory);
    QCOMPARE(status.latestVersion, SemanticVersion("2.0.0"));
    QCOMPARE(status.checkedAt, std::string("2026-08-10T00:00:00Z"));
    QCOMPARE(ports.updateCheckCount, 1);
    QCOMPARE(ports.settingsSaveCount, 1);
    QVERIFY(service.applyLauncherUpdate().ok);
    QCOMPARE(ports.updateApplyCount, 1);

    // game process実行中はMaintenance Toolを起動しない
    ports.installed = {{GameId("sample-game"), SemanticVersion("1.0.0"), "sample-game", "bin/game",
                        "bin", "sample-game"}};
    LauncherService blockedService(ports, ports, ports, ports, ports, ports, ports, ports, ports,
                                   ports, SemanticVersion("1.0.0"));
    QVERIFY(blockedService.load().ok);
    QVERIFY(blockedService.checkLauncherUpdate().ok);
    ports.running = true;
    QVERIFY(!blockedService.applyLauncherUpdate().ok);
    QCOMPARE(ports.updateApplyCount, 1);
}

void LauncherIntegrationTests::parsesLauncherChangelogContract() {
    const auto entries = JsonCodec::parseLauncherChangelog(R"json({
        "schemaVersion": 1,
        "releases": [{
            "version": "1.2.0",
            "title": "Launcher improvements",
            "publishedAt": "2026-08-10T00:00:00Z",
            "changes": ["Safer updates", "Improved settings"]
        }]
    })json");
    QCOMPARE(entries.size(), std::size_t(1));
    QCOMPARE(entries.front().version, SemanticVersion("1.2.0"));
    QCOMPARE(entries.front().changes.size(), std::size_t(2));
}

void LauncherIntegrationTests::rejectsNonContractJson() {
    bool extraKeyRejected = false;
    try {
        JsonCodec::parseCatalog(
            R"({"schemaVersion":1,"generatedAt":"2026-08-10T00:00:00Z","games":[],"extra":true})");
    } catch (const std::runtime_error&) {
        extraKeyRejected = true;
    }
    QVERIFY(extraKeyRejected);

    bool fractionalSizeRejected = false;
    try {
        JsonCodec::parseRelease(
            R"({"schemaVersion":1,"gameId":"sample-game","version":"1.0.0","platform":"windows","arch":"x86_64","minimumLauncherVersion":"1.0.0","engine":"godot","entrypoint":"bin/game.exe","workingDirectory":"bin","arguments":[],"saveDirectoryName":"sample-game","totalSize":1.5,"files":[],"publishedAt":"2026-08-10T00:00:00Z","signature":"signed"})");
    } catch (const std::runtime_error&) {
        fractionalSizeRejected = true;
    }
    QVERIFY(fractionalSizeRejected);
}

void LauncherIntegrationTests::launchesEngineFixturesAndReportsCrash() {
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    const QFileInfo fixture(QString::fromUtf8(PANDD_PROCESS_FIXTURE_PATH));
    QVERIFY(fixture.exists());
    QtGameProcessService service;

    for (const auto& engine : {QString("unity"), QString("godot"), QString("siv3d")}) {
        const auto gameId = engine + "-game";
        const auto executableName =
            engine + "-game" + (fixture.suffix().isEmpty() ? QString{} : "." + fixture.suffix());
        const auto gameRoot = directory.filePath(gameId);
        const auto executable = QDir(gameRoot).filePath("releases/1.0.0/bin/" + executableName);
        QDir().mkpath(QFileInfo(executable).absolutePath());
        QVERIFY(QFile::copy(fixture.absoluteFilePath(), executable));
        QFile::setPermissions(executable, QFile::permissions(executable) | QFileDevice::ExeOwner);
        const InstalledGame installed{GameId(gameId.toStdString()),
                                      SemanticVersion("1.0.0"),
                                      gameRoot.toStdString(),
                                      ("bin/" + executableName).toStdString(),
                                      "bin",
                                      gameId.toStdString()};
        bool exited = false;
        bool crashed = true;
        const auto saveDirectory = directory.filePath("saves/" + gameId);
        QVERIFY(service
                    .launch(installed, saveDirectory.toStdString(),
                            [&](int exitCode, bool didCrash) {
                                QCOMPARE(exitCode, 0);
                                crashed = didCrash;
                                exited = true;
                            })
                    .ok);
        QTRY_VERIFY_WITH_TIMEOUT(exited, 5000);
        QVERIFY(!crashed);
        QVERIFY(QFileInfo::exists(QDir(saveDirectory).filePath("fixture-ran.txt")));
        QCoreApplication::processEvents();
    }

    const auto crashRoot = directory.filePath("crash-game");
    const auto crashName =
        QString("crash-game") + (fixture.suffix().isEmpty() ? QString{} : "." + fixture.suffix());
    const auto crashExecutable = QDir(crashRoot).filePath("releases/1.0.0/bin/" + crashName);
    QDir().mkpath(QFileInfo(crashExecutable).absolutePath());
    QVERIFY(QFile::copy(fixture.absoluteFilePath(), crashExecutable));
    QFile::setPermissions(crashExecutable,
                          QFile::permissions(crashExecutable) | QFileDevice::ExeOwner);
    const InstalledGame crashGame{GameId("crash-game"),
                                  SemanticVersion("1.0.0"),
                                  crashRoot.toStdString(),
                                  ("bin/" + crashName).toStdString(),
                                  "bin",
                                  "crash-game"};
    bool exited = false;
    bool crashed = false;
    QVERIFY(service
                .launch(crashGame, directory.filePath("saves/crash-game").toStdString(),
                        [&](int, bool didCrash) {
                            crashed = didCrash;
                            exited = true;
                        })
                .ok);
    QTRY_VERIFY_WITH_TIMEOUT(exited, 5000);
    QVERIFY(crashed);
}

QTEST_GUILESS_MAIN(LauncherIntegrationTests)
#include "LauncherIntegrationTests.moc"
