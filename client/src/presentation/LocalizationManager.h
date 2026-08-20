#pragma once

#include <QString>
#include <QVector>

class QApplication;
class QTranslator;

namespace pandd {

/** @brief UIで選択可能な言語情報 */
struct SupportedLocale {
    /** @brief BCP 47形式の言語tag */
    QString code;

    /** @brief 言語選択欄へ表示する言語自身の名称 */
    QString nativeName;
};

/** @brief 同梱locale registryを読み込む */
[[nodiscard]] QVector<SupportedLocale> supportedLocales();

/** @brief 選択言語のQt翻訳を適用し、未同梱時は日本語へ戻す */
[[nodiscard]] bool installApplicationTranslation(QApplication& application, QTranslator& translator,
                                                 const QString& locale);

} // namespace pandd
