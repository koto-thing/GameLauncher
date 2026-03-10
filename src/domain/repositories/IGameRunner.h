#ifndef GAMELAUNCHER_IGAMERUNNER_H
#define GAMELAUNCHER_IGAMERUNNER_H

#include <string>
#include <functional>

class IGameRunner {
public:
    virtual ~IGameRunner() = default;

    virtual void setGamePath(const std::string &path) = 0;
    virtual std::string getGamePath() const = 0;
    virtual std::string getStatus() const = 0;
    virtual void launchGame() = 0;

    // Observable status change notification
    using StatusChangedCallback = std::function<void(const std::string& status)>;
    virtual void onStatusChanged(StatusChangedCallback callback) = 0;
};

#endif //GAMELAUNCHER_IGAMERUNNER_H
