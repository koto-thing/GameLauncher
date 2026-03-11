#ifndef GAMELAUNCHER_IMANIFESTREPOSITORY_H
#define GAMELAUNCHER_IMANIFESTREPOSITORY_H

#include "../../domain/entities/GameManifest.h"
#include <functional>
#include <string>

using ManifestCallback = std::function<void(const GameManifest&)>;
using ErrorCallback = std::function<void(const std::string&)>;

class IManifestRepository {
public:
    virtual ~IManifestRepository() = default;
    virtual void fetchManifest(
        const std::string &manifestUrl,
        ManifestCallback  manifestCallback,
        ErrorCallback     errorCallback
    ) = 0;
};

#endif //GAMELAUNCHER_IMANIFESTREPOSITORY_H