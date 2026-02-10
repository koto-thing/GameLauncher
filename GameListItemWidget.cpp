#include "GameListItemWidget.h"
#include <QFrame>

/**
 * @brief コンストラクタ
 * @param gameTitle ゲームタイトル
 * @param gameIconPath ゲームアイコンのパス
 * @param parent 親ウィジェット
 */
GameListItemWidget::GameListItemWidget(const QString& gameTitle, const QString& gameIconPath, QWidget *parent)
    : QWidget(parent) {

    m_layout = new QHBoxLayout(this);
    m_layout->setContentsMargins(8, 8, 8, 8);
    m_layout->setSpacing(10);

    // アイコンラベル
    m_iconLabel = new QLabel(this);
    if (!gameIconPath.isEmpty()) {
        QPixmap iconPixmap(gameIconPath);
        m_iconLabel->setPixmap(iconPixmap.scaled(32, 32, Qt::KeepAspectRatio, Qt::SmoothTransformation));
    }
    m_iconLabel->setFixedSize(32, 32);
    m_layout->addWidget(m_iconLabel);

    // セパレーターライン
    m_separatorLine = new QLabel(this);
    m_separatorLine->setProperty("class", "GameListItemSeparator");
    m_separatorLine->setFixedSize(2, 32); // 高さをアイコンと同じに
    m_layout->addWidget(m_separatorLine);

    // タイトルラベル
    m_titleLabel = new QLabel(this);
    m_titleLabel->setProperty("class", "GameListItemTitle");
    QString displayTitle = gameTitle;
    if (gameTitle.size() > 9) {
        displayTitle = gameTitle.left(6) + "...";
    }
    m_titleLabel->setText(displayTitle);
    m_layout->addWidget(m_titleLabel);

    // 右側のスペースを追加
    m_layout->addStretch();

    // ウィジェット全体の背景を透明に
    setProperty("class", "GameListItem");
    setStyleSheet("QWidget { background-color: transparent; }");
}

