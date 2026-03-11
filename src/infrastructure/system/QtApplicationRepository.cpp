#include "QtApplicationRepository.h"
#include <QApplication>
#include <QAction>

QtApplicationRepository::QtApplicationRepository(QObject *parent)
    : QObject(parent) {

}

void QtApplicationRepository::setupTrayIcon(QWidget *mainWindow) {
    m_mainWindow = mainWindow;

    m_trayIcon = new QSystemTrayIcon(
        QIcon(":/images/tray_icon.png"),
        this
    );

    // トレイの右クリックメニューを作成
    m_trayMenu = new QMenu();

    // ランチャーを表示するアクション
    QAction *showAction = new QAction(QObject::tr("ランチャーを表示"), this);
    connect(showAction, &QAction::triggered, this, [this]() {
        m_mainWindow->showNormal();
        m_mainWindow->activateWindow();
    });

    // 終了するアクション
    QAction *quitAction = new QAction(QObject::tr("終了"), this);
    connect(quitAction, &QAction::triggered, this, [this]() {
        quit();
    });

    m_trayMenu->addAction(showAction);
    m_trayMenu->addSeparator();
    m_trayMenu->addAction(quitAction);

    m_trayIcon->setContextMenu(m_trayMenu);

    // トレイアイコンをダブルクリックで復元
    connect(m_trayIcon, &QSystemTrayIcon::activated, this,
        [this](QSystemTrayIcon::ActivationReason reason) {
            if (reason == QSystemTrayIcon::DoubleClick) {
                m_mainWindow->showNormal();
                m_mainWindow->activateWindow();
            }
        });

    m_trayIcon->show();
}

void QtApplicationRepository::minimizeToTray() {
    if (!m_trayIcon)
        return;

    m_mainWindow->hide();
    m_trayIcon->showMessage(
        QObject::tr("GameLauncher"),
        QObject::tr("トレイに最小化しました。"),
        QSystemTrayIcon::Information,
        2000
    );
}

void QtApplicationRepository::quit() {
    if (m_trayIcon)
        m_trayIcon->hide();

    QApplication::quit();
}