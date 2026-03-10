#ifndef GAMELAUNCHER_OPTIONOVERLAY_H
#define GAMELAUNCHER_OPTIONOVERLAY_H

#include <QWidget>
#include <QPushButton>
#include <QListWidget>
#include <QStackedWidget>
#include "../../domain/repositories/ISettingsRepository.h"

class OptionOverlay : public QWidget {
    Q_OBJECT

public:
    explicit OptionOverlay(QWidget *parent = nullptr);
    void setSettingsRepository(ISettingsRepository *repository);

protected:
    void mousePressEvent(QMouseEvent *event) override;

private:
    void loadStyleSheet(QWidget *widget, const QString& filePath);
    void setupUI();

    QWidget *m_panel;
    QPushButton *m_closeButton;
    QListWidget *m_categoryList;
    QStackedWidget *m_contentStack;
    ISettingsRepository *m_settings = nullptr;
};

#endif //GAMELAUNCHER_OPTIONOVERLAY_H
