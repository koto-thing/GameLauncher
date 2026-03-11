#ifndef GAMELAUNCHER_GAMEMANIFEST_H
#define GAMELAUNCHER_GAMEMANIFEST_H

#include "GameFile.h"
#include <string>
#include <vector>

struct GameManifest {
    std::string gameId;
    std::string version;
    std::vector<GameFile> files;
};

#endif //GAMELAUNCHER_GAMEMANIFEST_H