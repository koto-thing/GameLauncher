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

protected:
    void mousePressEvent(QMouseEvent *event) override;
    void mouseMoveEvent(QMouseEvent *event) override;
    void mouseReleaseEvent(QMouseEvent *event) override;
    void paintEvent(QPaintEvent *event) override;

private:
    QLabel *statusLabel;
    QPushButton *launchButton;
    QVBoxLayout *mainLayout;

    // 閉じるボタンと最小化ボタン
    QPushButton *closeButton;
    QPushButton *minimizeButton;

    // ウィンドウ移動用
    QPoint m_dragPosition;           // ドラッグ移動計算用
    bool m_isDragging = false;       // ドラッグ中かどうか
    const int TITLE_BAR_HEIGHT = 20; // タイトルバーの高さ

    GameRunner *m_runner;
};

#endif