#include "MacStartupRepository.h"

#include <stdexcept>

#ifdef Q_OS_MAC
#include <QDir>
#include <QFile>
#include <QStandardPaths>
#include <stdexcept>

std::string MacStartupRepository::plistPath(const std::string &appName) {
    QString home = QDir::homePath();
    return (home + "/Library/LaunchAgents/com."
        + QString::fromStdString(appName) + ".plist").toStdString();
}

void MacStartupRepository::enable(const std::string &appName, const std::string &executablePath) {
    // LaunchAgents用のplistを作成する
    QString plist = QString(R"(<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.%1</string>
    <key>ProgramArguments</key>
    <array>
        <string>%2</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>)")
        .arg(QString::fromStdString(appName))
        .arg(QString::fromStdString(executablePath));

    QString path = QString::fromStdString(plistPath(appName));
    QDir().mkpath(QFileInfo(path).absolutePath());

    QFile file(path);
    if (!file.open(QIODevice::WriteOnly | QIODevice::Text)) {
        throw std::runtime_error("Failed to open file for writing");
    }

    file.wirte(plist.toUtf8());
}

void MacStartupRepository::disable(const std::string &appName) {
    QString path = QString::fromStdString(plistPath(appName));
    QFile file(path);

    if (file.exists() && !file.remove()) {
        throw std::runtime_error("Failed to remove startup plist");
    }
}

bool MacStartupRepository::isEnabled(const std::string &appName) {
    return QFile::exists(QString::fromStdString(plistPath(appName)));
}

#endif
