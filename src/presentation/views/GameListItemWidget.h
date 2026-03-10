#ifndef GAMELAUNCHER_GAMELISTITEMWIDGET_H
#define GAMELAUNCHER_GAMELISTITEMWIDGET_H

#include <QWidget>
#include <QLabel>
#include <QHBoxLayout>

class GameListItemWidget : public QWidget {
    Q_OBJECT

public:
    explicit GameListItemWidget(const QString& gameTitle, const QString& gameIconPath, QWidget *parent = nullptr);

private:
    QLabel *m_iconLabel;
    QLabel *m_separatorLine;
    QLabel *m_titleLabel;
    QHBoxLayout *m_layout;
};

#endif // GAMELAUNCHER_GAMELISTITEMWIDGET_H
