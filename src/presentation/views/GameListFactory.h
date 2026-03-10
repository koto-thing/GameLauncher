#ifndef GAMELAUNCHER_GAMELISTFACTORY_H
#define GAMELAUNCHER_GAMELISTFACTORY_H

#include <QListWidget>

class GameListFactory {
public:
    static QListWidgetItem* createGameListItem(const QString& gameTitle, const QString& gameIconPath);
    static void addGameItemWithWidget(QListWidget* listWidget, const QString& gameTitle, const QString& gameIconPath);
};

#endif // GAMELAUNCHER_GAMELISTFACTORY_H
