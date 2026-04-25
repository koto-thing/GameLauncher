//
// Created by koton on 2026/04/01.
//

#ifndef GAMELAUNCHER_MAINWINDOW_H
#define GAMELAUNCHER_MAINWINDOW_H

#include <QMainWindow>
#include <memory>
#include <QLabel>
#include <QPushButton>
#include <QVBoxLayout>

#include "presenter/MainWindowPresenter.h"

class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    explicit MainWindow(QWidget* parent = nullptr);
    ~MainWindow() override = default;

    MainWindow(const MainWindow&) = delete;
    MainWindow& operator=(const MainWindow&) = delete;

    /// <summary>
    /// ステータステキストを更新する
    /// </summary>
    /// <param name="text">テキスト</param>
    void setStatusText(const QString& text);

private:
    void setupUi();
    void setupConnections();

    QPushButton* m_launchButton;
    QLabel*      m_statusLabel;
    std::unique_ptr<MainWindowPresenter> m_presenter;
};


#endif //GAMELAUNCHER_MAINWINDOW_H