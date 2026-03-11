#ifndef GAMELAUNCHER_DISABLESTARTUPUSECASE_H
#define GAMELAUNCHER_DISABLESTARTUPUSECASE_H

#include "../../domain/repositories/IStartupRepository.h"
#include <memory>
#include <string>

class DisableStartupUseCase {
public:
    explicit DisableStartupUseCase(std::shared_ptr<IStartupRepository> repo);
    void execute(const std::string &appName);

private:
    std::shared_ptr<IStartupRepository> m_repo;
};

#endif //GAMELAUNCHER_DISABLESTARTUPUSECASE_H