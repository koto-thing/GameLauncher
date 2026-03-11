#ifndef GAMELAUNCHER_ISTARTUPREPOSITORY_H
#define GAMELAUNCHER_ISTARTUPREPOSITORY_H

#include <string>

class IStartupRepository {
public:
    virtual ~IStartupRepository() = default;

    // スタートアップに登録する
    virtual void enable(const std::string &appName, const std::string &executablePath) = 0;

    // スタートアップから登録を解除する
    virtual void disable(const std::string &appName) = 0;

    // 現在登録されているか確認する
    virtual bool isEnabled(const std::string &appName) = 0;
};

#endif //GAMELAUNCHER_ISTARTUPREPOSITORY_H