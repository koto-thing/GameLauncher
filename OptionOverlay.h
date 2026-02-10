#ifndef GAMELAUNCHER_OPTIONOVERLAY_H
#define GAMELAUNCHER_OPTIONOVERLAY_H

#include <QPushButton>
#include <QWidget>
#include <QListWidget>
#include <QStackedWidget>

class OptionOverlay : public QWidget {
    Q_OBJECT

public:
    explicit OptionOverlay(QWidget *parent = nullptr);

protected:
    void mousePressEvent(QMouseEvent *event) override;

private:
    void loadStyleSheet(QWidget *widget, const QString& filePath);
    void setupUI();

    // 中央パネルと閉じるボタン
    QWidget *m_panel;
    QPushButton *m_closeButton;

    // 左右のウィジェット
    QListWidget *m_categoryList;
    QStackedWidget *m_contentStack;
};

#endif