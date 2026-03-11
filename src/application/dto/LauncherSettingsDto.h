#ifndef GAMELAUNCHER_LAUNCHERSETTINGSDTO_H
#define GAMELAUNCHER_LAUNCHERSETTINGSDTO_H

#include <string>

struct LauncherSettingsDto {
    std::string language     = "ja";
    bool startOnBoot         = false;
    std::string installDir   = "";
    int maxDownloadSpeedKB   = 0;
    bool closeToTray         = true;
    bool autoUpdate          = true;
    bool enableNotifications = true;
};

#endif //GAMELAUNCHER_LAUNCHERSETTINGSDTO_H