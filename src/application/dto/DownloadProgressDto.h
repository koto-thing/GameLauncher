#ifndef GAMELAUNCHER_DOWNLOADPROGRESSDTO_H
#define GAMELAUNCHER_DOWNLOADPROGRESSDTO_H

#include <string>
#include <cstdint>

struct DownloadProgressDto {
    std::string gameId;
    int64_t bytesReceived = 0;
    int64_t bytesTotal    = 0;
    int     percent       = 0; // 0-100
};

#endif //GAMELAUNCHER_DOWNLOADPROGRESSDTO_H