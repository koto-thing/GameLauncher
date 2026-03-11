#ifndef GAMELAUNCHER_DOWNLOADTASK_H
#define GAMELAUNCHER_DOWNLOADTASK_H

#include "GameFile.h"
#include <string>

struct DownloadTask {
    std::string gameId;
    std::string installDir;
    GameFile    file;
};

#endif //GAMELAUNCHER_DOWNLOADTASK_H