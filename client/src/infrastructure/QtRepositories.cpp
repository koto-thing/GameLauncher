#include "infrastructure/QtRepositories.h"

#include "infrastructure/JsonCodec.h"

#include <QCoreApplication>
#include <QDir>
#include <QEventLoop>
#include <QFile>
#include <QJsonDocument>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QSaveFile>
#include <QStandardPaths>
#include <QThread>

#include <algorithm>
#include <memory>
#include <set>
#include <stdexcept>

#include <openssl/evp.h>

namespace pandd {
namespace {

/** @brief 永続化失敗結果を作成する */
OperationResult storageFailure(const QString& detail) {
    return OperationResult::failure({ErrorCode::InstallPermissionDenied,
                                     "ランチャー情報を保存できません", detail.toStdString(), true});
}

} // namespace

OpenSslEd25519Verifier::OpenSslEd25519Verifier(QByteArray publicKeyBase64)
    : publicKey_(QByteArray::fromBase64(publicKeyBase64)) {
    if (publicKey_.size() != 32) {
        throw std::invalid_argument("Ed25519 public key must contain 32 bytes");
    }
}

bool OpenSslEd25519Verifier::verify(const QByteArray& payload,
                                    const QByteArray& signatureBase64) const {
    const auto signature = QByteArray::fromBase64(signatureBase64);
    if (signature.size() != 64) {
        return false;
    }

    // EVPはEd25519でhash指定を許可しないためpayloadを直接渡す
    auto* key = EVP_PKEY_new_raw_public_key(
        EVP_PKEY_ED25519, nullptr, reinterpret_cast<const unsigned char*>(publicKey_.constData()),
        static_cast<std::size_t>(publicKey_.size()));
    if (key == nullptr) {
        return false;
    }
    std::unique_ptr<EVP_PKEY, decltype(&EVP_PKEY_free)> keyGuard(key, &EVP_PKEY_free);
    auto* context = EVP_MD_CTX_new();
    if (context == nullptr) {
        return false;
    }
    std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)> contextGuard(context, &EVP_MD_CTX_free);
    if (EVP_DigestVerifyInit(context, nullptr, nullptr, nullptr, key) != 1) {
        return false;
    }
    return EVP_DigestVerify(context, reinterpret_cast<const unsigned char*>(signature.constData()),
                            static_cast<std::size_t>(signature.size()),
                            reinterpret_cast<const unsigned char*>(payload.constData()),
                            static_cast<std::size_t>(payload.size())) == 1;
}

StaticContentRepository::StaticContentRepository(QUrl baseUrl, QByteArray manifestPublicKeyBase64,
                                                 QObject* networkParent)
    : baseUrl_(std::move(baseUrl)), allowedHost_(baseUrl_.host().toLower()),
      validator_({allowedHost_.toStdString()}),
      signatureVerifier_(std::move(manifestPublicKeyBase64)) {
    Q_UNUSED(networkParent)
    const auto scheme = baseUrl_.scheme().toLower();
    const auto host = baseUrl_.host().toLower();
    const bool localDevelopment = scheme == "http" && (host == "localhost" || host == "127.0.0.1");
    if (!baseUrl_.isValid() || (scheme != "https" && !localDevelopment)) {
        throw std::invalid_argument("static content base URL must use HTTPS");
    }
}

std::vector<GameCatalogEntry> StaticContentRepository::fetchCatalog(const std::string& language) {
    const auto path =
        QString("v1/catalog/%1/%2/%3.json")
            .arg(QString::fromStdString(language), platformName(), architectureName());
    auto result = JsonCodec::parseCatalog(get(baseUrl_.resolved(QUrl(path)), 8 * 1024 * 1024));
    for (const auto& entry : result) {
        if (!isAllowedUrl(QUrl(QString::fromStdString(entry.latestReleaseUrl))) ||
            !isAllowedUrl(QUrl(QString::fromStdString(entry.heroUrl))) ||
            !isAllowedUrl(QUrl(QString::fromStdString(entry.thumbnailUrl)))) {
            throw std::runtime_error("catalog contains an untrusted URL");
        }
    }
    return result;
}

std::vector<Announcement> StaticContentRepository::fetchAnnouncements(const std::string& language) {
    const auto path = QString("v1/announcements/%1.json").arg(QString::fromStdString(language));
    return JsonCodec::parseAnnouncements(get(baseUrl_.resolved(QUrl(path)), 4 * 1024 * 1024));
}

GameRelease StaticContentRepository::fetchLatestRelease(const std::string& releaseUrl) {
    const QUrl url(QString::fromStdString(releaseUrl));
    if (!isAllowedUrl(url)) {
        throw std::runtime_error("release URL uses an untrusted host");
    }
    const auto data = get(url, 16 * 1024 * 1024);
    const auto release = JsonCodec::parseRelease(data);

    // 署名検証後にのみ構造検証済みリリースを返す
    if (!signatureVerifier_.verify(JsonCodec::canonicalReleasePayload(data),
                                   QByteArray::fromStdString(release.signature))) {
        throw std::runtime_error("manifest signature is invalid");
    }
    const auto validation = validator_.validate(release);
    if (!validation.ok) {
        throw std::runtime_error(validation.error.detail);
    }
    return release;
}

LauncherRelease StaticContentRepository::fetchLatestLauncherRelease(const std::string& language) {
    const auto path =
        QString("v1/launcher/releases/%1/%2/%3/latest.json")
            .arg(QString::fromStdString(language), platformName(), architectureName());
    const auto release =
        JsonCodec::parseLauncherRelease(get(baseUrl_.resolved(QUrl(path)), 1024 * 1024));
    if (!isAllowedUrl(QUrl(QString::fromStdString(release.ifwRepositoryUrl)))) {
        throw std::runtime_error("launcher release contains an untrusted IFW URL");
    }
    return release;
}

std::vector<LauncherChangelogEntry>
StaticContentRepository::fetchLauncherChangelog(const std::string& language) {
    const auto path =
        QString("v1/launcher/changelog/%1.json").arg(QString::fromStdString(language));
    return JsonCodec::parseLauncherChangelog(get(baseUrl_.resolved(QUrl(path)), 4 * 1024 * 1024));
}

QByteArray StaticContentRepository::get(const QUrl& url, qsizetype maximumBytes) {
    constexpr int maximumAttempts = 3;
    QNetworkAccessManager network;
    QString lastError;
    for (int attempt = 0; attempt < maximumAttempts; ++attempt) {
        QNetworkRequest request(url);
        request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                             QNetworkRequest::ManualRedirectPolicy);
        request.setTransferTimeout(30000);
        auto* reply = network.get(request);
        reply->setReadBufferSize(maximumBytes + 1);
        QEventLoop loop;
        QByteArray data;
        bool responseTooLarge = false;
        QObject::connect(reply, &QNetworkReply::readyRead, &loop, [&] {
            data.append(reply->readAll());
            if (data.size() > maximumBytes) {
                responseTooLarge = true;
                reply->abort();
            }
        });
        QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
        loop.exec();

        const auto status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const auto error = reply->error();
        data.append(reply->readAll());
        lastError = reply->errorString();
        reply->deleteLater();
        if (responseTooLarge || data.size() > maximumBytes) {
            throw std::runtime_error("static JSON response exceeds its size limit");
        }
        if (error == QNetworkReply::NoError && status >= 200 && status < 300) {
            return data;
        }
        if (status >= 400 && status < 500) {
            break;
        }
        QThread::msleep(static_cast<unsigned long>(100 * (1 << attempt)));
    }
    throw std::runtime_error("HTTP request failed: " + lastError.toStdString());
}

bool StaticContentRepository::isAllowedUrl(const QUrl& url) const {
    const bool secure = url.scheme() == "https";
    const bool localDevelopment =
        (url.host() == "127.0.0.1" || url.host() == "localhost") && url.scheme() == "http";
    return url.isValid() && (secure || localDevelopment) &&
           url.host().compare(allowedHost_, Qt::CaseInsensitive) == 0;
}

QString StaticContentRepository::platformName() {
#if defined(Q_OS_WIN)
    return "windows";
#elif defined(Q_OS_MACOS)
    return "macos";
#else
    return "linux";
#endif
}

QString StaticContentRepository::architectureName() {
#if defined(Q_PROCESSOR_ARM_64)
    return "arm64";
#else
    return "x86_64";
#endif
}

JsonStateRepository::JsonStateRepository(QString dataDirectory)
    : dataDirectory_(std::move(dataDirectory)) {
    QDir().mkpath(dataDirectory_);
}

JsonStateRepository::JsonStateRepository()
    : JsonStateRepository(QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation)) {}

std::vector<InstalledGame> JsonStateRepository::loadAll() {
    const auto path = QDir(dataDirectory_).filePath("installed-games.json");
    if (!QFileInfo::exists(path)) {
        return {};
    }
    return JsonCodec::parseInstalledGames(readJson(path));
}

OperationResult JsonStateRepository::save(const InstalledGame& game) {
    auto games = loadAll();
    const auto iterator = std::find_if(games.begin(), games.end(), [&game](const auto& value) {
        return value.gameId == game.gameId;
    });
    if (iterator == games.end()) {
        games.push_back(game);
    } else {
        *iterator = game;
    }
    return writeJson(
        QDir(dataDirectory_).filePath("installed-games.json"),
        QJsonObject{{"schemaVersion", 1}, {"games", JsonCodec::serializeInstalledGames(games)}});
}

OperationResult JsonStateRepository::remove(const GameId& gameId) {
    auto games = loadAll();
    std::erase_if(games, [&gameId](const auto& value) { return value.gameId == gameId; });
    return writeJson(
        QDir(dataDirectory_).filePath("installed-games.json"),
        QJsonObject{{"schemaVersion", 1}, {"games", JsonCodec::serializeInstalledGames(games)}});
}

LauncherSettings JsonStateRepository::load() {
    LauncherSettings defaults;
    defaults.installRoot =
        QDir(QStandardPaths::writableLocation(QStandardPaths::GenericDataLocation))
            .filePath("PandD_org/Games")
            .toStdString();
    const auto locale = QLocale::system().name();
    defaults.language = locale.startsWith("en") ? "en-US" : "ja-JP";
    const auto path = QDir(dataDirectory_).filePath("settings.json");
    return QFileInfo::exists(path) ? JsonCodec::parseSettings(readJson(path), defaults) : defaults;
}

OperationResult JsonStateRepository::save(const LauncherSettings& settings) {
    return writeJson(QDir(dataDirectory_).filePath("settings.json"),
                     JsonCodec::serializeSettings(settings));
}

OperationResult JsonStateRepository::writeJson(const QString& path, const QJsonObject& object) {
    QSaveFile file(path);
    if (!file.open(QIODevice::WriteOnly)) {
        return storageFailure(file.errorString());
    }
    if (file.write(QJsonDocument(object).toJson(QJsonDocument::Indented)) < 0 || !file.commit()) {
        return storageFailure(file.errorString());
    }
    return OperationResult::success();
}

QJsonObject JsonStateRepository::readJson(const QString& path) const {
    QFile file(path);
    if (!file.exists()) {
        return {};
    }
    if (!file.open(QIODevice::ReadOnly)) {
        throw std::runtime_error("cannot read state file: " + file.errorString().toStdString());
    }
    const auto document = QJsonDocument::fromJson(file.readAll());
    if (!document.isObject()) {
        throw std::runtime_error("state file contains invalid JSON");
    }
    return document.object();
}

} // namespace pandd
