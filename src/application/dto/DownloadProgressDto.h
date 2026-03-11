#ifndef GAMELAUNCHER_DOWNLOADPROGRESSDTO_H
#define GAMELAUNCHER_DOWNLOADPROGRESSDTO_H

#include <string>
#include <cstdint>

struct DownloadProgressDto {
    std::string gameId;
    std::string currentFile;
    int         fileIndex = 0;
    int         fileCount = 0;
    int64_t     bytesReceived = 0;
    int64_t     bytesTotal = 0;
    int         percent = 0;
};

#endif //GAMELAUNCHER_DOWNLOADPROGRESSDTO_H