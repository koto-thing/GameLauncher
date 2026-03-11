#include "DisableStartupUseCase.h"
#include <stdexcept>

DisableStartupUseCase::DisableStartupUseCase(std::shared_ptr<IStartupRepository> repo)
    : m_repo(std::move(repo)) {

}

void DisableStartupUseCase::execute(const std::string &appName) {
    if (appName.empty()) {
        throw std::invalid_argument("appName cannot be empty");
    }

    m_repo->disable(appName);
}