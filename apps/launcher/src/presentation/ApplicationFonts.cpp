#include "presentation/ApplicationFonts.h"

#include <QApplication>
#include <QDebug>
#include <QFont>
#include <QFontDatabase>

namespace pandd {

/**
 * @brief 同梱フォントを登録してアプリケーション既定フォントへ設定する
 * @param application 既定フォントを設定するアプリケーション
 * @note 戻り値なし
 * @note フォントを登録できない場合は警告を記録する
 */
void installApplicationFonts(QApplication& application) {
    // 本文用と英数アクセント用の可変フォントを登録する
    for (const auto* path : {":/fonts/MPLUS2-Variable.ttf", ":/fonts/Saira-Variable.ttf"}) {
        if (QFontDatabase::addApplicationFont(QString::fromLatin1(path)) < 0) {
            qWarning() << "Cannot register bundled font:" << path;
        }
    }

    // 本文用フォントを全widgetの既定にする
    QFont font(QStringLiteral("M PLUS 2"), 10);
    font.setHintingPreference(QFont::PreferNoHinting);
    application.setFont(font);
}

} // namespace pandd
