#include "QtDownloadRepository.h"
#include <QNetworkRequest>
#include <QUrl>

QtDownloadRepository::QtDownloadRepository(QObject *parent)
    : QObject(parent), m_manager(new QNetworkAccessManager(this)) {

}

void QtDownloadRepository::startDownload(
    const DownloadTask &task,
    ProgressCallback onProgress,
    FinishedCallback onFinished,
    ErrorCallback onError
) {
    auto *file = new QFile(QString::fromStdString(task.savePath), this);
    if (!file->open(QIODevice::WriteOnly)) {
        onError("ファイルを開けませんでした: " + task.savePath);
        return;
    }

    QNetworkRequest request(QUrl(QString::fromStdString(task.url)));
    QNetworkReply *reply = m_manager->get(request);

    // 受信するデータをファイルに書き込む
    connect(reply, &QNetworkReply::readyRead, this, [reply, file]() {
        file->write(reply->readAll());
    });

    // 進捗を通知する
    connect(reply, &QNetworkReply::downloadProgress, this,
        [onProgress](qint64 recv, qint64 total) {
            onProgress(recv, total);
        });

    // 完了・エラー処理
    connect(reply, &QNetworkReply::finished, this,
        [reply, file, onFinished, onError, savePath = task.savePath]() {
            file->close();
            if (reply->error() == QNetworkReply::NoError) {
                onFinished(savePath);
            } else {
                onError(reply->errorString().toStdString());
            }

            reply->deleteLater();
            file->deleteLater();
        });
}