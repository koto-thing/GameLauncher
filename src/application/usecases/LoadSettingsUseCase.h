#ifndef GAMELAUNCHER_LOADSETTINGSUSECASE_H
#define GAMELAUNCHER_LOADSETTINGSUSECASE_H

#include "../../domain/repositories/ISettingsRepository.h"
#include "../../application/dto/LauncherSettingsDto.h"
#include <memory>

class LoadSettingsUseCase {
public:
    explicit LoadSettingsUseCase(std::shared_ptr<ISettingsRepository> repo);
    LauncherSettingsDto execute();

private:
    std::shared_ptr<ISettingsRepository> m_repo;
};

#endif //GAMELAUNCHER_LOADSETTINGSUSECASE_H