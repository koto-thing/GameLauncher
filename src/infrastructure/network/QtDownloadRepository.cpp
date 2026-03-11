#include "QtDownloadRepository.h"
#include <QNetworkRequest>
#include <QNetworkReply>
#include <QDir>
#include <QCryptographicHash>
#include <QFileInfo>

QtDownloadRepository::QtDownloadRepository(QObject *parent)
    : QObject(parent), m_manager(new QNetworkAccessManager(this)) {

}

void QtDownloadRepository::startDownload(
    const DownloadTask &task,
    ProgressCallback   onProgress,
    FinishedCallback   onFinished,
    ErrorCallback      onError
) {
    QString savePath = QString::fromStdString(task.installDir)
                            + QDir::separator()
                            + QString::fromStdString(task.file.path);

    QFileInfo fileInfo(savePath);
    QDir().mkpath(fileInfo.absolutePath());

    auto *file = new QFile(savePath);
    if (!file->open(QIODevice::WriteOnly)) {
        onError("Failed to open file for writing: " + savePath.toStdString());
        delete file;
        return;
    }

    QNetworkRequest request(QUrl(QString::fromStdString(task.file.url)));
    QNetworkReply *reply = m_manager->get(request);

    connect(reply, &QNetworkReply::readyRead, this, [reply, file]() {
        if (reply->error() == QNetworkReply::NoError) {
            file->write(reply->readAll());
        }
    });

    connect(reply, &QNetworkReply::downloadProgress, this,
        [onProgress](qint64 recv, qint64 total) {
            if (onProgress)
                onProgress(recv, total);
        });

    // 修正点: エラー発生時および完了時にリソースを確実に解放。
    connect(reply, &QNetworkReply::finished, this,
        [this, reply, file, savePath, task, onFinished, onError]() {
            file->close();
            
            if (reply->error() != QNetworkReply::NoError) {
                if (onError)
                    onError(reply->errorString().toStdString());
            } else if (!task.file.checksum.empty()) {
                if (!verifyChecksum(savePath, QString::fromStdString(task.file.checksum))) {
                    if (onError)
                        onError("Checksum verification failed: " + savePath.toStdString());
                } else {
                    if (onFinished)
                        onFinished(savePath.toStdString());
                }
            } else {
                if (onFinished)
                    onFinished(savePath.toStdString());
            }

            reply->deleteLater();
            delete file;
        });
}

bool QtDownloadRepository::verifyChecksum(const QString &filePath, const QString &checksum) {
    QStringList parts = checksum.split(":");
    if (parts.size() != 2)
        return false;

    QCryptographicHash::Algorithm algo;
    if (parts[0] == "sha256") algo = QCryptographicHash::Sha256;
    else if (parts[0] == "md5") algo = QCryptographicHash::Md5;
    else return false;

    QFile file(filePath);
    if (!file.open(QIODevice::ReadOnly))
        return false;

    QCryptographicHash hash(algo);
    if (hash.addData(&file)) {
        return hash.result().toHex() == parts[1].toLower();
    }

    return false;
}
