#ifndef GAMELAUNCHER_LINUXSTARTUPREPOSITORY_H
#define GAMELAUNCHER_LINUXSTARTUPREPOSITORY_H

#include "../../domain/repositories/IStartupRepository.h"

class LinuxStartupRepository : public IStartupRepository {
public:
    void enable(const std::string& appName, const std::string& executablePath) override;
    void disable(const std::string& executablePath) override;
    bool isEnabled(const std::string& executablePath) override;

private:
    std::string desktopFilePath(const std::string &appName);
};

#endif //GAMELAUNCHER_LINUXSTARTUPREPOSITORY_H