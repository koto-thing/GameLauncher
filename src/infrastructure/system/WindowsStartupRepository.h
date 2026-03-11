#ifndef GAMELAUNCHER_WINDOWSSTARTUPREPOSITORY_H
#define GAMELAUNCHER_WINDOWSSTARTUPREPOSITORY_H

#include "../../domain/repositories/IStartupRepository.h"

class WindowsStartupRepository : public IStartupRepository {
public:
    void enable(const std::string& appName, const std::string& executablePath) override;
    void disable(const std::string& appName) override;
    bool isEnabled(const std::string& appName) override;

private:
    static constexpr const wchar_t *kRegistryKey =
        L"Software\\Microsoft\\Windows\\CurrentVersion\\Run";
};


#endif //GAMELAUNCHER_WINDOWSSTARTUPREPOSITORY_H