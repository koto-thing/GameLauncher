#include "OptionOverlay.h"
#include "SettingsPageFactory.h"
#include "../../infrastructure/storage/QtSettingsRepository.h"
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
    setupUI();
}

void OptionOverlay::mousePressEvent(QMouseEvent *event) {
    event->accept();
}

void OptionOverlay::loadStyleSheet(QWidget *widget, const QString& filePath) {
    if (QFile file(filePath); file.open(QIODevice::ReadOnly | QIODevice::Text)) {
        widget->setStyleSheet(file.readAll());
        file.close();
    } else {
        qDebug() << "Error: Could not open stylesheet file:" << filePath;
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
    settingsLabel->setStyleSheet("color: #888888; font-size: 14px; font-weight: normal; background-color: transparent;");
    headerLayout->addWidget(settingsLabel);
    headerLayout->addStretch();

    m_closeButton = new QPushButton("×", rightContainer);
    m_closeButton->setFixedSize(30, 30);
    m_closeButton->setCursor(Qt::PointingHandCursor);
    m_closeButton->setStyleSheet("background-color: transparent; color: #888888; font-weight: bold; font-size: 20px; border: none;");
    connect(m_closeButton, &QPushButton::clicked, this, &QWidget::hide);
    headerLayout->addWidget(m_closeButton);

    rightLayout->addLayout(headerLayout);

    QScrollArea *scrollArea = new QScrollArea(rightContainer);
    scrollArea->setWidgetResizable(true);
    scrollArea->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    scrollArea->setVerticalScrollBarPolicy(Qt::ScrollBarAsNeeded);
    scrollArea->setFrameShape(QFrame::NoFrame);
    scrollArea->setStyleSheet("QScrollArea { background-color: transparent; border: none; }");

    m_contentStack = new QStackedWidget();

    // Default to infrastructure if none provided yet, or wait for setSettingsRepository
    // For now, let's just initialize the pages if settings is available
}

void OptionOverlay::setSettingsRepository(ISettingsRepository *repository) {
    m_settings = repository;
    if (m_settings) {
        // Clear previous widgets if any
        while (m_contentStack->count() > 0) {
            QWidget* widget = m_contentStack->widget(0);
            m_contentStack->removeWidget(widget);
            delete widget;
        }

        m_contentStack->addWidget(SettingsPageFactory::createGeneralSettingsPage(m_settings));
        m_contentStack->addWidget(SettingsPageFactory::createDownloadSettingsPage(m_settings));
        m_contentStack->addWidget(SettingsPageFactory::createNotificationSettingsPage(m_settings));
        m_contentStack->addWidget(SettingsPageFactory::createDescriptionSettingsPage());

        QScrollArea* scrollArea = qobject_cast<QScrollArea*>(m_contentStack->parentWidget()->parentWidget());
        if (scrollArea) {
             scrollArea->setWidget(m_contentStack);
        } else {
            // Find scroll area in right container layout
            QVBoxLayout* rightLayout = qobject_cast<QVBoxLayout*>(m_panel->layout()->itemAt(1)->widget()->layout());
            if (rightLayout) {
                QScrollArea* sa = new QScrollArea();
                sa->setWidgetResizable(true);
                sa->setWidget(m_contentStack);
                rightLayout->addWidget(sa);
            }
        }

        connect(m_categoryList, &QListWidget::currentRowChanged, m_contentStack, &QStackedWidget::setCurrentIndex);
        m_categoryList->setCurrentRow(0);
    }
}
