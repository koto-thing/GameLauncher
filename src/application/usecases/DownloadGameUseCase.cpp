#include "DownloadGameUseCase.h"

DownloadGameUseCase::DownloadGameUseCase(std::shared_ptr<IDownloadRepository> repo)
    : m_repo(std::move(repo)) {

}

void DownloadGameUseCase::execute(
    const std::string& gameId,
    const std::string& url,
    const std::string& savePath,
    std::function<void(DownloadProgressDto)> onProgress,
    std::function<void(const std::string&)> onFinished,
    std::function<void(const std::string&)> onError)
{
    DownloadTask task { gameId, url, savePath };

    m_repo->startDownload(
        task,
        [gameId, onProgress](int64_t recv, int64_t total) {
            DownloadProgressDto dto;
            dto.gameId = gameId;
            dto.bytesReceived = recv;
            dto.bytesTotal = total;
            dto.percent = (total > 0) ? static_cast<int>(recv * 100 / total) : 0;
            onProgress(dto);
        },
        onFinished,
        onError
    );
}
