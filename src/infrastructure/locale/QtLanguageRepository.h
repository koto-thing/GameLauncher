#ifndef GAMELAUNCHER_QTLANGUAGEREPOSITORY_H
#define GAMELAUNCHER_QTLANGUAGEREPOSITORY_H

#include "../../domain/repositories/ILanguageRepository.h"
#include <QTranslator>
#include <QString>
#include <memory>

class QtLanguageRepository : public ILanguageRepository {
public:
    explicit QtLanguageRepository(const QString &translationDir);

    void applyLanguage(const std::string& languageCode) override;
    std::string currentLanguage() const override;
    std::vector<std::string> availableLanguages() const override;

private:
    QString     m_translationDir;
    std::string m_currentLanguage;

    std::unique_ptr<QTranslator> m_translator;
};


#endif //GAMELAUNCHER_QTLANGUAGEREPOSITORY_H