#ifndef GAMELAUNCHER_GAMEDETAILSWIDGET_H
#define GAMELAUNCHER_GAMEDETAILSWIDGET_H

#include <QWidget>
#include <QLabel>
#include <QPushButton>
#include <QVBoxLayout>
#include "../../domain/repositories/IGameRunner.h"

class GameDetailsWidget : public QWidget {
    Q_OBJECT

public:
    explicit GameDetailsWidget(QWidget *parent = nullptr);
    void setGameRunner(IGameRunner *runner);

private slots:
    void handleLaunchClicked();

private:
    void setupUI();
    void updateStatus(const std::string& status);

    QLabel *m_titleLabel;
    QLabel *m_statusLabel;
    QPushButton *m_launchButton;
    IGameRunner *m_runner = nullptr;
};

#endif //GAMELAUNCHER_GAMEDETAILSWIDGET_H
