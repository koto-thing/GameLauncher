#ifndef GAMELAUNCHER_ILANGUAGEREPOSITORY_H
#define GAMELAUNCHER_ILANGUAGEREPOSITORY_H

#include <string>
#include <vector>

class ILanguageRepository {
public:
    virtual ~ILanguageRepository() = default;

    // 言語を適用する
    virtual void applyLanguage(const std::string& languageCode) = 0;

    // 現在適用中の言語コードを取得する
    virtual std::string currentLanguage() const = 0;

    // 対応言語の一覧を取得する
    virtual std::vector<std::string> availableLanguages() const = 0;
};

#endif //GAMELAUNCHER_ILANGUAGEREPOSITORY_H