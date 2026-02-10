#include <QDebug>
#include <QFileInfo>

#include "GameRunner.h"

/**
 * @brief コンストラクタ
 * @param parent 親オブジェクト
 */
GameRunner::GameRunner(QObject *parent) : QObject(parent) {
    m_status = "準備完了";
    m_process = new QProcess(this);

    // プロセスの状態が変化したときのSignal
    connect(m_process, &QProcess::started, this, [this]() {
        setStatus("ゲーム実行中...");
    });

    // ゲームが終了したときのSignal
    connect(m_process, QOverload<int, QProcess::ExitStatus>::of(&QProcess::finished),
        this, [this](int exitCode, QProcess::ExitStatus exitStatus) {

            setStatus("ゲームが終了しました。 (コード: " + QString::number(exitCode) + ")");
        });

    // エラーが発生したときのSignal
    connect(m_process, &QProcess::errorOccurred, this, [this]() {
        setStatus("起動エラーが発生しました。");
    });
}

/**
 * @brief 現在のゲームパスを取得する
 * @return ゲームパス文字列
 */
QString GameRunner::gamePath() const {
    return m_gamePath;
}

/**
 * @brief 現在のステータスを取得する
 * @return ステータス文字列
 */
QString GameRunner::status() const {
    return m_status;
}

/**
 * @brief ゲームパスを設定する
 * @param path 新しいゲームパス
 */
void GameRunner::setGamePath(const QString &path) {
    if (m_gamePath == path)
        return;

    m_gamePath = path;
    emit onGamePathChanged();
}

/**
 * @brief ステータスを設定する
 * @param newStatus 新しいステータス文字列
 */
void GameRunner::setStatus(const QString &newStatus) {
    if (m_status == newStatus)
        return;

    m_status = newStatus;
    emit onStatusChanged();
}

/**
 * @brief ゲームを起動する
 */
void GameRunner::launchGame() {
    if (m_gamePath.isEmpty()) {
        setStatus("エラー：ゲームパスが設定されていません。");
        return;
    }

    if (!QFileInfo::exists(m_gamePath)) {
        setStatus("エラー：ファイルが見つかりません。");
        return;
    }

    setStatus("起動しています...");

    // 外部のプロセスを起動
    m_process->start(m_gamePath, QStringList());
}