#include "LinuxStartupRepository.h"

#include <QFile>
#include <stdexcept>

#ifdef Q_OS_LINUX
#include <QDir>
#include <QFile>
#include <stdexcept>

std::string LinuxStartupRepository::desktopFilePath(const std::string &appName) {
    QString home = QDir::homePath();
    return (home + "/.config/autostart/"
        + QString::fromStdString(appName) + ".desktop").toStdString();
}

void LinuxStartupRepository::enable(const std:string &appName, const std::string &executablePath) {
    QString desktop = QString(
        "[Desktop Entry]\n"
        "Type=Application\n"
        "Name=%1\n"
        "Exec=%2\n"
        "Hidden=false\n"
        "NoDisplay=false\n"
        "X-GNOME-Autostart-enabled=true\n"
    )
        .arg(QString::fromStdString(appName))
        .arg(QString::fromStdString(executablePath));

    QString path = QString::fromStdString(desktopFilePath(appName));
    QDir().mkpath(QFileInfo(path).absolutePath());

    QFile file(path);
    if (!file.open(QIODevice::WriteOnly | QIODevice::Text)) {
        throw std::runtime_error("Failed to create desktop file: " + path.toStdString());
    }

    file.write(desktop.toUtf8());
}

void LinuxStartupRepository::disable(const std::string &appName) {
    QString path = QString::fromStdString(desktopFilePath(appName));
    QFile file(path);

    if (file.exists() && !file.remove()) {
        throw std::runtime_error("Failed to remove desktop file: " + path.toStdString());
    }
}

bool LinuxStartupRepository::isEnabled(const std::string &appName) {
    return QFile::exists(desktopFilePath(appName));
}

#endif
