#pragma once

class QApplication;

namespace pandd {

/**
 * @brief 同梱フォントを登録してアプリケーション既定フォントへ設定する
 * @param application 既定フォントを設定するアプリケーション
 * @return 戻り値なし。登録できないフォントは警告を記録し、OS既定フォントのまま続行する
 */
void installApplicationFonts(QApplication& application);

} // namespace pandd
