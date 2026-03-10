#ifndef GAMELAUNCHER_QTGAMERUNNER_H
#define GAMELAUNCHER_QTGAMERUNNER_H

#include "../../domain/repositories/IGameRunner.h"
#include <QObject>
#include <QProcess>
#include <vector>

class QtGameRunner : public QObject, public IGameRunner {
    Q_OBJECT
public:
    explicit QtGameRunner(QObject *parent = nullptr);

    void setGamePath(const std::string &path) override;
    std::string getGamePath() const override { return m_gamePath.toStdString(); }
    std::string getStatus() const override { return m_status.toStdString(); }
    void launchGame() override;

    void onStatusChanged(StatusChangedCallback callback) override;

signals:
    void statusChanged(const QString& status);

private:
    QString m_gamePath;
    QString m_status;
    QProcess *m_process;

    void setStatus(const QString &newStatus);
    std::vector<StatusChangedCallback> m_callbacks;
};

#endif //GAMELAUNCHER_QTGAMERUNNER_H
