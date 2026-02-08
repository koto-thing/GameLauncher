#ifndef GAMELAUNCHER_GAMERUNNER_H
#define GAMELAUNCHER_GAMERUNNER_H

#include <QObject>
#include <QProcess>

class GameRunner : public QObject {
    Q_OBJECT

    // ゲームのパス
    Q_PROPERTY(QString gamePath READ gamePath WRITE setGamePath NOTIFY onGamePathChanged)

    // 現在の状態
    Q_PROPERTY(QString status READ status NOTIFY onStatusChanged)

public:
    explicit GameRunner(QObject *parent = nullptr);

    // Getter
    QString gamePath() const;
    QString status() const;

    // Setter
    void setGamePath(const QString &path);

    Q_INVOKABLE void launchGame();

signals:
    // プロパティ変更通知シグナル
    void onGamePathChanged();
    void onStatusChanged();

private:
    QString m_gamePath;
    QString m_status;
    QProcess *m_process;

    void setStatus(const QString &newStatus);
};

#endif