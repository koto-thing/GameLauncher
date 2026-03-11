#ifndef GAMELAUNCHER_FETCHMANIFESTUSECASE_H
#define GAMELAUNCHER_FETCHMANIFESTUSECASE_H

#include "../../domain/repositories/IManifestRepository.h"
#include "../dto/GameManifestDto.h"
#include <functional>
#include <memory>
#include <string>

class FetchManifestUseCase {
public:
    explicit FetchManifestUseCase(std::shared_ptr<IManifestRepository> repo);

    void execute(
        const std::string                       &manifestUrl,
        std::function<void(GameManifestDto)>    onSuccess,
        std::function<void(const std::string&)> onError
    );

private:
    std::shared_ptr<IManifestRepository> m_repo;
};

#endif //GAMELAUNCHER_FETCHMANIFESTUSECASE_H