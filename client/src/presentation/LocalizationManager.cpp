#include "presentation/LocalizationManager.h"

#include "application/Localization.h"

#include <QApplication>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTranslator>

namespace pandd {

QVector<SupportedLocale> supportedLocales() {
    // resource内の言語registryを読み込み失敗時は日本語だけを提供
    QFile file(":/i18n/locales.json");
    if (!file.open(QIODevice::ReadOnly)) {
        return {{"ja-JP", QString::fromUtf8("日本語")}};
    }
    // 表示名と安全な言語tagを持つ項目だけを採用
    const auto document = QJsonDocument::fromJson(file.readAll());
    QVector<SupportedLocale> result;
    for (const auto& value : document.array()) {
        const auto object = value.toObject();
        const auto code = object.value("code").toString();
        const auto name = object.value("nativeName").toString();
        if (!code.isEmpty() && !name.isEmpty() && isValidLocaleTag(code.toStdString())) {
            result.push_back(SupportedLocale{code, name});
        }
    }
    return result.isEmpty() ? QVector<SupportedLocale>{{"ja-JP", QString::fromUtf8("日本語")}}
                            : result;
}

bool installApplicationTranslation(QApplication& application, QTranslator& translator,
                                   const QString& locale) {
    // 適用済みtranslatorを外して二重翻訳を防止
    application.removeTranslator(&translator);
    if (locale == "ja-JP") {
        return true;
    }
    // 選択言語の同梱catalogを読み込んでApplicationへ登録
    if (!translator.load(QString(":/i18n/launcher_%1.qm").arg(locale))) {
        return false;
    }
    return application.installTranslator(&translator);
}

} // namespace pandd
