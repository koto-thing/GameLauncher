#ifndef GAMELAUNCHER_IAPPLICATIONREPOSITORY_H
#define GAMELAUNCHER_IAPPLICATIONREPOSITORY_H

#include "../entities/CloseAction.h"

class IApplicationRepository {
public:
    virtual ~IApplicationRepository() = default;

    // アプリケーションを完全に終了する
    virtual void quit() = 0;

    // ウィンドウを最小化する
    virtual void minimizeToTray() = 0;
};

#endif //GAMELAUNCHER_IAPPLICATIONREPOSITORY_H