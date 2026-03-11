#ifndef GAMELAUNCHER_GAMEFILE_H
#define GAMELAUNCHER_GAMEFILE_H

#include <cstdint>
#include <string>

struct GameFile {
    std::string path;
    std::string url;
    int64_t size = 0;
    std::string checksum;
};

#endif //GAMELAUNCHER_GAMEFILE_H