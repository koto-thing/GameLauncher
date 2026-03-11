#include "EnableStartupUseCase.h"
#include <stdexcept>

EnableStartupUseCase::EnableStartupUseCase(std::shared_ptr<IStartupRepository> repo)
    : m_repo(std::move(repo)) {

}

void EnableStartupUseCase::execute(const std::string &appName, const std::string &executablePath) {
    if (appName.empty()) {
        throw std::runtime_error("App name cannot be empty");
    }

    if (executablePath.empty()) {
        throw std::runtime_error("Executable path cannot be empty");
    }

    m_repo->enable(appName, executablePath);
}