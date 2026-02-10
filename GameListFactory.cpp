#include "GameListFactory.h"

/**
 * @brief ゲーム一覧アイテムを作成
 * @param gameTitle ゲームタイトル
 * @param gameIconPath ゲームアイコンのパス
 * @return ゲーム一覧アイテム
 */
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

/**
 * @brief カスタムウィジェットを使用してゲームアイテムを追加
 * @param listWidget リストウィジェット
 * @param gameTitle ゲームタイトル
 * @param gameIconPath ゲームアイコンのパス
 */
void GameListFactory::addGameItemWithWidget(QListWidget* listWidget, const QString& gameTitle, const QString& gameIconPath) {
    auto *item = new QListWidgetItem(listWidget);
    item->setSizeHint(QSize(0, 60)); // アイテムの高さを設定

    auto *widget = new GameListItemWidget(gameTitle, gameIconPath);
    listWidget->setItemWidget(item, widget);
}

