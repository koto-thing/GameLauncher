#include "FetchManifestUseCase.h"

FetchManifestUseCase::FetchManifestUseCase(std::shared_ptr<IManifestRepository> repo)
    : m_repo(std::move(repo)) {

}

void FetchManifestUseCase::execute(
    const std::string                       &manifestUrl,
    std::function<void(GameManifestDto)>    onSuccess,
    std::function<void(const std::string&)> onError
) {
    m_repo->fetchManifest(
        manifestUrl,
        [onSuccess](const GameManifest &manifest) {
            GameManifestDto dto;
            dto.gameId = manifest.gameId;
            dto.version = manifest.version;
            for (const auto & [path, url, size, checksum] : manifest.files) {
                GameFileDto fileDto;
                fileDto.path     = path;
                fileDto.url      = url;
                fileDto.size     = size;
                fileDto.checksum = checksum;
                dto.files.push_back(fileDto);
            }

            onSuccess(dto);
        },

        onError
    );
}