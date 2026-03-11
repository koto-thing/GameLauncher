#ifndef GAMELAUNCHER_GAMEMANIFESTDTO_H
#define GAMELAUNCHER_GAMEMANIFESTDTO_H

#include <cstdint>
#include <string>
#include <vector>

struct GameFileDto {
    std::string path;
    std::string url;
    int64_t     size = 0;
    std::string checksum;
};

struct GameManifestDto {
    std::string              gameId;
    std::string              version;
    std::vector<GameFileDto> files;
};

#endif //GAMELAUNCHER_GAMEMANIFESTDTO_H