#ifndef GAMELAUNCHER_IDOWNLOADREPOSITORY_H
#define GAMELAUNCHER_IDOWNLOADREPOSITORY_H

#include "../entities/DownloadTask.h"
#include <functional>
#include <cstdint>

using ProgressCallback = std::function<void(int64_t bytesReceived, int64_t bytesTotal)>;
using FinishedCallback = std::function<void(const std::string &filePath)>;
using ErrorCallback = std::function<void(const std::string &errorMessage)>;

class IDownloadRepository {
public:
    virtual ~IDownloadRepository() = default;
    virtual void startDownload(
        const DownloadTask &task,
        ProgressCallback onProgress,
        FinishedCallback onFinished,
        ErrorCallback onError
    ) = 0;
};

#endif //GAMELAUNCHER_IDOWNLOADREPOSITORY_H