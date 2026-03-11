#ifndef GAMELAUNCHER_MACSTARTUPREPOSITORY_H
#define GAMELAUNCHER_MACSTARTUPREPOSITORY_H

#include "../../domain/repositories/IStartupRepository.h"

class MacStartupRepository : public IStartupRepository {
public:
    void enable(const std::string &appName, const std::string &executablePath) override;
    void disable(const std::string &appName) override;
    bool isEnabled(const std::string& appName) override;

private:
    std::string plistPath(const std::string &appName);
};

#endif //GAMELAUNCHER_MACSTARTUPREPOSITORY_H