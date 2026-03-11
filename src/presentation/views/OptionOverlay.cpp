#include "OptionOverlay.h"
#include "SettingsPageFactory.h"
#include <QLabel>
#include <QMouseEvent>
#include <QHBoxLayout>
#include <QVBoxLayout>
#include <QScrollArea>
#include <QFile>
#include <QDebug>

OptionOverlay::OptionOverlay(QWidget *parent) : QWidget(parent) {
    hide();
    setStyleSheet("background-color: rgba(0, 0, 0, 180)");
    
    // UI要素を先に初期化
    m_contentStack = new QStackedWidget();
    setupUI();
}

void OptionOverlay::mousePressEvent(QMouseEvent *event) {
    event->accept();
}

void OptionOverlay::loadStyleSheet(QWidget *widget, const QString& filePath) {
    if (QFile file(filePath); file.open(QIODevice::ReadOnly | QIODevice::Text)) {
        widget->setStyleSheet(file.readAll());
        file.close();
    }
}

void OptionOverlay::setupUI() {
    QVBoxLayout *mainLayout = new QVBoxLayout(this);
    mainLayout->setAlignment(Qt::AlignCenter);

    m_panel = new QWidget(this);
    m_panel->setFixedSize(800, 600);
    m_panel->setObjectName("OptionPanel");
    m_panel->setAttribute(Qt::WA_StyledBackground, true);
    loadStyleSheet(m_panel, ":/styles/optionPanel.qss");

    mainLayout->addWidget(m_panel);

    QHBoxLayout *panelLayout = new QHBoxLayout(m_panel);
    panelLayout->setContentsMargins(0, 0, 0, 0);
    panelLayout->setSpacing(0);

    m_categoryList = new QListWidget(m_panel);
    m_categoryList->setFixedWidth(200);
    m_categoryList->addItem("一般");
    m_categoryList->addItem("ダウンロード");
    m_categoryList->addItem("通知");
    m_categoryList->addItem("詳細");

    panelLayout->addWidget(m_categoryList);

    QWidget *rightContainer = new QWidget(m_panel);
    rightContainer->setStyleSheet("background-color: #1e1e1e; border-top-right-radius: 12px; border-bottom-right-radius: 12px;");
    QVBoxLayout *rightLayout = new QVBoxLayout(rightContainer);
    rightLayout->setContentsMargins(0, 0, 0, 0);

    QHBoxLayout *headerLayout = new QHBoxLayout();
    headerLayout->setContentsMargins(20, 15, 15, 10);

    QLabel *settingsLabel = new QLabel("設定");
    settingsLabel->setStyleSheet("color: #888888; font-size: 14px; background-color: transparent;");
    headerLayout->addWidget(settingsLabel);
    headerLayout->addStretch();

    m_closeButton = new QPushButton("×", rightContainer);
    m_closeButton->setFixedSize(30, 30);
    m_closeButton->setStyleSheet("background-color: transparent; color: #888888; font-size: 20px; border: none;");
    connect(m_closeButton, &QPushButton::clicked, this, &QWidget::hide);
    headerLayout->addWidget(m_closeButton);

    rightLayout->addLayout(headerLayout);

    QScrollArea *scrollArea = new QScrollArea(rightContainer);
    scrollArea->setWidgetResizable(true);
    scrollArea->setFrameShape(QFrame::NoFrame);
    scrollArea->setWidget(m_contentStack); // ここで確実にセット
    rightLayout->addWidget(scrollArea);

    panelLayout->addWidget(rightContainer);

    connect(m_categoryList, &QListWidget::currentRowChanged, m_contentStack, &QStackedWidget::setCurrentIndex);
}

void OptionOverlay::setDependencies(
    ISettingsRepository *repository,
    std::shared_ptr<CheckLauncherUpdateUseCase> checkUpdateUseCase,
    std::shared_ptr<ApplyLauncherUpdateUseCase> applyUpdateUseCase
) {
    if (!repository) return;
    
    m_settings = repository;
    m_checkUpdateUseCase = std::move(checkUpdateUseCase);
    m_applyUpdateUseCase = std::move(applyUpdateUseCase);
    
    // スタックの中身を初期化
    while (m_contentStack->count() > 0) {
        QWidget* widget = m_contentStack->widget(0);
        m_contentStack->removeWidget(widget);
        delete widget;
    }

    m_contentStack->addWidget(SettingsPageFactory::createGeneralSettingsPage(m_settings));
    m_contentStack->addWidget(SettingsPageFactory::createDownloadSettingsPage(m_settings));
    m_contentStack->addWidget(SettingsPageFactory::createNotificationSettingsPage(m_settings));
    m_contentStack->addWidget(SettingsPageFactory::createDescriptionSettingsPage(m_settings, m_checkUpdateUseCase, m_applyUpdateUseCase));

    m_categoryList->setCurrentRow(0);
}
