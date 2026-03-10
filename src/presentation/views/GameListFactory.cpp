#include "GameListFactory.h"
#include "GameListItemWidget.h"
#include <QIcon>

QListWidgetItem* GameListFactory::createGameListItem(const QString& gameTitle, const QString& gameIconPath) {
    auto *item = new QListWidgetItem();
    if (!gameTitle.isEmpty()) {
        if (gameTitle.size() > 9)
            item->setText(gameTitle.left(6) + "...");
        else
            item->setText(gameTitle);
    }
    if (!gameIconPath.isEmpty())
        item->setIcon(QIcon(gameIconPath));
    return item;
}

void GameListFactory::addGameItemWithWidget(QListWidget* listWidget, const QString& gameTitle, const QString& gameIconPath) {
    auto *item = new QListWidgetItem(listWidget);
    item->setSizeHint(QSize(0, 60));
    auto *widget = new GameListItemWidget(gameTitle, gameIconPath);
    listWidget->setItemWidget(item, widget);
}
