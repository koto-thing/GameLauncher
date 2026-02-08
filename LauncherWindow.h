#ifndef GAMELAUNCHER_LAUNCHERWINDOW_H
#define GAMELAUNCHER_LAUNCHERWINDOW_H

#include <QPushButton>
#include <QLabel>
#include <QVBoxLayout>

#include "GameRunner.h"

class LauncherWindow : public QWidget {
    Q_OBJECT

public:
    // コンストラクタ
    explicit LauncherWindow(QWidget *parent = nullptr);

private:
    QLabel *statusLabel;
    QPushButton *launchButton;
    QVBoxLayout *mainLayout;

    GameRunner *m_runner;
};

#endif