#include "DownloadGameUseCase.h"

DownloadGameUseCase::DownloadGameUseCase(std::shared_ptr<IDownloadRepository> repo)
: m_repo(std::move(repo)) {

}

void DownloadGameUseCase::execute(
    const GameManifestDto                    &manifest,
    const std::string                        &installDir,
    std::function<void(DownloadProgressDto)> onProgress,
    std::function<void()>                    onAllCompleted,
    std::function<void(const std::string&)>  onError
) {
    if (manifest.files.empty()) {
        onAllCompleted();
        return;
    }

    downloadNext(manifest, installDir, 0, onProgress, onAllCompleted, onError);
}

void DownloadGameUseCase::downloadNext(
    const GameManifestDto                    &manifest,
    const std::string                        &installDir,
    int                                      index,
    std::function<void(DownloadProgressDto)> onProgress,
    std::function<void()>                    onAllCompleted,
    std::function<void(const std::string&)>  onError
) {
    if (index >= static_cast<int>(manifest.files.size())) {
        onAllCompleted();
        return;
    }

    const GameFileDto &fileDto = manifest.files[index];
    const int         total = static_cast<int>(manifest.files.size());

    // DTOからエンティティに変換
    DownloadTask task;
    task.gameId = manifest.gameId;
    task.installDir = installDir;
    task.file = { fileDto.path, fileDto.url, fileDto.size, fileDto.checksum };

    m_repo->startDownload(
        task,

        // 進捗コールバック
        [this, onProgress, manifest, index, total, fileDto](int64_t recv, int64_t totalBytes) {
            DownloadProgressDto dto;
            dto.gameId = manifest.gameId;
            dto.currentFile = fileDto.path;
            dto.fileIndex = index + 1;
            dto.fileCount = total;
            dto.bytesReceived = totalBytes;
            dto.bytesTotal = totalBytes;
            dto.percent = (totalBytes > 0) ? static_cast<int>(recv * 100 / totalBytes) : 0;
            onProgress(dto);
        },

        // 完了コールバック
        [this, manifest, installDir, index, onProgress, onAllCompleted, onError](const std::string&) {
            downloadNext(manifest, installDir, index + 1, onProgress, onAllCompleted, onError);
        },

        onError
    );
}
