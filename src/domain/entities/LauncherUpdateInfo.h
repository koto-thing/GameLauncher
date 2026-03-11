#ifndef GAMELAUNCHER_LAUNCHERUPDATEINFO_H
#define GAMELAUNCHER_LAUNCHERUPDATEINFO_H

#include <string>

struct LauncherUpdateInfo {
    std::string latestVersion;
    std::string currentVersion;
    std::string downloadUrl;
    std::string releaseNotes;
    std::string checksum;
    bool        hasUpdate = false;
};

#endif //GAMELAUNCHER_LAUNCHERUPDATEINFO_H