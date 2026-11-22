#pragma once

class QApplication;

namespace pandd {

/**
 * @brief 同梱フォントを登録してアプリケーション既定フォントへ設定する
 * @param application 既定フォントを設定するアプリケーション
 * @note 戻り値なし
 * @note フォントを登録できない場合は警告を記録する
 */
void installApplicationFonts(QApplication& application);

} // namespace pandd
