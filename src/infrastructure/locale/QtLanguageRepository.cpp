#include "QtLanguageRepository.h"
#include <QCoreApplication>
#include <QFile>
#include <stdexcept>

QtLanguageRepository::QtLanguageRepository(const QString &translationDir)
    : m_translationDir(translationDir)
    , m_currentLanguage("ja")
    , m_translator(std::make_unique<QTranslator>()) {

}

void QtLanguageRepository::applyLanguage(const std::string& languageCode) {
    QString code = QString::fromStdString(languageCode);
    QString qmPath = m_translationDir + "/launcher_" + code + ".qm";

    // .qmファイルが存在するか確認
    if (!QFile::exists(qmPath)) {
        throw std::runtime_error("Translation file not found: " + qmPath.toStdString());
    }

    // 既存のTranslatorを一旦外す
    QCoreApplication::removeTranslator(m_translator.get());

    // 新しい言語をロードして適用
    if (!m_translator->load(qmPath)) {
        throw std::runtime_error("Failed to load translation file: " + qmPath.toStdString());
    }

    QCoreApplication::installTranslator(m_translator.get());
    m_currentLanguage = languageCode;
}

std::string QtLanguageRepository::currentLanguage() const {
    return m_currentLanguage;
}

std::vector<std::string> QtLanguageRepository::availableLanguages() const {
    return { "ja", "en", "zh_CN", "ko" };
}