#include "GameListItemWidget.h"
#include <QPixmap>

GameListItemWidget::GameListItemWidget(const QString& gameTitle, const QString& gameIconPath, QWidget *parent)
    : QWidget(parent) {

    m_layout = new QHBoxLayout(this);
    m_layout->setContentsMargins(8, 8, 8, 8);
    m_layout->setSpacing(10);

    m_iconLabel = new QLabel(this);
    if (!gameIconPath.isEmpty()) {
        QPixmap iconPixmap(gameIconPath);
        m_iconLabel->setPixmap(iconPixmap.scaled(32, 32, Qt::KeepAspectRatio, Qt::SmoothTransformation));
    }
    m_iconLabel->setFixedSize(32, 32);
    m_layout->addWidget(m_iconLabel);

    m_separatorLine = new QLabel(this);
    m_separatorLine->setFixedSize(2, 32);
    m_separatorLine->setStyleSheet("background-color: white;");
    m_layout->addWidget(m_separatorLine);

    m_titleLabel = new QLabel(this);
    QString displayTitle = gameTitle;
    if (gameTitle.size() > 9) {
        displayTitle = gameTitle.left(6) + "...";
    }
    m_titleLabel->setText(displayTitle);
    m_titleLabel->setStyleSheet("color: white;");
    m_layout->addWidget(m_titleLabel);

    m_layout->addStretch();
    setStyleSheet("QWidget { background-color: transparent; }");
}
