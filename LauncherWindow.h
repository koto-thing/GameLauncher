#ifndef GAMELAUNCHER_LAUNCHERWINDOW_H
#define GAMELAUNCHER_LAUNCHERWINDOW_H

#include <QPushButton>
#include <QLabel>
#include <QVBoxLayout>

#include "GameRunner.h"
#include "OptionOverlay.h"

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
    void resizeEvent(QResizeEvent *event) override;

private:
    void loadStyleSheet(QWidget* widget, const QString& filePath);
    void setupUI();

    QLabel *statusLabel;
    QPushButton *launchButton;
    QVBoxLayout *mainLayout;

    // 閉じるボタンと最小化ボタンとオプションボタン
    QPushButton *m_closeButton;
    QPushButton *m_minimizeButton;
    QPushButton *m_optionButton;

    // ウィンドウ移動用
    QPoint m_dragPosition;           // ドラッグ移動計算用
    bool m_isDragging = false;       // ドラッグ中かどうか
    const int TITLE_BAR_HEIGHT = 20; // タイトルバーの高さ

    GameRunner *m_runner;
    OptionOverlay *m_optionOverlay;
};

#endif