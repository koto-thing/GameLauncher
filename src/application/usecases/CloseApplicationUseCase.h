#ifndef GAMELAUNCHER_CLOSEAPPLICATIONUSECASE_H
#define GAMELAUNCHER_CLOSEAPPLICATIONUSECASE_H

#include "../../domain/repositories/IApplicationRepository.h"
#include "../../domain/repositories/ISettingsRepository.h"
#include "../../domain/entities/CloseAction.h"
#include <memory>

class CloseApplicationUseCase {
public:
    CloseApplicationUseCase(
        std::shared_ptr<IApplicationRepository> appRepo,
        std::shared_ptr<ISettingsRepository>    settingsRepo
    );

    // 完全終了からトレイに格納するかのアクションを実行
    void execute() const;

    // 強制終了する
    void forceQuit() const;

private:
    std::shared_ptr<IApplicationRepository> m_appRepo;
    std::shared_ptr<ISettingsRepository>    m_settingsRepo;
};


#endif //GAMELAUNCHER_CLOSEAPPLICATIONUSECASE_H