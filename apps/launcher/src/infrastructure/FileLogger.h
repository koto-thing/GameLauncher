#pragma once

#include <QString>

namespace pandd {

/** @brief 機密queryを除外するローテーションファイルログ */
class FileLogger final {
  public:
    /** @brief OS標準log directoryへhandlerを導入する */
    static void install();

    /** @brief 診断情報としてlog directoryを返す */
    [[nodiscard]] static QString logDirectory();

  private:
    /** @brief Qt messageを日次logへ書き込む */
    static void messageHandler(QtMsgType type, const QMessageLogContext& context,
                               const QString& message);

    /** @brief サイズ超過logを最大3世代へローテーションする */
    static void rotateIfNeeded(const QString& path);
};

} // namespace pandd
