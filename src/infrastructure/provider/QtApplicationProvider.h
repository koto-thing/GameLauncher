//
// Created by koton on 2026/04/01.
//

#ifndef GAMELAUNCHER_QTAPPLICATIONSERVICE_H
#define GAMELAUNCHER_QTAPPLICATIONSERVICE_H
#include <QApplication>
#include <QObject>
#include <memory>


class QtApplicationProvider : public QObject {
    Q_OBJECT

public:
    QtApplicationProvider(int &argc, char **argv);
    ~QtApplicationProvider() override = default;

    QtApplicationProvider(const QtApplicationProvider&) = delete;            // コピーコンストラクタを削除
    QtApplicationProvider& operator=(const QtApplicationProvider&) = delete; // コピー代入演算子を削除
    QtApplicationProvider(QtApplicationProvider&&) = delete;                 // ムーブコンストラクタを削除
    QtApplicationProvider& operator=(QtApplicationProvider&&) = delete;      // ムーブ代入演算子を削除

    /// <summary>
    /// アプリケーションのイベントループを開始
    /// </summary>
    [[nodiscard]] int run();

    /// <summary>
    /// アプリケーションを終了する
    /// </summary>
    /// <param name="exitCode">終了コード</param>
    void quit(int exitCode = 0);

    /// <summary>
    /// QSSファイルからテーマを適用する
    /// </summary>
    /// <param name="themeName">テーマ名(QSSのファイル名)</param>
    /// <returns>テーマの適用に成功したかどうか</returns>
    [[nodiscard]] bool applyTheme(const QString &themeName);

private:
    std::unique_ptr<QApplication> m_app;
};

#endif // GAMELAUNCHER_QTAPPLICATIONSERVICE_H