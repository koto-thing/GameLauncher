#ifndef GAMELAUNCHER_QTAPPLICATIONREPOSITORY_H
#define GAMELAUNCHER_QTAPPLICATIONREPOSITORY_H

#include "../../domain/repositories/IApplicationRepository.h"
#include <QSystemTrayIcon>
#include <QMenu>
#include <QAction>

class QtApplicationRepository : public QObject, public IApplicationRepository {
    Q_OBJECT
public:
    explicit QtApplicationRepository(QObject *parent = nullptr);

    void quit() override;
    void minimizeToTray() override;

    // トレイアイコンを初期化する
    void setupTrayIcon(QWidget *mainWindow);

private:
    QSystemTrayIcon *m_trayIcon = nullptr;
    QMenu *m_trayMenu           = nullptr;
    QWidget *m_mainWindow       = nullptr;
};


#endif //GAMELAUNCHER_QTAPPLICATIONREPOSITORY_H