#ifndef GAMELAUNCHER_QTSETTINGSRYEPOSITORY_H
#define GAMELAUNCHER_QTSETTINGSRYEPOSITORY_H

#include "../../domain/repositories/ISettingsRepository.h"
#include <QObject>
#include <QString>
#include <QJsonObject>
#include <vector>

class QtSettingsRepository : public QObject, public ISettingsRepository {
    Q_OBJECT
public:
    explicit QtSettingsRepository(QObject *parent = nullptr);

    bool loadSettings() override;
    bool saveSettings() override;

    // Getters
    std::string getLanguage() const override { return m_language.toStdString(); }
    bool isAutoRunOnStartup() const override { return m_autoRunOnStartup; }
    bool isShowLauncherAfterGameExit() const override { return m_showLauncherAfterGameExit; }
    WindowCloseAction getWindowCloseAction() const override;
    bool isAutoUpdateEnabled() const override { return m_autoUpdateEnabled; }
    bool isDownloadSpeedUnlimited() const override { return m_downloadSpeedUnlimited; }
    int getDownloadSpeedLimit() const override { return m_downloadSpeedLimit; }
    bool isContinueDownloadAfterGameStart() const override { return m_continueDownloadAfterGameStart; }
    bool isDesktopNotificationEnabled() const override { return m_desktopNotificationEnabled; }

    // Setters
    void setLanguage(const std::string& lang) override;
    void setAutoRunOnStartup(bool enabled) override;
    void setShowLauncherAfterGameExit(bool enabled) override;
    void setWindowCloseAction(WindowCloseAction action) override;
    void setAutoUpdateEnabled(bool enabled) override;
    void setDownloadSpeedUnlimited(bool unlimited) override;
    void setDownloadSpeedLimit(int limit) override;
    void setContinueDownloadAfterGameStart(bool enabled) override;
    void setDesktopNotificationEnabled(bool enabled) override;

    void subscribe(SettingsChangedCallback callback) override;

signals:
    void settingsChanged();

private:
    QString getSettingsFilePath() const;
    void setDefaultSettings();
    QJsonObject toJson() const;
    void fromJson(const QJsonObject& json);

    QString m_language;
    bool m_autoRunOnStartup;
    bool m_showLauncherAfterGameExit;
    int m_windowCloseAction; // stored as int to avoid dependency issue in Json
    bool m_autoUpdateEnabled;
    bool m_downloadSpeedUnlimited;
    int m_downloadSpeedLimit;
    bool m_continueDownloadAfterGameStart;
    bool m_desktopNotificationEnabled;

    std::vector<SettingsChangedCallback> m_callbacks;
};

#endif //GAMELAUNCHER_QTSETTINGSRYEPOSITORY_H
