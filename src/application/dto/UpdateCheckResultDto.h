#ifndef GAMELAUNCHER_UPDATECHECKRESULTDTO_H
#define GAMELAUNCHER_UPDATECHECKRESULTDTO_H

#include <string>

struct UpdateCheckResultDto {
    bool        hasUpdate = false;
    bool        autoUpdate = false;
    std::string latestVersion;
    std::string currentVersion;
    std::string releaseNotes;
};

#endif //GAMELAUNCHER_UPDATECHECKRESULTDTO_H