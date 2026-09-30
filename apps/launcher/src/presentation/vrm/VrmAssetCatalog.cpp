#include "presentation/vrm/VrmAssetCatalog.h"

#include <QDir>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QRegularExpression>

#include <cmath>

namespace pandd {
namespace {
/** @brief 配置の数値が有限かつ範囲内かを確認する */
bool validNumber(const QJsonObject& object, const QString& key, double minimum, double maximum) {
    const auto value = object.value(key);
    return value.isDouble() && std::isfinite(value.toDouble()) && value.toDouble() >= minimum &&
           value.toDouble() <= maximum;
}
} // namespace

/** @brief アプリケーションリソースからVRM登録を読み込む */
bool VrmAssetCatalog::load(QString& error) {
    QFile file(":/vrm/models.json");
    if (!file.open(QIODevice::ReadOnly)) {
        assets_.clear();
        error = QStringLiteral("Cannot read the bundled VRM registry");
        return false;
    }

    // 配布物に含まれるモデルだけを選択対象とする
    return parse(file.readAll(), QStringLiteral(":/vrm"), error);
}

/** @brief 全登録を検証して成功時だけ採用する */
bool VrmAssetCatalog::parse(const QByteArray& json, const QString& root, QString& error) {
    assets_.clear();
    error.clear();
    if (json.size() > 1024 * 1024) {
        error = QStringLiteral("VRM registry exceeds the size limit");
        return false;
    }

    // JSON構造とゲームIDを厳格に検証する
    const auto document = QJsonDocument::fromJson(json);
    if (!document.isObject() || document.object().size() != 1 ||
        !document.object().value("games").isObject()) {
        error = QStringLiteral("Invalid VRM registry: expected a games object");
        return false;
    }
    const QRegularExpression gameIdPattern(QStringLiteral("^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$"));
    const auto games = document.object().value("games").toObject();
    QHash<QString, VrmAsset> parsed;
    for (auto it = games.begin(); it != games.end(); ++it) {
        const auto object = it.value().toObject();
        const auto path = object.value("model").toString();
        const auto parts = path.split('/');
        if (!gameIdPattern.match(it.key()).hasMatch() || !it.value().isObject() ||
            object.size() != 4 || QDir::isAbsolutePath(path) || path.contains(':') ||
            path.contains('\\') || path.contains(QChar::Null) || parts.contains("..") ||
            parts.contains(".") || parts.contains("") || !path.endsWith(".vrm") ||
            !validNumber(object, "centerX", 0, 1) || !validNumber(object, "centerY", 0, 1) ||
            !validNumber(object, "scale", 0.1, 4)) {
            error = QStringLiteral("Invalid VRM background registration: %1").arg(it.key());
            return false;
        }
        parsed.insert(it.key(), {QDir(root).filePath(path),
                                 static_cast<float>(object.value("centerX").toDouble()),
                                 static_cast<float>(object.value("centerY").toDouble()),
                                 static_cast<float>(object.value("scale").toDouble())});
    }

    // 不正な登録があれば一部だけを残さない
    assets_ = std::move(parsed);
    return true;
}

/** @brief 選択ゲームに対応するモデルを返す */
std::optional<VrmAsset> VrmAssetCatalog::find(const QString& gameId) const {
    const auto it = assets_.constFind(gameId);
    return it == assets_.cend() ? std::nullopt : std::optional<VrmAsset>(*it);
}
} // namespace pandd
