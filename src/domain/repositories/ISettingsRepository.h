#ifndef GAMELAUNCHER_ISETTINGSRYEPOSITORY_H
#define GAMELAUNCHER_ISETTINGSRYEPOSITORY_H

#include <functional>
#include <string>
#include "../entities/LauncherSettings.h"

enum class WindowCloseAction {
    Minimize = 0,
    Close    = 1
};

using SettingsChangedCallback = std::function<void()>;

class ISettingsRepository {
public:
    virtual ~ISettingsRepository() = default;

    virtual bool loadSettings() = 0;
    virtual bool saveSettings() = 0;

    virtual LauncherSettings load() = 0;
    virtual void save(const LauncherSettings& settings) = 0;

    // Getters
    virtual std::string getLauncherVersion() const = 0;
    virtual std::string getLanguage() const = 0;
    virtual std::string getInstallDir() const = 0;
    virtual bool isAutoRunOnStartup() const = 0;
    virtual bool isShowLauncherAfterGameExit() const = 0;
    virtual WindowCloseAction getWindowCloseAction() const = 0;
    virtual bool isAutoUpdateEnabled() const = 0;
    virtual bool isDownloadSpeedUnlimited() const = 0;
    virtual int getDownloadSpeedLimit() const = 0;
    virtual bool isContinueDownloadAfterGameStart() const = 0;
    virtual bool isDesktopNotificationEnabled() const = 0;

    // Setters
    virtual void setLanguage(const std::string &lang) = 0;
    virtual void setInstallDir(const std::string &dir) = 0;
    virtual void setAutoRunOnStartup(bool enabled) = 0;
    virtual void setShowLauncherAfterGameExit(bool enabled) = 0;
    virtual void setWindowCloseAction(WindowCloseAction action) = 0;
    virtual void setAutoUpdateEnabled(bool enabled) = 0;
    virtual void setDownloadSpeedUnlimited(bool unlimited) = 0;
    virtual void setDownloadSpeedLimit(int limit) = 0;
    virtual void setContinueDownloadAfterGameStart(bool enabled) = 0;
    virtual void setDesktopNotificationEnabled(bool enabled) = 0;

    virtual void subscribe(SettingsChangedCallback callback) = 0;
};

#endif //GAMELAUNCHER_ISETTINGSRYEPOSITORY_H
