#include "infrastructure/JsonCodec.h"

#include <QJsonParseError>
#include <QSet>
#include <QStringList>

#include <algorithm>
#include <cmath>
#include <initializer_list>
#include <stdexcept>

namespace pandd {
namespace {

/** @brief JSON objectを必須条件付きで読み込む */
QJsonObject parseObject(const QByteArray& data) {
    QJsonParseError error;
    const auto document = QJsonDocument::fromJson(data, &error);
    if (error.error != QJsonParseError::NoError || !document.isObject()) {
        throw std::runtime_error("invalid JSON object: " + error.errorString().toStdString());
    }
    return document.object();
}

/** @brief additionalProperties=falseの契約をQt JSON上でも強制する */
void requireExactKeys(const QJsonObject& object, std::initializer_list<const char*> keys) {
    QSet<QString> expected;
    for (const auto* key : keys) {
        expected.insert(QLatin1String(key));
    }
    const auto actualKeys = object.keys();
    const QSet<QString> actual(actualKeys.begin(), actualKeys.end());
    if (actual != expected) {
        throw std::runtime_error("JSON object keys do not match the contract");
    }
}

/** @brief 文字列フィールドを必須で読み込む */
std::string requiredString(const QJsonObject& object, const char* key) {
    const auto value = object.value(QLatin1String(key));
    if (!value.isString() || value.toString().isEmpty()) {
        throw std::runtime_error(std::string("missing string: ") + key);
    }
    return value.toString().toStdString();
}

/** @brief 非負整数フィールドを必須で読み込む */
std::uint64_t requiredSize(const QJsonObject& object, const char* key) {
    const auto value = object.value(QLatin1String(key));
    const auto number = value.toDouble(-1.0);
    if (!value.isDouble() || number < 0.0 || number > 9007199254740991.0 ||
        std::floor(number) != number) {
        throw std::runtime_error(std::string("invalid non-negative integer: ") + key);
    }
    return static_cast<std::uint64_t>(number);
}

/** @brief 真偽値フィールドを暗黙変換せず読み込む */
bool requiredBoolean(const QJsonObject& object, const char* key) {
    const auto value = object.value(QLatin1String(key));
    if (!value.isBool()) {
        throw std::runtime_error(std::string("invalid boolean: ") + key);
    }
    return value.toBool();
}

} // namespace

std::vector<GameCatalogEntry> JsonCodec::parseCatalog(const QByteArray& data) {
    // root schemaと必須field集合を検証
    const auto root = parseObject(data);
    requireExactKeys(root, {"schemaVersion", "generatedAt", "games"});
    if (root.value("schemaVersion").toInt() != 1 || !root.value("games").isArray()) {
        throw std::runtime_error("unsupported catalog schema");
    }
    requiredString(root, "generatedAt");
    // 各gameの表示情報とhero注視点をdomain型へ変換
    std::vector<GameCatalogEntry> result;
    for (const auto& value : root.value("games").toArray()) {
        const auto game = value.toObject();
        requireExactKeys(game, {"gameId", "name", "summary", "heroUrl", "heroFocalPoint",
                                "thumbnailUrl", "latestReleaseUrl"});
        const auto focalPoint = game.value("heroFocalPoint").toObject();
        requireExactKeys(focalPoint, {"x", "y"});
        if (!focalPoint.value("x").isDouble() || !focalPoint.value("y").isDouble()) {
            throw std::runtime_error("catalog contains a non-numeric hero focal point");
        }
        const auto focalX = focalPoint.value("x").toDouble(-1.0);
        const auto focalY = focalPoint.value("y").toDouble(-1.0);
        if (focalX < 0.0 || focalX > 1.0 || focalY < 0.0 || focalY > 1.0) {
            throw std::runtime_error("catalog contains an invalid hero focal point");
        }
        result.push_back({GameId(requiredString(game, "gameId")), requiredString(game, "name"),
                          requiredString(game, "summary"), requiredString(game, "heroUrl"),
                          requiredString(game, "thumbnailUrl"),
                          requiredString(game, "latestReleaseUrl"), focalX, focalY});
    }
    return result;
}

std::vector<Announcement> JsonCodec::parseAnnouncements(const QByteArray& data) {
    // schema検証後に許可categoryだけをdomain型へ変換
    const auto root = parseObject(data);
    requireExactKeys(root, {"schemaVersion", "generatedAt", "announcements"});
    if (root.value("schemaVersion").toInt() != 1 || !root.value("announcements").isArray()) {
        throw std::runtime_error("unsupported announcement schema");
    }
    requiredString(root, "generatedAt");
    std::vector<Announcement> result;
    for (const auto& value : root.value("announcements").toArray()) {
        const auto item = value.toObject();
        requireExactKeys(item, {"id", "category", "title", "publishedAt", "body"});
        const auto category = requiredString(item, "category");
        if (category != "event" && category != "announcement" && category != "news") {
            throw std::runtime_error("announcement category is unsupported");
        }
        result.push_back({requiredString(item, "id"), category, requiredString(item, "title"),
                          requiredString(item, "publishedAt"), requiredString(item, "body")});
    }
    return result;
}

GameRelease JsonCodec::parseRelease(const QByteArray& data) {
    // 署名対象schemaのfield集合を厳密に検証
    const auto root = parseObject(data);
    requireExactKeys(root, {"schemaVersion", "gameId", "version", "platform", "arch",
                            "minimumLauncherVersion", "engine", "entrypoint", "workingDirectory",
                            "arguments", "saveDirectoryName", "totalSize", "files", "publishedAt",
                            "signature"});
    // release直下のscalar値をdomain型へ変換
    GameRelease release;
    release.schemaVersion = root.value("schemaVersion").toInt(-1);
    release.gameId = GameId(requiredString(root, "gameId"));
    release.version = SemanticVersion(requiredString(root, "version"));
    release.platform = requiredString(root, "platform");
    release.architecture = requiredString(root, "arch");
    release.minimumLauncherVersion =
        SemanticVersion(requiredString(root, "minimumLauncherVersion"));
    release.engine = requiredString(root, "engine");
    release.entrypoint = requiredString(root, "entrypoint");
    release.workingDirectory = requiredString(root, "workingDirectory");
    release.saveDirectoryName = requiredString(root, "saveDirectoryName");
    release.totalSize = requiredSize(root, "totalSize");
    release.publishedAt = requiredString(root, "publishedAt");
    release.signature = requiredString(root, "signature");

    if (!root.value("arguments").isArray() || !root.value("files").isArray()) {
        throw std::runtime_error("missing release arrays");
    }
    // 起動引数を文字列だけに限定
    for (const auto& value : root.value("arguments").toArray()) {
        if (!value.isString()) {
            throw std::runtime_error("invalid argument");
        }
        release.arguments.push_back(value.toString().toStdString());
    }
    // fileと配下chunkを階層どおりに変換
    for (const auto& value : root.value("files").toArray()) {
        const auto item = value.toObject();
        requireExactKeys(item, {"path", "size", "sha256", "executable", "chunks"});
        GameFile file;
        file.path = requiredString(item, "path");
        file.size = requiredSize(item, "size");
        file.sha256 = requiredString(item, "sha256");
        file.executable = requiredBoolean(item, "executable");
        if (!item.value("chunks").isArray()) {
            throw std::runtime_error("missing chunks");
        }
        for (const auto& chunkValue : item.value("chunks").toArray()) {
            const auto chunk = chunkValue.toObject();
            requireExactKeys(chunk, {"offset", "size", "sha256", "url"});
            file.chunks.push_back({requiredSize(chunk, "offset"), requiredSize(chunk, "size"),
                                   requiredString(chunk, "sha256"), requiredString(chunk, "url")});
        }
        release.files.push_back(std::move(file));
    }
    return release;
}

LauncherRelease JsonCodec::parseLauncherRelease(const QByteArray& data) {
    const auto root = parseObject(data);
    requireExactKeys(root, {"schemaVersion", "version", "mandatory", "title", "publishedAt",
                            "ifwRepositoryUrl"});
    LauncherRelease release;
    release.schemaVersion = root.value("schemaVersion").toInt(-1);
    if (release.schemaVersion != 1 || !root.value("mandatory").isBool()) {
        throw std::runtime_error("unsupported launcher release schema");
    }
    release.version = SemanticVersion(requiredString(root, "version"));
    release.mandatory = root.value("mandatory").toBool();
    release.title = requiredString(root, "title");
    release.publishedAt = requiredString(root, "publishedAt");
    release.ifwRepositoryUrl = requiredString(root, "ifwRepositoryUrl");
    return release;
}

std::vector<LauncherChangelogEntry> JsonCodec::parseLauncherChangelog(const QByteArray& data) {
    // release単位の更新履歴を検証してdomain型へ変換
    const auto root = parseObject(data);
    requireExactKeys(root, {"schemaVersion", "releases"});
    if (root.value("schemaVersion").toInt() != 1 || !root.value("releases").isArray()) {
        throw std::runtime_error("unsupported launcher changelog schema");
    }
    std::vector<LauncherChangelogEntry> result;
    for (const auto& value : root.value("releases").toArray()) {
        const auto item = value.toObject();
        requireExactKeys(item, {"version", "title", "publishedAt", "changes"});
        if (!item.value("changes").isArray()) {
            throw std::runtime_error("launcher changelog changes are missing");
        }
        LauncherChangelogEntry entry;
        entry.version = SemanticVersion(requiredString(item, "version"));
        entry.title = requiredString(item, "title");
        entry.publishedAt = requiredString(item, "publishedAt");
        for (const auto& change : item.value("changes").toArray()) {
            if (!change.isString() || change.toString().isEmpty()) {
                throw std::runtime_error("launcher changelog contains an invalid change");
            }
            entry.changes.push_back(change.toString().toStdString());
        }
        result.push_back(std::move(entry));
    }
    return result;
}

QByteArray JsonCodec::canonicalReleasePayload(const QByteArray& data) {
    // 署名fieldだけを除外して署名検証対象を生成
    auto root = parseObject(data);
    root.remove("signature");
    return canonicalize(root);
}

QJsonArray JsonCodec::serializeInstalledGames(const std::vector<InstalledGame>& games) {
    // 永続化対象fieldだけをJSON arrayへ変換
    QJsonArray array;
    for (const auto& game : games) {
        array.append(
            QJsonObject{{"gameId", QString::fromStdString(game.gameId.value())},
                        {"version", QString::fromStdString(game.version.value())},
                        {"gameRoot", QString::fromStdString(game.gameRoot)},
                        {"entrypoint", QString::fromStdString(game.entrypoint)},
                        {"workingDirectory", QString::fromStdString(game.workingDirectory)},
                        {"saveDirectoryName", QString::fromStdString(game.saveDirectoryName)},
                        {"installedSize", static_cast<double>(game.installedSize)}});
    }
    return array;
}

std::vector<InstalledGame> JsonCodec::parseInstalledGames(const QJsonObject& document) {
    // 保存schemaを検証して導入記録を復元
    requireExactKeys(document, {"schemaVersion", "games"});
    if (document.value("schemaVersion").toInt(-1) != 1 || !document.value("games").isArray()) {
        throw std::runtime_error("unsupported installed-game state schema");
    }
    std::vector<InstalledGame> games;
    for (const auto& value : document.value("games").toArray()) {
        const auto object = value.toObject();
        requireExactKeys(object, {"gameId", "version", "gameRoot", "entrypoint", "workingDirectory",
                                  "saveDirectoryName", "installedSize"});
        games.push_back(
            {GameId(requiredString(object, "gameId")),
             SemanticVersion(requiredString(object, "version")), requiredString(object, "gameRoot"),
             requiredString(object, "entrypoint"), requiredString(object, "workingDirectory"),
             requiredString(object, "saveDirectoryName"), requiredSize(object, "installedSize")});
    }
    return games;
}

QJsonObject JsonCodec::serializeSettings(const LauncherSettings& settings) {
    // 全設定値を現行schemaへ直列化
    return {
        {"schemaVersion", 2},
        {"language", QString::fromStdString(settings.language)},
        {"installRoot", QString::fromStdString(settings.installRoot)},
        {"startOnLogin", settings.startOnLogin},
        {"startMinimized", settings.startMinimized},
        {"closeToTray", settings.closeToTray},
        {"showAfterGameExit", settings.showAfterGameExit},
        {"darkTheme", settings.darkTheme},
        {"checkLauncherUpdateOnStart", settings.checkLauncherUpdateOnStart},
        {"autoApplyLauncherUpdate", settings.autoApplyLauncherUpdate},
        {"downloadLimitBytesPerSecond", static_cast<double>(settings.downloadLimitBytesPerSecond)},
        {"checkGameUpdateBeforeLaunch", settings.checkGameUpdateBeforeLaunch},
        {"continueOtherDownloadsWhilePlaying", settings.continueOtherDownloadsWhilePlaying},
        {"notifyDownloadComplete", settings.notifyDownloadComplete},
        {"notifyInstallComplete", settings.notifyInstallComplete},
        {"notifyErrors", settings.notifyErrors},
        {"notifyLauncherUpdate", settings.notifyLauncherUpdate},
        {"lastLauncherUpdateCheck", QString::fromStdString(settings.lastLauncherUpdateCheck)}};
}

LauncherSettings JsonCodec::parseSettings(const QJsonObject& object, LauncherSettings settings) {
    // 保存objectが現行schemaと完全一致することを検証
    requireExactKeys(object,
                     {"schemaVersion", "language", "installRoot", "startOnLogin", "startMinimized",
                      "closeToTray", "showAfterGameExit", "darkTheme", "checkLauncherUpdateOnStart",
                      "autoApplyLauncherUpdate", "downloadLimitBytesPerSecond",
                      "checkGameUpdateBeforeLaunch", "continueOtherDownloadsWhilePlaying",
                      "notifyDownloadComplete", "notifyInstallComplete", "notifyErrors",
                      "notifyLauncherUpdate", "lastLauncherUpdateCheck"});
    if (object.value("schemaVersion").toInt(-1) != 2) {
        throw std::runtime_error("unsupported launcher settings schema");
    }
    settings.language = requiredString(object, "language");
    settings.installRoot = requiredString(object, "installRoot");
    settings.startOnLogin = requiredBoolean(object, "startOnLogin");
    settings.startMinimized = requiredBoolean(object, "startMinimized");
    settings.closeToTray = requiredBoolean(object, "closeToTray");
    settings.showAfterGameExit = requiredBoolean(object, "showAfterGameExit");
    settings.darkTheme = requiredBoolean(object, "darkTheme");
    settings.checkLauncherUpdateOnStart = requiredBoolean(object, "checkLauncherUpdateOnStart");
    settings.autoApplyLauncherUpdate = requiredBoolean(object, "autoApplyLauncherUpdate");
    settings.downloadLimitBytesPerSecond = requiredSize(object, "downloadLimitBytesPerSecond");
    settings.checkGameUpdateBeforeLaunch = requiredBoolean(object, "checkGameUpdateBeforeLaunch");
    settings.continueOtherDownloadsWhilePlaying =
        requiredBoolean(object, "continueOtherDownloadsWhilePlaying");
    settings.notifyDownloadComplete = requiredBoolean(object, "notifyDownloadComplete");
    settings.notifyInstallComplete = requiredBoolean(object, "notifyInstallComplete");
    settings.notifyErrors = requiredBoolean(object, "notifyErrors");
    settings.notifyLauncherUpdate = requiredBoolean(object, "notifyLauncherUpdate");
    const auto checkedAt = object.value("lastLauncherUpdateCheck");
    if (!checkedAt.isString()) {
        throw std::runtime_error("invalid string: lastLauncherUpdateCheck");
    }
    settings.lastLauncherUpdateCheck = checkedAt.toString().toStdString();
    return settings;
}

QByteArray JsonCodec::canonicalize(const QJsonValue& value) {
    // objectはkey順へ並べて再帰的に符号化
    if (value.isObject()) {
        const auto object = value.toObject();
        auto keys = object.keys();
        std::sort(keys.begin(), keys.end());
        QByteArray result("{");
        bool first = true;
        for (const auto& key : keys) {
            if (!first) {
                result.append(',');
            }
            first = false;
            result.append(
                QJsonDocument(QJsonArray{key}).toJson(QJsonDocument::Compact).mid(1).chopped(1));
            result.append(':');
            result.append(canonicalize(object.value(key)));
        }
        return result.append('}');
    }
    // arrayは入力順を保持して各要素を再帰的に符号化
    if (value.isArray()) {
        QByteArray result("[");
        bool first = true;
        for (const auto& item : value.toArray()) {
            if (!first) {
                result.append(',');
            }
            first = false;
            result.append(canonicalize(item));
        }
        return result.append(']');
    }
    // scalarはQtのcompact JSON表現を再利用
    return QJsonDocument(QJsonArray{value}).toJson(QJsonDocument::Compact).mid(1).chopped(1);
}

} // namespace pandd
