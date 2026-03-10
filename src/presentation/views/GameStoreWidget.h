#ifndef GAMELAUNCHER_GAMESTOREWIDGET_H
#define GAMELAUNCHER_GAMESTOREWIDGET_H

#include <QWidget>
#include <QStackedWidget>
#include <QPushButton>
#include <QHBoxLayout>
#include <QVBoxLayout>
#include <QLabel>

class GameStoreWidget : public QWidget {
    Q_OBJECT

public:
    explicit GameStoreWidget(QWidget *parent = nullptr);

private:
    void setupUI();
    QWidget* createGameCard(const QString& gameName);
    void previousPage();
    void nextPage();
    void updateNavigationButtons();
    void updatePageIndicators();

    QStackedWidget *m_gamePageStack;
    QPushButton *m_prevPageBtn;
    QPushButton *m_nextPageBtn;
    QHBoxLayout *m_pageIndicatorLayout;
    int m_currentPage;
    int m_totalPages;
};

#endif // GAMELAUNCHER_GAMESTOREWIDGET_H
