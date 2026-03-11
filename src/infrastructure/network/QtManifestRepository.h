#ifndef GAMELAUNCHER_QTMANIFESTREPOSITORY_H
#define GAMELAUNCHER_QTMANIFESTREPOSITORY_H

#include "../../domain/repositories/IManifestRepository.h"
#include <QObject>
#include <QNetworkAccessManager>

class QtManifestRepository : public QObject, public IManifestRepository {
    Q_OBJECT
public:
    explicit QtManifestRepository(QObject *parent = nullptr);

    void fetchManifest(
        const std::string &manifestUrl,
        ManifestCallback  onSuccess,
        ErrorCallback     onError
    ) override;

private:
    GameManifest parseManifest(const QByteArray &data);

    QNetworkAccessManager *m_manager;
};

#endif //GAMELAUNCHER_QTMANIFESTREPOSITORY_H