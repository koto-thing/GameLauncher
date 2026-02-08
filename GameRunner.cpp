#include <QDebug>
#include <QFileInfo>

#include "GameRunner.h"

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

/* ---Getter--- */
QString GameRunner::gamePath() const {
    return m_gamePath;
}

QString GameRunner::status() const {
    return m_status;
}

/* ---Setter--- */
void GameRunner::setGamePath(const QString &path) {
    if (m_gamePath == path)
        return;

    m_gamePath = path;
    emit onGamePathChanged();
}

void GameRunner::setStatus(const QString &newStatus) {
    if (m_status == newStatus)
        return;

    m_status = newStatus;
    emit onStatusChanged();
}

/* ---内部動作--- */
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