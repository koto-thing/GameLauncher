#include "QtGameRunner.h"
#include <QFileInfo>

QtGameRunner::QtGameRunner(QObject *parent) : QObject(parent) {
    m_status = "準備完了";
    m_process = new QProcess(this);

    connect(m_process, &QProcess::started, this, [this]() {
        setStatus("ゲーム実行中...");
    });

    connect(m_process, QOverload<int, QProcess::ExitStatus>::of(&QProcess::finished),
        this, [this](int exitCode, QProcess::ExitStatus) {
            setStatus("ゲームが終了しました。 (コード: " + QString::number(exitCode) + ")");
        });

    connect(m_process, &QProcess::errorOccurred, this, [this]() {
        setStatus("起動エラーが発生しました。");
    });
}

void QtGameRunner::setGamePath(const std::string &path) {
    QString qpath = QString::fromStdString(path);
    if (m_gamePath != qpath) {
        m_gamePath = qpath;
    }
}

void QtGameRunner::launchGame() {
    if (m_gamePath.isEmpty()) {
        setStatus("エラー：ゲームパスが設定されていません。");
        return;
    }

    if (!QFileInfo::exists(m_gamePath)) {
        setStatus("エラー：ファイルが見つかりません。");
        return;
    }

    setStatus("起動しています...");
    m_process->start(m_gamePath, QStringList());
}

void QtGameRunner::onStatusChanged(StatusChangedCallback callback) {
    m_callbacks.push_back(callback);
}

void QtGameRunner::setStatus(const QString &newStatus) {
    if (m_status != newStatus) {
        m_status = newStatus;
        emit statusChanged(m_status);
        std::string sStatus = m_status.toStdString();
        for (auto& callback : m_callbacks) {
            callback(sStatus);
        }
    }
}
