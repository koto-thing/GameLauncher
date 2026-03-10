#ifndef GAMELAUNCHER_DOWNLOADTASK_H
#define GAMELAUNCHER_DOWNLOADTASK_H

#include <string>

struct DownloadTask {
    std::string gameId;
    std::string url;
    std::string savePath;
};

#endif //GAMELAUNCHER_DOWNLOADTASK_H