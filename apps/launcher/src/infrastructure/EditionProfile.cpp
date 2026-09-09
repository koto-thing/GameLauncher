#include "infrastructure/EditionProfile.h"

#include "infrastructure/JsonCodec.h"
#include "infrastructure/QtRepositories.h"

#include <QCoreApplication>
#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QRegularExpression>

#include <stdexcept>

namespace pandd {
namespace {
EditionProfile profile;

/** @brief サイズを制限して必須ローカルファイルを読む */
QByteArray readFile(const QString& path) {
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly) || file.size() > 32 * 1024 * 1024) {
        throw std::runtime_error("Distribution media file is missing or too large");
    }
    return file.readAll();
}
} // namespace

/** @brief ランチャー更新から独立した配布情報を初期化する */
void EditionProfile::initialize() {
    profile = EditionProfile();
    profile.root_ = QDir(QCoreApplication::applicationDirPath()).absoluteFilePath("../edition");
    const auto args = QCoreApplication::arguments();
    const auto index = args.indexOf("--edition");
    if (!QFileInfo::exists(profile.root_)) {
        if (index >= 0) {
            throw std::runtime_error("Required distribution profile is missing");
        }
        return;
    }

    const auto bytes = readFile(QDir(profile.root_).filePath("edition.json"));
    OpenSslEd25519Verifier profileVerifier{QByteArray(PANDD_MANIFEST_PUBLIC_KEY_BASE64)};
    if (!profileVerifier.verify(bytes, readFile(QDir(profile.root_).filePath("edition.sig")))) {
        throw std::runtime_error("Distribution profile signature is invalid");
    }
    profile.digest_ = QCryptographicHash::hash(bytes, QCryptographicHash::Sha256);
    profile.document_ = QJsonDocument::fromJson(bytes).object();
    profile.id_ = profile.document_["id"].toString();
    if (profile.document_["schemaVersion"].toInt() != 1 ||
        !QRegularExpression("^[a-z0-9][a-z0-9-]{2,63}$").match(profile.id_).hasMatch() ||
        profile.document_["name"].toString().isEmpty() ||
        !QRegularExpression("^#[0-9a-fA-F]{6}$").match(profile.accent()).hasMatch() ||
        profile.document_["games"].toArray().isEmpty() ||
        (index >= 0 && args.value(index + 1) != profile.id_)) {
        throw std::runtime_error("Invalid distribution profile");
    }

    // 配布情報に記録された全ファイルを検証し欠損を通常版へ切り替えない
    const auto files = profile.document_["files"].toObject();
    for (auto it = files.begin(); it != files.end(); ++it) {
        if (!QRegularExpression("^[a-zA-Z0-9_.-]+$").match(it.key()).hasMatch() ||
            QCryptographicHash::hash(readFile(QDir(profile.root_).filePath(it.key())),
                                     QCryptographicHash::Sha256)
                    .toHex() != it.value().toString().toLatin1()) {
            throw std::runtime_error("Distribution profile checksum mismatch");
        }
    }
    profile.asset("logo.png");
    profile.asset("background.png");
    for (const auto& game : profile.document_["games"].toArray()) {
        profile.bundledRelease(GameId(game.toString().toStdString()));
    }
    QCoreApplication::setApplicationName("GameLauncher-" + profile.id_);
}

/** @brief 不変の配布情報を各層へ公開する */
const EditionProfile& EditionProfile::current() { return profile; }

/** @brief Application層へ媒体の正規ゲームdirectoryを返す */
std::string EditionProfile::mediaSource(const GameId& gameId, const std::string& media) const {
    return mediaGameDirectory(gameId, QString::fromStdString(media)).toStdString();
}

/** @brief 記録済みの画像だけを返す */
QString EditionProfile::asset(const QString& name) const {
    if (!document_["files"].toObject().contains(name)) {
        throw std::runtime_error("Unlisted distribution asset");
    }
    return QDir(root_).filePath(name);
}

/** @brief 固定収録リストを照合する */
bool EditionProfile::allows(const GameId& gameId) const {
    return !enabled() ||
           document_["games"].toArray().contains(QString::fromStdString(gameId.value()));
}

/** @brief 配信と同じ署名・構造検証を同梱manifestへ適用する */
GameRelease EditionProfile::bundledRelease(const GameId& gameId) const {
    if (!enabled() || !allows(gameId)) {
        throw std::runtime_error("Game is not included in this edition");
    }
    const auto data =
        readFile(asset("release-" + QString::fromStdString(gameId.value()) + ".json"));
    const auto release = JsonCodec::parseRelease(data);
    OpenSslEd25519Verifier verifier{QByteArray(PANDD_MANIFEST_PUBLIC_KEY_BASE64)};
    ManifestValidator validator({QUrl(PANDD_DISTRIBUTION_BASE_URL).host().toStdString()});
    if (release.gameId != gameId || release.platform != "windows" ||
        release.architecture != "x86_64" ||
        !verifier.verify(JsonCodec::canonicalReleasePayload(data),
                         QByteArray::fromStdString(release.signature)) ||
        !validator.validate(release).ok) {
        throw std::runtime_error("Invalid bundled release signature or platform");
    }
    return release;
}

/** @brief 別ビルドの媒体や対象外ゲームからの取り込みを拒否する */
QString EditionProfile::mediaGameDirectory(const GameId& gameId, const QString& media) const {
    if (!enabled() || !allows(gameId) ||
        QCryptographicHash::hash(readFile(QDir(media).filePath("edition/edition.json")),
                                 QCryptographicHash::Sha256) != digest_) {
        throw std::runtime_error("Select the media folder for this distribution build");
    }
    return QDir(media).absoluteFilePath("games/" + QString::fromStdString(gameId.value()));
}

/** @brief オフラインで全収録ゲームと同梱画像を表示する */
std::vector<GameCatalogEntry> EditionProfile::fetchCatalog(const std::string& language) {
    Q_UNUSED(language)
    auto entries = JsonCodec::parseCatalog(readFile(asset("catalog.json")));
    for (auto& entry : entries) {
        if (!allows(entry.gameId)) {
            throw std::runtime_error("Catalog contains an unlisted game");
        }
        entry.heroUrl =
            QUrl::fromLocalFile(asset(QString::fromStdString(entry.gameId.value()) + "-hero.png"))
                .toString()
                .toStdString();
        entry.thumbnailUrl =
            QUrl::fromLocalFile(
                asset(QString::fromStdString(entry.gameId.value()) + "-thumbnail.png"))
                .toString()
                .toStdString();
    }
    return entries;
}

/** @brief 初回オフライン起動ではネットワーク応答を待たない */
std::vector<Announcement> EditionProfile::fetchAnnouncements(const std::string& language) {
    if (QCoreApplication::arguments().contains("--install-media")) {
        return {};
    }
    try {
        StaticContentRepository remote(QUrl(PANDD_DISTRIBUTION_BASE_URL),
                                       QByteArray(PANDD_MANIFEST_PUBLIC_KEY_BASE64));
        return remote.fetchAnnouncements(language);
    } catch (const std::exception&) {
        // お知らせ配信の停止は同梱ゲームの起動を妨げない
        return {};
    }
}

} // namespace pandd
