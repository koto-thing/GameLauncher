#ifndef GAMELAUNCHER_JSONSETTINGSREPOSITORY_H
#define GAMELAUNCHER_JSONSETTINGSREPOSITORY_H

#include "../../domain/repositories/ISettingsRepository.h"
#include <string>
#include <vector>

class JsonSettingsRepository : public ISettingsRepository {
public:
    explicit JsonSettingsRepository(const std::string &settingsFilePath);

    bool loadSettings() override;
    bool saveSettings() override;

    LauncherSettings load() override;
    void save(const LauncherSettings& settings) override;

    // Getters
    std::string getLauncherVersion() const override { return m_launcherVersion; }
    std::string getLanguage() const override { return m_language; }
    std::string getInstallDir() const override { return m_installDir; }
    bool isAutoRunOnStartup() const override { return m_autoRunOnStartup; }
    bool isShowLauncherAfterGameExit() const override { return m_showLauncherAfterGameExit; }
    WindowCloseAction getWindowCloseAction() const override { return m_windowCloseAction; }
    bool isAutoUpdateEnabled() const override { return m_autoUpdateEnabled; }
    bool isDownloadSpeedUnlimited() const override { return m_downloadSpeedUnlimited; }
    int getDownloadSpeedLimit() const override { return m_downloadSpeedLimit; }
    bool isContinueDownloadAfterGameStart() const override { return m_continueDownloadAfterGameStart; }
    bool isDesktopNotificationEnabled() const override { return m_desktopNotificationEnabled; }

    // Setters
    void setLanguage(const std::string &lang) override { m_language = lang; }
    void setInstallDir(const std::string &dir) override { m_installDir = dir; }
    void setAutoRunOnStartup(bool enabled) override { m_autoRunOnStartup = enabled; }
    void setShowLauncherAfterGameExit(bool enabled) override { m_showLauncherAfterGameExit = enabled; }
    void setWindowCloseAction(WindowCloseAction action) override { m_windowCloseAction = action; }
    void setAutoUpdateEnabled(bool enabled) override { m_autoUpdateEnabled = enabled; }
    void setDownloadSpeedUnlimited(bool unlimited) override { m_downloadSpeedUnlimited = unlimited; }
    void setDownloadSpeedLimit(int limit) override { m_downloadSpeedLimit = limit; }
    void setContinueDownloadAfterGameStart(bool enabled) override { m_continueDownloadAfterGameStart = enabled; }
    void setDesktopNotificationEnabled(bool enabled) override { m_desktopNotificationEnabled = enabled; }

    void subscribe(SettingsChangedCallback callback) override { m_callbacks.push_back(callback); }

private:
    std::string m_filePath;
    std::string m_launcherVersion  = "1.0.0";
    std::string m_language         = "ja";
    std::string m_installDir        = "";
    bool m_autoRunOnStartup        = false;
    bool m_showLauncherAfterGameExit = true;
    WindowCloseAction m_windowCloseAction = WindowCloseAction::Close;
    bool m_autoUpdateEnabled       = true;
    bool m_downloadSpeedUnlimited  = true;
    int  m_downloadSpeedLimit      = 4096;
    bool m_continueDownloadAfterGameStart = true;
    bool m_desktopNotificationEnabled = true;

    std::vector<SettingsChangedCallback> m_callbacks;
};

#endif //GAMELAUNCHER_JSONSETTINGSREPOSITORY_H