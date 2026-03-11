#include "QtLauncherUpdateRepository.h"
#include <QNetworkRequest>
#include <QNetworkReply>
#include <QJsonDocument>
#include <QJsonObject>
#include <QFile>
#include <QDir>
#include <QProcess>
#include <QCoreApplication>
#include <QCryptographicHash>
#include <QDomDocument>
#include <QDomElement>
#include <sstream>
#include <vector>

QtLauncherUpdateRepository::QtLauncherUpdateRepository(QObject *parent)
    : QObject(parent), m_manager(new QNetworkAccessManager(this)) {

}

void QtLauncherUpdateRepository::checkUpdateWithMaintenanceTool(
    const std::string& toolPath,
    UpdateInfoCallback onSuccess,
    ErrorCallback onError
) {
    auto *process = new QProcess(this);
    QString path = QString::fromStdString(toolPath);

    if (path.isEmpty()) {
        path = QCoreApplication::applicationDirPath() + "/maintenancetool.exe";
    }
    qDebug() << "Using MaintenanceTool at:" << path;

    connect(process, &QProcess::finished, [process, onSuccess, onError](int exitCode) {
        if (exitCode == 0) {
            QByteArray output = process->readAllStandardOutput();
            QDomDocument doc;
            if (!doc.setContent(output)) {
                // XMLがない場合は更新なし
                LauncherUpdateInfo info;
                info.hasUpdate = false;
                onSuccess(info);
                process->deleteLater();
                return;
            }

            QDomElement root = doc.documentElement();
            QDomNodeList updates = root.elementsByTagName("update");
            if (updates.count() > 0) {
                QDomElement update = updates.at(0).toElement();
                LauncherUpdateInfo info;
                info.hasUpdate = true;
                info.latestVersion = update.attribute("version").toStdString();
                info.releaseNotes = update.attribute("description").toStdString();
                // QtIFWのcheckupdatesではURLなどは直接取れない場合が多いが、
                // 基本的にhasUpdate=trueであればmaintenancetoolを起動すれば良い
                onSuccess(info);
            } else {
                LauncherUpdateInfo info;
                info.hasUpdate = false;
                onSuccess(info);
            }
        } else if (exitCode == 1) {
            // 更新なし
            LauncherUpdateInfo info;
            info.hasUpdate = false;
            onSuccess(info);
        } else {
            onError("MaintenanceTool exited with code " + std::to_string(exitCode));
        }
        process->deleteLater();
    });

    connect(process, &QProcess::errorOccurred, [process, onError](QProcess::ProcessError error) {
        onError("Failed to start MaintenanceTool: " + std::to_string(error));
        process->deleteLater();
    });

    process->start(path, {"--checkupdates"});
}

void QtLauncherUpdateRepository::runMaintenanceTool(
    const std::string& toolPath,
    bool silent,
    std::function<void()> onStarted,
    ErrorCallback onError
) {
    QString path = QString::fromStdString(toolPath);
    if (path.isEmpty()) {
        path = QCoreApplication::applicationDirPath() + "/maintenancetool.exe";
    }
    qDebug() << "Using MaintenanceTool at:" << path;

    QStringList args;
    args << "--updater";
    if (silent) {
        args << "--silent";
    }

    if (QProcess::startDetached(path, args)) {
        onStarted();
    } else {
        onError("Failed to start MaintenanceTool for update.");
    }
}

void QtLauncherUpdateRepository::fetchUpdateInfo(
    const std::string  &manifestUrl,
    const std::string  &currentVersion,
    UpdateInfoCallback onSuccess,
    ErrorCallback      onError
) {
    // 互換性のためのダミー実装
    checkUpdateWithMaintenanceTool("", onSuccess, onError);
}

void QtLauncherUpdateRepository::downloadAndApply(
    const LauncherUpdateInfo& updateInfo,
    std::function<void(int)> onProgress,
    std::function<void(const std::string&)> onFinished,
    ErrorCallback onError
) {
    // QtIFWではmaintenancetoolがダウンロードと適用を両方行う
    runMaintenanceTool("", false, [onFinished]() {
        onFinished("MaintenanceTool started. Closing application...");
        QCoreApplication::quit();
    }, onError);
}

bool QtLauncherUpdateRepository::isNewer(const std::string& latest, const std::string& current) {
    auto parse = [](const std::string &v) {
        std::vector<int> parts;
        std::stringstream ss(v);
        std::string token;
        while (std::getline(ss, token, '.'))
            parts.push_back(std::atoi(token.c_str()));

        return parts;
    };

    auto l = parse(latest);
    auto c = parse(current);
    size_t len = std::max(l.size(), c.size());
    l.resize(len, 0);
    c.resize(len, 0);

    for (size_t i = 0 ; i < len ; ++i) {
        if (l[i] > c[i]) return true;
        if (l[i] < c[i]) return false;
    }

    return false;
}

bool QtLauncherUpdateRepository::verifyChecksum(const QString& filePath, const QString& checksum) {
    QStringList parts = checksum.split(":");
    if (parts.size() != 2) {
        return false;
    }

    QCryptographicHash::Algorithm algo;
    if (parts[0] == "sha256") {
        algo = QCryptographicHash::Sha256;
    } else if (parts[0] == "md5") {
        algo = QCryptographicHash::Md5;
    } else {
        return false;
    }

    QFile file(filePath);
    if (!file.open(QIODevice::ReadOnly)) {
        return false;
    }

    QCryptographicHash hash(algo);
    hash.addData(&file);
    return hash.result().toHex() == parts[1];
}

void QtLauncherUpdateRepository::launchUpdater(const QString& updateFilePath) {
    QString updaterPath = QCoreApplication::applicationDirPath() + "/updater.exe";
    QProcess::startDetached(updaterPath, {
        "--update-file", updateFilePath,
        "--target-dir", QCoreApplication::applicationDirPath()
    });

    QCoreApplication::quit();
}
