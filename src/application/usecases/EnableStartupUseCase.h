#ifndef GAMELAUNCHER_ENABLESTARTUPUSECASE_H
#define GAMELAUNCHER_ENABLESTARTUPUSECASE_H

#include "../../domain/repositories/IStartupRepository.h"
#include <memory>
#include <string>

class EnableStartupUseCase {
public:
    explicit EnableStartupUseCase(const std::shared_ptr<IStartupRepository> repo);
    void execute(const std::string &appName, const std::string &executablePath);

private:
    std::shared_ptr<IStartupRepository> m_repo;
};

#endif //GAMELAUNCHER_ENABLESTARTUPUSECASE_H