#ifndef GAMELAUNCHER_GAMEDETAILSWIDGET_H
#define GAMELAUNCHER_GAMEDETAILSWIDGET_H

#include <QWidget>
#include <QLabel>
#include <QPushButton>
#include <QVBoxLayout>
#include "GameRunner.h"

/**
 * @brief ゲーム詳細画面を管理するウィジェット
 */
class GameDetailsWidget : public QWidget {
    Q_OBJECT

public:
    explicit GameDetailsWidget(QWidget *parent = nullptr);
    void setGameRunner(GameRunner *runner);

private:
    void setupUI();

    QLabel *m_statusLabel;
    QPushButton *m_launchButton;
    GameRunner *m_runner = nullptr;
};

#endif // GAMELAUNCHER_GAMEDETAILSWIDGET_H

