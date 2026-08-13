#pragma once

#include <QString>
#include <QVector>

class QApplication;
class QTranslator;

namespace pandd {

struct SupportedLocale {
    QString code;
    QString nativeName;
};

/** @brief 同梱locale registryを読み込む */
[[nodiscard]] QVector<SupportedLocale> supportedLocales();

/** @brief 選択言語のQt翻訳を適用し、未同梱時は日本語へ戻す */
[[nodiscard]] bool installApplicationTranslation(QApplication& application, QTranslator& translator,
                                                 const QString& locale);

} // namespace pandd
