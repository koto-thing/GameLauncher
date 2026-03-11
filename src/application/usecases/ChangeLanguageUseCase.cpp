#include "ChangeLanguageUseCase.h"
#include "domain/entities/LauncherSettings.h"
#include <stdexcept>
#include <algorithm>

ChangeLanguageUseCase::ChangeLanguageUseCase(
    std::shared_ptr<ILanguageRepository> langRepo,
    std::shared_ptr<ISettingsRepository> settingsRepo)
    : m_langRepo(std::move(langRepo))
    , m_settingsRepo(std::move(settingsRepo)) {

}

void ChangeLanguageUseCase::execute(const std::string& languageCode) {
    validate(languageCode);

    // UIに言語を適用
    m_langRepo->applyLanguage(languageCode);

    // settings.jsonのlanguage変数を更新して保存する
    LauncherSettings settings = m_settingsRepo->load();
    settings.language = languageCode;
    m_settingsRepo->save(settings);
}

void ChangeLanguageUseCase::validate(const std::string& languageCode) {
    if (languageCode.empty()) {
        throw std::invalid_argument("languageCode is empty");
    }

    // 対応しているか確認
    auto available = m_langRepo->availableLanguages();
    bool found = std::any_of(available.begin(), available.end(),
        [&](const std::string &lang) { return lang == languageCode; });

    if (!found) {
        throw std::invalid_argument("languageCode is not available");
    }
}