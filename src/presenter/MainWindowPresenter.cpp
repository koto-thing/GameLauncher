//
// Created by koton on 2026/04/01.
//

#include "MainWindowPresenter.h"
#include "view/MainWindow.h"

MainWindowPresenter::MainWindowPresenter(MainWindow* view)
    : m_view(view) {

}

void MainWindowPresenter::onLaunchClicked() {
    m_view->setStatusText("Launching...");
}