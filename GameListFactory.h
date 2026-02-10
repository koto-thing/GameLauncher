#ifndef GAMELAUNCHER_GAMELISTFACTORY_H
#define GAMELAUNCHER_GAMELISTFACTORY_H

#include <QListWidget>

#include "GameListItemWidget.h"

/**
 * @brief メイン画面左側のゲーム一覧のファクトリクラス
 */
class GameListFactory {
public:
    static QListWidgetItem* createGameListItem(const QString& gameTitle, const QString& gameIconPath);
    static void addGameItemWithWidget(QListWidget* listWidget, const QString& gameTitle, const QString& gameIconPath);
};

#endif