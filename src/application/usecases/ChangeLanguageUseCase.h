#ifndef GAMELAUNCHER_CHANGELANGUAGEUSECASE_H
#define GAMELAUNCHER_CHANGELANGUAGEUSECASE_H

#include "../../domain/repositories/ILanguageRepository.h"
#include "../../domain/repositories/ISettingsRepository.h"
#include <memory>
#include <string>

class ChangeLanguageUseCase {
public:
    ChangeLanguageUseCase(
        std::shared_ptr<ILanguageRepository> langRepo,
        std::shared_ptr<ISettingsRepository> settingsRepo
    );
    void execute(const std::string &languageCode);

private:
    std::shared_ptr<ILanguageRepository> m_langRepo;
    std::shared_ptr<ISettingsRepository> m_settingsRepo;

    void validate(const std::string &languageCode);
};


#endif //GAMELAUNCHER_CHANGELANGUAGEUSECASE_H