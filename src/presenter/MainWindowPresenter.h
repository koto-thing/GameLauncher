//
// Created by koton on 2026/04/01.
//

#ifndef GAMELAUNCHER_MAINWINDOWPRESENTER_H
#define GAMELAUNCHER_MAINWINDOWPRESENTER_H

class MainWindow;

class MainWindowPresenter {
public:
    explicit MainWindowPresenter(MainWindow* view);
    ~MainWindowPresenter() = default;

    MainWindowPresenter(const MainWindowPresenter&) = delete;
    MainWindowPresenter& operator=(const MainWindowPresenter&) = delete;

    void onLaunchClicked();

private:
    MainWindow* m_view;
};


#endif //GAMELAUNCHER_MAINWINDOWPRESENTER_H