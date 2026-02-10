#ifndef GAMELAUNCHER_SETTINGSMANAGER_H
#define GAMELAUNCHER_SETTINGSMANAGER_H

#include <QString>
#include <QJsonObject>

class SettingsManager : public QObject {
    Q_OBJECT

public:
    // シングルトンインスタンス取得
    static SettingsManager* instance();

    // 設定の読み込みと保存
    bool loadSettings();
    bool saveSettings();

    // 一般設定
    QString language() const { return m_language; }
    void setLanguage(const QString& lang);

    bool autoRunOnStartup() const { return m_autoRunOnStartup; }
    void setAutoRunOnStartup(bool enabled);

    bool showLauncherAfterGameExit() const { return m_showLauncherAfterGameExit; }
    void setShowLauncherAfterGameExit(bool enabled);

    enum class WindowCloseAction {
        Minimize,
        Close
    };

    WindowCloseAction windowCloseAction() const { return m_windowCloseAction; }
    void setWindowCloseAction(WindowCloseAction action);

    bool autoUpdateEnabled() const { return m_autoUpdateEnabled; }
    void setAutoUpdateEnabled(bool enabled);

    // ダウンロード設定
    bool downloadSpeedUnlimited() const { return m_downloadSpeedUnlimited; }
    void setDownloadSpeedUnlimited(bool unlimited);

    int downloadSpeedLimit() const { return m_downloadSpeedLimit; }
    void setDownloadSpeedLimit(int limit);

    bool continueDownloadAfterGameStart() const { return m_continueDownloadAfterGameStart; }
    void setContinueDownloadAfterGameStart(bool enabled);

    // 通知設定
    bool desktopNotificationEnabled() const { return m_desktopNotificationEnabled; }
    void setDesktopNotificationEnabled(bool enabled);

signals:
    void settingsChanged();
    void languageChanged(const QString& language);
    void autoRunOnStartupChanged(bool enabled);
    void showLauncherAfterGameExitChanged(bool enabled);
    void windowCloseActionChanged(WindowCloseAction action);
    void autoUpdateEnabledChanged(bool enabled);
    void downloadSpeedUnlimitedChanged(bool unlimited);
    void downloadSpeedLimitChanged(int limit);
    void continueDownloadAfterGameStartChanged(bool enabled);
    void desktopNotificationEnabledChanged(bool enabled);

private:
    explicit SettingsManager(QObject *parent = nullptr);
    ~SettingsManager();

    // コピー禁止
    SettingsManager(const SettingsManager&) = delete;
    SettingsManager& operator=(const SettingsManager&) = delete;

    QString getSettingsFilePath() const;
    void setDefaultSettings();
    QJsonObject toJson() const;
    void fromJson(const QJsonObject& json);

    // 一般設定
    QString m_language;
    bool m_autoRunOnStartup;
    bool m_showLauncherAfterGameExit;
    WindowCloseAction m_windowCloseAction;
    bool m_autoUpdateEnabled;

    // ダウンロード設定
    bool m_downloadSpeedUnlimited;
    int m_downloadSpeedLimit;
    bool m_continueDownloadAfterGameStart;

    // 通知設定
    bool m_desktopNotificationEnabled;

    static SettingsManager* s_instance;
};

#endif