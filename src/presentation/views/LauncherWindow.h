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
#include "../di/AppContainer.h"

class LauncherWindow : public QWidget {
    Q_OBJECT

public:
    explicit LauncherWindow(AppContainer* container, QWidget *parent = nullptr);

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

    QHBoxLayout *mainLayout = nullptr;
    QVBoxLayout *gameListLayout = nullptr;
    QListWidget *gameListWidget = nullptr;
    QPushButton *addGameButton = nullptr;
    QVBoxLayout *rightLayout = nullptr;
    QStackedWidget *contentStack = nullptr;

    GameDetailsWidget *m_gameDetailsView = nullptr;
    GameStoreWidget *m_gameStoreView = nullptr;

    QPushButton *m_closeButton = nullptr;
    QPushButton *m_minimizeButton = nullptr;
    QPushButton *m_optionButton = nullptr;

    QPoint m_dragPosition;
    bool m_isDragging = false;
    const int TITLE_BAR_HEIGHT = 20;

    IGameRunner *m_runner = nullptr;
    OptionOverlay *m_optionOverlay = nullptr;
};

#endif //GAMELAUNCHER_LAUNCHERWINDOW_H
