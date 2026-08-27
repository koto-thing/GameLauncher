#include "presentation/live2d/Live2DModelData.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QImageReader>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>

namespace pandd {
namespace {
constexpr qint64 maxJsonBytes = 4 * 1024 * 1024;
constexpr qint64 maxFileBytes = 64 * 1024 * 1024;
constexpr qint64 maxTextureBytes = 128 * 1024 * 1024;
constexpr qint64 maxTotalBytes = 256 * 1024 * 1024;

bool readBytes(const QString& path, qint64 limit, QByteArray& bytes, QString& error) {
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly) || file.size() <= 0 || file.size() > limit) {
        error = QStringLiteral("Cannot read model asset or file exceeds size limit: %1").arg(path);
        return false;
    }
    bytes = file.read(limit + 1);
    if (bytes.size() != file.size() || bytes.size() > limit) {
        error = QStringLiteral("Incomplete or oversized model asset: %1").arg(path);
        return false;
    }
    return true;
}
} // namespace

Live2DModelData prepareLive2DModel(const Live2DAsset& asset, const std::atomic_bool& canceled) {
    // 信頼済みroot内のmodel3.jsonだけを読込対象とする
    Live2DModelData data;
    data.modelPath = asset.modelPath;
    data.idleGroup = asset.idleGroup;
    const QFileInfo modelFile(asset.modelPath);
    if ((!asset.modelPath.startsWith(":/") && !modelFile.isAbsolute()) ||
        !asset.modelPath.endsWith(".model3.json") || !modelFile.isFile()) {
        data.error = QStringLiteral("Model must be an existing absolute model3.json path: %1")
                         .arg(asset.modelPath);
        return data;
    }
    if (!readBytes(asset.modelPath, maxJsonBytes, data.modelJson, data.error)) {
        return data;
    }
    // 必須のMocとtexture参照を持つCubism 3形式だけを受理する
    const auto document = QJsonDocument::fromJson(data.modelJson);
    const auto references = document.object().value("FileReferences").toObject();
    const auto textureFiles = references.value("Textures").toArray();
    if (!document.isObject() || document.object().value("Version").toInt() != 3 ||
        references.value("Moc").toString().isEmpty() || textureFiles.isEmpty() ||
        textureFiles.size() > 64) {
        data.error = QStringLiteral("Invalid model3.json Version, Moc or Textures");
        return data;
    }
    const bool resource = asset.modelPath.startsWith(":/");
    const QDir root(resource ? modelFile.path() : modelFile.dir().canonicalPath());
    // 全参照をモデルroot内へ正規化してTraversalと絶対pathを拒否する
    auto resolve = [&](const QJsonValue& value) -> QString {
        const auto path = value.toString();
        const auto parts = path.split('/');
        if (path.isEmpty() || QDir::isAbsolutePath(path) || path.contains(':') ||
            path.contains('\\') || path.contains(QChar::Null) || parts.contains("..") ||
            parts.contains(".") || parts.contains("")) {
            data.error = QStringLiteral("Model asset must use a safe relative path: %1").arg(path);
            return {};
        }
        const QFileInfo file(root.filePath(path));
        const auto resolved = resource ? file.filePath() : file.canonicalFilePath();
        const auto relative = root.relativeFilePath(resolved);
        if (!file.isFile() || resolved.isEmpty() || relative == ".." ||
            relative.startsWith("../") || QDir::isAbsolutePath(relative)) {
            data.error =
                QStringLiteral("Missing asset or reference outside model directory: %1").arg(path);
            return {};
        }
        return resolved;
    };
    // 個別上限に加えてモデル全体の展開後byte数も追跡する
    qint64 totalBytes = data.modelJson.size();
    auto readReference = [&](const QJsonValue& reference, QByteArray& bytes, bool json) {
        if (canceled.load()) {
            return false;
        }
        const auto path = resolve(reference);
        if (path.isEmpty() ||
            !readBytes(path, json ? maxJsonBytes : maxFileBytes, bytes, data.error)) {
            return false;
        }
        totalBytes += bytes.size();
        if (totalBytes > maxTotalBytes || (json && !QJsonDocument::fromJson(bytes).isObject())) {
            data.error = QStringLiteral("Invalid JSON or oversized model data: %1").arg(path);
            return false;
        }
        return true;
    };
    if (!readReference(references.value("Moc"), data.moc, false)) {
        return data;
    }
    if (references.contains("Physics") &&
        !readReference(references.value("Physics"), data.physics, true)) {
        return data;
    }
    if (references.contains("Pose") && !readReference(references.value("Pose"), data.pose, true)) {
        return data;
    }
    // 登録されたidle groupだけを上限付きで事前読込する
    if (!asset.idleGroup.isEmpty()) {
        const auto motions =
            references.value("Motions").toObject().value(asset.idleGroup).toArray();
        if (motions.isEmpty() || motions.size() > 128) {
            data.error = QStringLiteral("Missing, empty or oversized idle motion group: %1")
                             .arg(asset.idleGroup);
            return data;
        }
        for (const auto& motion : motions) {
            QByteArray bytes;
            if (!readReference(motion.toObject().value("File"), bytes, true)) {
                return data;
            }
            data.motions.append(std::move(bytes));
        }
    }
    // textureをGPUへ渡す前に寸法と展開後容量を検証して復号する
    for (const auto& reference : textureFiles) {
        if (canceled.load()) {
            return data;
        }
        const auto path = resolve(reference);
        if (path.isEmpty()) {
            return data;
        }
        QImageReader reader(path);
        const auto size = reader.size();
        const qint64 decodedBytes = qint64(size.width()) * size.height() * 4;
        totalBytes += decodedBytes;
        if (QFileInfo(path).size() > maxFileBytes || !size.isValid() ||
            decodedBytes > maxTextureBytes || totalBytes > maxTotalBytes || size.width() > 16384 ||
            size.height() > 16384) {
            data.error = QStringLiteral("Invalid or oversized texture: %1").arg(path);
            return data;
        }
        auto image = reader.read();
        if (image.isNull()) {
            data.error = QStringLiteral("Cannot decode texture: %1").arg(path);
            return data;
        }
        data.textures.append(image.convertToFormat(QImage::Format_RGBA8888_Premultiplied));
    }
    return data;
}
} // namespace pandd
