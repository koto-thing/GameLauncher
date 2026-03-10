#ifndef GAMELAUNCHER_DOWNLOADGAMEUSECASE_H
#define GAMELAUNCHER_DOWNLOADGAMEUSECASE_H

#include "../../domain/repositories/IDownloadRepository.h"
#include "../../application/dto/DownloadProgressDto.h"
#include <functional>
#include <memory>
#include <string>

class DownloadGameUseCase {
public:
    explicit DownloadGameUseCase(std::shared_ptr<IDownloadRepository> repo);

    void execute(
        const std::string                        &gameId,
        const std::string                        &url,
        const std::string                        &savePath,
        std::function<void(DownloadProgressDto)> onProgress,
        std::function<void(const std::string &)> onFinished,
        std::function<void(const std::string &)> onError
    );

private:
    std::shared_ptr<IDownloadRepository> m_repo;
};

#endif //GAMELAUNCHER_DOWNLOADGAMEUSECASE_H