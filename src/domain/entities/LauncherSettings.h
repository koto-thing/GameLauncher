#ifndef GAMELAUNCHER_LAUNCHERSETTINGS_H
#define GAMELAUNCHER_LAUNCHERSETTINGS_H

#include <string>

struct LauncherSettings {
    std::string language     = "ja";
    bool startOnBoot         = false;
    std::string installDir   = "";
    int maxDownloadSpeedKB   = 0;
    bool closeToTray         = true;
    bool autoUpdate          = true;
    bool enableNotifications = true;
    std::string launcherVersion = "1.0.0";
};

#endif //GAMELAUNCHER_LAUNCHERSETTINGS_H