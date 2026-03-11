#ifndef GAMELAUNCHER_OPTIONOVERLAY_H
#define GAMELAUNCHER_OPTIONOVERLAY_H

#include <QWidget>
#include <QPushButton>
#include <QListWidget>
#include <QStackedWidget>
#include <memory>
#include "../../domain/repositories/ISettingsRepository.h"
#include "../../application/usecases/CheckLauncherUpdateUseCase.h"
#include "../../application/usecases/ApplyLauncherUpdateUseCase.h"

class OptionOverlay : public QWidget {
    Q_OBJECT

public:
    explicit OptionOverlay(QWidget *parent = nullptr);
    void setDependencies(
        ISettingsRepository *repository,
        std::shared_ptr<CheckLauncherUpdateUseCase> checkUpdateUseCase,
        std::shared_ptr<ApplyLauncherUpdateUseCase> applyUpdateUseCase
    );

protected:
    void mousePressEvent(QMouseEvent *event) override;

private:
    void loadStyleSheet(QWidget *widget, const QString& filePath);
    void setupUI();

    QWidget *m_panel = nullptr;
    QPushButton *m_closeButton = nullptr;
    QListWidget *m_categoryList = nullptr;
    QStackedWidget *m_contentStack = nullptr;
    ISettingsRepository *m_settings = nullptr;
    std::shared_ptr<CheckLauncherUpdateUseCase> m_checkUpdateUseCase;
    std::shared_ptr<ApplyLauncherUpdateUseCase> m_applyUpdateUseCase;
};

#endif //GAMELAUNCHER_OPTIONOVERLAY_H
