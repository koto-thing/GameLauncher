#include "QtSettingsRepository.h"
#include <QJsonDocument>
#include <QStandardPaths>
#include <QDir>
#include <QFile>
#include <QDebug>

QtSettingsRepository::QtSettingsRepository(QObject *parent) : QObject(parent) {
    setDefaultSettings();
    connect(this, &QtSettingsRepository::settingsChanged, [this]() {
        for (auto& callback : m_callbacks) {
            callback();
        }
    });
}

bool QtSettingsRepository::loadSettings() {
    QString filePath = getSettingsFilePath();
    QFile file(filePath);

    if (!file.exists()) {
        return false;
    }

    if (!file.open(QIODevice::ReadOnly)) {
        return false;
    }

    QByteArray data = file.readAll();
    file.close();

    QJsonDocument doc = QJsonDocument::fromJson(data);
    if (doc.isNull() || !doc.isObject()) {
        return false;
    }

    fromJson(doc.object());
    return true;
}

bool QtSettingsRepository::saveSettings() {
    QString filePath = getSettingsFilePath();
    QFile file(filePath);

    if (!file.open(QIODevice::WriteOnly)) {
        return false;
    }

    QJsonDocument doc(toJson());
    file.write(doc.toJson(QJsonDocument::Indented));
    file.close();

    return true;
}

LauncherSettings QtSettingsRepository::load() {
    loadSettings();
    LauncherSettings s;
    s.language = m_language.toStdString();
    s.startOnBoot = m_autoRunOnStartup;
    s.installDir = m_installDir.toStdString();
    s.maxDownloadSpeedKB = m_downloadSpeedLimit;
    s.closeToTray = (static_cast<WindowCloseAction>(m_windowCloseAction) == WindowCloseAction::Minimize);
    s.autoUpdate = m_autoUpdateEnabled;
    s.enableNotifications = m_desktopNotificationEnabled;
    s.launcherVersion = m_launcherVersion.toStdString();
    return s;
}

void QtSettingsRepository::save(const LauncherSettings& settings) {
    m_language = QString::fromStdString(settings.language);
    m_autoRunOnStartup = settings.startOnBoot;
    m_installDir = QString::fromStdString(settings.installDir);
    m_downloadSpeedLimit = settings.maxDownloadSpeedKB;
    m_windowCloseAction = static_cast<int>(settings.closeToTray ? WindowCloseAction::Minimize : WindowCloseAction::Close);
    m_autoUpdateEnabled = settings.autoUpdate;
    m_desktopNotificationEnabled = settings.enableNotifications;
    m_launcherVersion = QString::fromStdString(settings.launcherVersion);
    saveSettings();
}

WindowCloseAction QtSettingsRepository::getWindowCloseAction() const {
    return static_cast<WindowCloseAction>(m_windowCloseAction);
}

void QtSettingsRepository::setLanguage(const std::string& lang) {
    QString qlang = QString::fromStdString(lang);
    if (m_language != qlang) {
        m_language = qlang;
        emit settingsChanged();
    }
}

void QtSettingsRepository::setInstallDir(const std::string& dir) {
    QString qdir = QString::fromStdString(dir);
    if (m_installDir != qdir) {
        m_installDir = qdir;
        emit settingsChanged();
    }
}

void QtSettingsRepository::setAutoRunOnStartup(bool enabled) {
    if (m_autoRunOnStartup != enabled) {
        m_autoRunOnStartup = enabled;
        emit settingsChanged();
    }
}

void QtSettingsRepository::setShowLauncherAfterGameExit(bool enabled) {
    if (m_showLauncherAfterGameExit != enabled) {
        m_showLauncherAfterGameExit = enabled;
        emit settingsChanged();
    }
}

void QtSettingsRepository::setWindowCloseAction(WindowCloseAction action) {
    int iaction = static_cast<int>(action);
    if (m_windowCloseAction != iaction) {
        m_windowCloseAction = iaction;
        emit settingsChanged();
    }
}

void QtSettingsRepository::setAutoUpdateEnabled(bool enabled) {
    if (m_autoUpdateEnabled != enabled) {
        m_autoUpdateEnabled = enabled;
        emit settingsChanged();
    }
}

void QtSettingsRepository::setDownloadSpeedUnlimited(bool unlimited) {
    if (m_downloadSpeedUnlimited != unlimited) {
        m_downloadSpeedUnlimited = unlimited;
        emit settingsChanged();
    }
}

void QtSettingsRepository::setDownloadSpeedLimit(int limit) {
    if (m_downloadSpeedLimit != limit) {
        m_downloadSpeedLimit = limit;
        emit settingsChanged();
    }
}

void QtSettingsRepository::setContinueDownloadAfterGameStart(bool enabled) {
    if (m_continueDownloadAfterGameStart != enabled) {
        m_continueDownloadAfterGameStart = enabled;
        emit settingsChanged();
    }
}

void QtSettingsRepository::setDesktopNotificationEnabled(bool enabled) {
    if (m_desktopNotificationEnabled != enabled) {
        m_desktopNotificationEnabled = enabled;
        emit settingsChanged();
    }
}

void QtSettingsRepository::subscribe(SettingsChangedCallback callback) {
    m_callbacks.push_back(callback);
}

QString QtSettingsRepository::getSettingsFilePath() const {
    QString appDataPath = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
    QDir dir(appDataPath);
    if (!dir.exists()) {
        dir.mkpath(".");
    }
    return appDataPath + "/settings.json";
}

void QtSettingsRepository::setDefaultSettings() {
    m_language = "日本語";
    m_installDir = "";
    m_launcherVersion = "1.0.0";
    m_autoRunOnStartup = false;
    m_showLauncherAfterGameExit = true;
    m_windowCloseAction = static_cast<int>(WindowCloseAction::Close);
    m_autoUpdateEnabled = false;
    m_downloadSpeedUnlimited = true;
    m_downloadSpeedLimit = 4096;
    m_continueDownloadAfterGameStart = true;
    m_desktopNotificationEnabled = true;
}

QJsonObject QtSettingsRepository::toJson() const {
    QJsonObject json;
    QJsonObject general;
    general["language"] = m_language;
    general["installDir"] = m_installDir;
    general["launcherVersion"] = m_launcherVersion;
    general["autoRunOnStartup"] = m_autoRunOnStartup;
    general["showLauncherAfterGameExit"] = m_showLauncherAfterGameExit;
    general["windowCloseAction"] = m_windowCloseAction;
    general["autoUpdateEnabled"] = m_autoUpdateEnabled;
    json["general"] = general;

    QJsonObject download;
    download["speedUnlimited"] = m_downloadSpeedUnlimited;
    download["speedLimit"] = m_downloadSpeedLimit;
    download["continueAfterGameStart"] = m_continueDownloadAfterGameStart;
    json["download"] = download;

    QJsonObject notification;
    notification["desktopNotificationEnabled"] = m_desktopNotificationEnabled;
    json["notification"] = notification;
    return json;
}

void QtSettingsRepository::fromJson(const QJsonObject& json) {
    if (json.contains("general") && json["general"].isObject()) {
        QJsonObject general = json["general"].toObject();
        m_language = general["language"].toString(m_language);
        m_installDir = general["installDir"].toString(m_installDir);
        m_launcherVersion = general["launcherVersion"].toString(m_launcherVersion);
        m_autoRunOnStartup = general["autoRunOnStartup"].toBool(m_autoRunOnStartup);
        m_showLauncherAfterGameExit = general["showLauncherAfterGameExit"].toBool(m_showLauncherAfterGameExit);
        m_windowCloseAction = general["windowCloseAction"].toInt(m_windowCloseAction);
        m_autoUpdateEnabled = general["autoUpdateEnabled"].toBool(m_autoUpdateEnabled);
    }
    if (json.contains("download") && json["download"].isObject()) {
        QJsonObject download = json["download"].toObject();
        m_downloadSpeedUnlimited = download["speedUnlimited"].toBool(m_downloadSpeedUnlimited);
        m_downloadSpeedLimit = download["speedLimit"].toInt(m_downloadSpeedLimit);
        m_continueDownloadAfterGameStart = download["continueAfterGameStart"].toBool(m_continueDownloadAfterGameStart);
    }
    if (json.contains("notification") && json["notification"].isObject()) {
        QJsonObject notification = json["notification"].toObject();
        m_desktopNotificationEnabled = notification["desktopNotificationEnabled"].toBool(m_desktopNotificationEnabled);
    }
}
