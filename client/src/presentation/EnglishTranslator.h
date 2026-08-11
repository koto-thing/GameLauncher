#pragma once

#include <QTranslator>

namespace pandd {

/** @brief 日本語source stringを英語へ変換する組込みTranslator */
class EnglishTranslator final : public QTranslator {
  public:
    /** @brief 親QObjectを指定して構築する */
    explicit EnglishTranslator(QObject* parent = nullptr);

    /** @brief 画面source stringに対応する英訳を返す */
    [[nodiscard]] QString translate(const char* context, const char* sourceText,
                                    const char* disambiguation = nullptr,
                                    int number = -1) const override;
};

} // namespace pandd
