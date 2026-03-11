#ifndef GAMELAUNCHER_QTDOWNLOADREPOSITORY_H
#define GAMELAUNCHER_QTDOWNLOADREPOSITORY_H

#include "../../domain/repositories/IDownloadRepository.h"
#include <QObject>
#include <QNetworkAccessManager>

class QtDownloadRepository : public QObject, public IDownloadRepository {
    Q_OBJECT
public:
    explicit QtDownloadRepository(QObject *parent = nullptr);

    void startDownload(
        const DownloadTask &task,
        ProgressCallback   onProgress,
        FinishedCallback   onFinished,
        ErrorCallback      onError
    ) override;

private:
    bool verifyChecksum(const QString &filePath, const QString &checksum);

    QNetworkAccessManager *m_manager;
};

#endif //GAMELAUNCHER_QTDOWNLOADREPOSITORY_H