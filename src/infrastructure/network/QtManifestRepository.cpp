#include "QtManifestRepository.h"
#include <QNetworkRequest>
#include <QNetworkReply>
#include <QJsonDocument>
#include <QJsonArray>
#include <QJsonObject>

QtManifestRepository::QtManifestRepository(QObject *parent)
    : QObject(parent), m_manager(new QNetworkAccessManager(this)) {

}

void QtManifestRepository::fetchManifest(
    const std::string &manifestUrl,
    ManifestCallback  onSuccess,
    ErrorCallback     onError
) {
    QNetworkRequest request(QUrl(QString::fromStdString(manifestUrl)));
    QNetworkReply *reply = m_manager->get(request);

    connect(reply, &QNetworkReply::finished, this,
        [this, reply, onSuccess, onError]() {
            if (reply->error() != QNetworkReply::NoError) {
                onError(reply->errorString().toStdString());
                reply->deleteLater();
                return;
            }

            try {
                GameManifest manifest = parseManifest(reply->readAll());
                onSuccess(manifest);
            } catch (const std::exception &e) {
                onError(std::string("Json parse error: ") + e.what());
            }

            reply->deleteLater();
        });
}

GameManifest QtManifestRepository::parseManifest(const QByteArray &data) {
    QJsonDocument doc = QJsonDocument::fromJson(data);
    if (doc.isNull()) {
        throw std::runtime_error("Invalid Json error");
    }

    QJsonObject root = doc.object();
    GameManifest manifest;
    manifest.gameId = root["gameId"].toString().toStdString();
    manifest.version = root["version"].toString().toStdString();

    for (const QJsonValue &val : root["files"].toArray()) {
        QJsonObject obj = val.toObject();
        GameFile file;
        file.path     = obj["path"].toString().toStdString();
        file.url      = obj["url"].toString().toStdString();
        file.size     = obj["size"].toVariant().toLongLong();
        file.checksum = obj["checksum"].toString().toStdString();
        manifest.files.push_back(file);
    }

    return manifest;
}