#include "presentation/live2d/Live2DAssetCatalog.h"

#include <QDir>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QRegularExpression>

#include <cmath>

namespace pandd {
namespace {
bool validNumber(const QJsonObject& object, const QString& key, double minimum, double maximum) {
    const auto value = object.value(key);
    return value.isDouble() && std::isfinite(value.toDouble()) && value.toDouble() >= minimum &&
           value.toDouble() <= maximum;
}
} // namespace

bool Live2DAssetCatalog::load(QString& error) {
    // 本番で差し替え不能なApplication Resourceだけを登録元とする
    QFile file(":/live2d/models.json");
    if (!file.open(QIODevice::ReadOnly)) {
        assets_.clear();
        error = QStringLiteral("Cannot read the bundled Live2D registry");
        return false;
    }
    return parse(file.readAll(), QStringLiteral(":/live2d"), error);
}

bool Live2DAssetCatalog::parse(const QByteArray& json, const QString& root, QString& error) {
    // 以前の登録を残さず入力全体を一時領域で検証する
    assets_.clear();
    error.clear();
    if (json.size() > qsizetype{1024} * 1024) {
        error = QStringLiteral("Live2D registry exceeds the size limit");
        return false;
    }
    const auto document = QJsonDocument::fromJson(json);
    if (!document.isObject() || document.object().size() != 1 ||
        !document.object().value("games").isObject()) {
        error = QStringLiteral("Invalid Live2D registry: expected a games object");
        return false;
    }
    // game IDとモデル相対pathへ公開入力用の厳格な形式制約を適用する
    const auto games = document.object().value("games").toObject();
    const QRegularExpression gameIdPattern(QStringLiteral("^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$"));
    QHash<QString, Live2DAsset> parsed;
    for (auto it = games.begin(); it != games.end(); ++it) {
        const auto object = it.value().toObject();
        const auto path = object.value("model").toString();
        const auto idleGroup = object.value("idleGroup").toString();
        const auto parts = path.split('/');
        if (!gameIdPattern.match(it.key()).hasMatch() || !it.value().isObject() ||
            object.size() != 5 || path.isEmpty() || QDir::isAbsolutePath(path) ||
            path.contains(':') || path.contains('\\') || path.contains(QChar::Null) ||
            parts.contains("..") || parts.contains(".") || parts.contains("") ||
            !path.endsWith(".model3.json") || !object.value("idleGroup").isString() ||
            idleGroup.size() > 100 || idleGroup.contains(QChar::Null) ||
            !validNumber(object, "centerX", 0, 1) || !validNumber(object, "centerY", 0, 1) ||
            !validNumber(object, "scale", 0.1, 4)) {
            error = QStringLiteral("Invalid Live2D background registration: %1").arg(it.key());
            return false;
        }
        parsed.insert(it.key(), {QDir(root).filePath(path), idleGroup,
                                 static_cast<float>(object.value("centerX").toDouble()),
                                 static_cast<float>(object.value("centerY").toDouble()),
                                 static_cast<float>(object.value("scale").toDouble())});
    }
    // 全項目の検証成功後だけ新しい登録へ切り替える
    assets_ = std::move(parsed);
    return true;
}

std::optional<Live2DAsset> Live2DAssetCatalog::find(const QString& gameId) const {
    const auto it = assets_.constFind(gameId);
    return it == assets_.cend() ? std::nullopt : std::optional<Live2DAsset>(*it);
}
} // namespace pandd
