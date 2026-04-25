//
// Created by koton on 2026/04/01.
//

#include "MainWindow.h"

#include "AppConfig.h"
#include <memory>

MainWindow::MainWindow(QWidget* parent)
    : QMainWindow(parent)
    , m_launchButton(new QPushButton("Launch Button", this))
    , m_statusLabel(new QLabel("Ready", this))
    , m_presenter(std::make_unique<MainWindowPresenter>(this)) {
    setWindowTitle(QString::fromUtf8(AppConfig::kAppName.data()));
    setMinimumSize(800, 600);
    setupUi();
    setupConnections();
}

void MainWindow::setupUi() {

}

void MainWindow::setupConnections() {
    connect(m_launchButton, &QPushButton::clicked,
        this, [this]() {
            m_presenter->onLaunchClicked();
        });
}

void MainWindow::setStatusText(const QString& text) {
    m_statusLabel->setText(text);
}
