#ifndef GAMELAUNCHER_DOWNLOADGAMEUSECASE_H
#define GAMELAUNCHER_DOWNLOADGAMEUSECASE_H

#include "../../domain/repositories/IDownloadRepository.h"
#include "../dto/GameManifestDto.h"
#include "../dto/DownloadProgressDto.h"
#include <functional>
#include <memory>
#include <string>

class DownloadGameUseCase {
public:
    explicit DownloadGameUseCase(std::shared_ptr<IDownloadRepository> repo);

    void execute(
        const GameManifestDto                    &manifest,
        const std::string                        &installDir,
        std::function<void(DownloadProgressDto)> onProgress,
        std::function<void()>                    onAllCompleted,
        std::function<void(const std::string&)>  onError
    );

private:
    void downloadNext(
        const GameManifestDto                    &manifest,
        const std::string                        &installDir,
        int                                      index,
        std::function<void(DownloadProgressDto)> onProgress,
        std::function<void()>                    onAllCompleted,
        std::function<void(const std::string &)> onError
    );

    std::shared_ptr<IDownloadRepository> m_repo;
};

#endif //GAMELAUNCHER_DOWNLOADGAMEUSECASE_H