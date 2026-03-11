#ifndef GAMELAUNCHER_QTLAUNCHERUPDATEREPOSITORY_H
#define GAMELAUNCHER_QTLAUNCHERUPDATEREPOSITORY_H

#include "../../domain/repositories/ILauncherUpdateRepository.h"
#include <QObject>
#include <QNetworkAccessManager>

class QtLauncherUpdateRepository : public QObject, public ILauncherUpdateRepository {
    Q_OBJECT
public:
    explicit QtLauncherUpdateRepository(QObject *parent = nullptr);

    void checkUpdateWithMaintenanceTool(
        const std::string& toolPath,
        UpdateInfoCallback onSuccess,
        ErrorCallback onError
    ) override;

    void runMaintenanceTool(
        const std::string& toolPath,
        bool silent,
        std::function<void()> onStarted,
        ErrorCallback onError
    ) override;

    void fetchUpdateInfo(
        const std::string& manifestUrl,
        const std::string& currentVersion,
        UpdateInfoCallback onSuccess,
        ErrorCallback onError
    ) override;

    void downloadAndApply(const LauncherUpdateInfo& updateInfo,
        std::function<void(int)> onProgress,
        std::function<void(const std::string&)> onFinished,
        ErrorCallback onError
    ) override;

private:
    // セマンティックバージョンを比較
    bool isNewer(const std::string &latest, const std::string &current);

    // checksum検証
    bool verifyChecksum(const QString &filePath, const QString &checksum);

    // ダウンロードした更新ファイルを展開して起動する
    void launchUpdater(const QString &updateFilePath);

    QNetworkAccessManager *m_manager;
};


#endif //GAMELAUNCHER_QTLAUNCHERUPDATEREPOSITORY_H