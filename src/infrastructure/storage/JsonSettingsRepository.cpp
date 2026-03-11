#include "JsonSettingsRepository.h"
#include <QFile>
#include <QDir>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <stdexcept>

JsonSettingsRepository::JsonSettingsRepository(const std::string &settingsFilePath)
    : m_filePath(settingsFilePath) {
}

bool JsonSettingsRepository::loadSettings() {
    QFile file(QString::fromStdString(m_filePath));
    if (!file.exists() || !file.open(QIODevice::ReadOnly)) {
        return false;
    }

    QJsonDocument doc = QJsonDocument::fromJson(file.readAll());
    if (doc.isNull() || !doc.isObject()) {
        return false;
    }

    QJsonObject obj = doc.object();
    if (obj.contains("launcherVersion")) m_launcherVersion = obj["launcherVersion"].toString().toStdString();
    if (obj.contains("language"))        m_language        = obj["language"].toString().toStdString();
    if (obj.contains("installDir"))      m_installDir      = obj["installDir"].toString().toStdString();
    if (obj.contains("autoRunOnStartup"))          m_autoRunOnStartup          = obj["autoRunOnStartup"].toBool();
    if (obj.contains("showLauncherAfterGameExit")) m_showLauncherAfterGameExit = obj["showLauncherAfterGameExit"].toBool();
    if (obj.contains("windowCloseAction"))         m_windowCloseAction         = static_cast<WindowCloseAction>(obj["windowCloseAction"].toInt());
    if (obj.contains("autoUpdateEnabled"))         m_autoUpdateEnabled         = obj["autoUpdateEnabled"].toBool();
    if (obj.contains("downloadSpeedUnlimited"))    m_downloadSpeedUnlimited    = obj["downloadSpeedUnlimited"].toBool();
    if (obj.contains("downloadSpeedLimit"))        m_downloadSpeedLimit        = obj["downloadSpeedLimit"].toInt();
    if (obj.contains("continueDownloadAfterGameStart")) m_continueDownloadAfterGameStart = obj["continueDownloadAfterGameStart"].toBool();
    if (obj.contains("desktopNotificationEnabled"))    m_desktopNotificationEnabled    = obj["desktopNotificationEnabled"].toBool();

    return true;
}

bool JsonSettingsRepository::saveSettings() {
    QFileInfo fileInfo(QString::fromStdString(m_filePath));
    QDir().mkpath(fileInfo.absolutePath());

    QJsonObject obj;
    obj["launcherVersion"]               = QString::fromStdString(m_launcherVersion);
    obj["language"]                      = QString::fromStdString(m_language);
    obj["installDir"]                    = QString::fromStdString(m_installDir);
    obj["autoRunOnStartup"]              = m_autoRunOnStartup;
    obj["showLauncherAfterGameExit"]     = m_showLauncherAfterGameExit;
    obj["windowCloseAction"]             = static_cast<int>(m_windowCloseAction);
    obj["autoUpdateEnabled"]             = m_autoUpdateEnabled;
    obj["downloadSpeedUnlimited"]        = m_downloadSpeedUnlimited;
    obj["downloadSpeedLimit"]            = m_downloadSpeedLimit;
    obj["continueDownloadAfterGameStart"]= m_continueDownloadAfterGameStart;
    obj["desktopNotificationEnabled"]    = m_desktopNotificationEnabled;

    QFile file(QString::fromStdString(m_filePath));
    if (!file.open(QIODevice::WriteOnly)) {
        return false;
    }

    file.write(QJsonDocument(obj).toJson(QJsonDocument::Indented));
    return true;
}

LauncherSettings JsonSettingsRepository::load() {
    loadSettings();
    LauncherSettings s;
    s.language = m_language;
    s.startOnBoot = m_autoRunOnStartup;
    s.installDir = m_installDir;
    s.maxDownloadSpeedKB = m_downloadSpeedLimit;
    s.closeToTray = (m_windowCloseAction == WindowCloseAction::Minimize);
    s.autoUpdate = m_autoUpdateEnabled;
    s.enableNotifications = m_desktopNotificationEnabled;
    s.launcherVersion = m_launcherVersion;
    return s;
}

void JsonSettingsRepository::save(const LauncherSettings& settings) {
    m_language = settings.language;
    m_autoRunOnStartup = settings.startOnBoot;
    m_installDir = settings.installDir;
    m_downloadSpeedLimit = settings.maxDownloadSpeedKB;
    m_windowCloseAction = settings.closeToTray ? WindowCloseAction::Minimize : WindowCloseAction::Close;
    m_autoUpdateEnabled = settings.autoUpdate;
    m_desktopNotificationEnabled = settings.enableNotifications;
    m_launcherVersion = settings.launcherVersion;
    saveSettings();
}