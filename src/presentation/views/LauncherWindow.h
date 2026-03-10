#ifndef GAMELAUNCHER_LAUNCHERWINDOW_H
#define GAMELAUNCHER_LAUNCHERWINDOW_H

#include <QWidget>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QListWidget>
#include <QPushButton>
#include <QStackedWidget>
#include <QMouseEvent>
#include <QPaintEvent>
#include <QResizeEvent>

#include "GameDetailsWidget.h"
#include "GameStoreWidget.h"
#include "OptionOverlay.h"
#include "../../domain/repositories/IGameRunner.h"

class LauncherWindow : public QWidget {
    Q_OBJECT

public:
    explicit LauncherWindow(ISettingsRepository* settings, IGameRunner* runner, QWidget *parent = nullptr);

protected:
    void mousePressEvent(QMouseEvent *event) override;
    void mouseMoveEvent(QMouseEvent *event) override;
    void mouseReleaseEvent(QMouseEvent *event) override;
    void paintEvent(QPaintEvent *event) override;
    void resizeEvent(QResizeEvent *event) override;

private:
    void loadStyleSheet(QWidget* widget, const QString& filePath);
    void setupUI();
    void showGameDetails();
    void showGameStore();

    QHBoxLayout *mainLayout;
    QVBoxLayout *gameListLayout;
    QListWidget *gameListWidget;
    QPushButton *addGameButton;
    QVBoxLayout *rightLayout;
    QStackedWidget *contentStack;

    GameDetailsWidget *m_gameDetailsView;
    GameStoreWidget *m_gameStoreView;

    QPushButton *m_closeButton;
    QPushButton *m_minimizeButton;
    QPushButton *m_optionButton;

    QPoint m_dragPosition;
    bool m_isDragging = false;
    const int TITLE_BAR_HEIGHT = 20;

    IGameRunner *m_runner;
    OptionOverlay *m_optionOverlay;
};

#endif //GAMELAUNCHER_LAUNCHERWINDOW_H
