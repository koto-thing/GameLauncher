#ifndef GAMELAUNCHER_ILAUNCHERUPDATEREPOSITORY_H
#define GAMELAUNCHER_ILAUNCHERUPDATEREPOSITORY_H

#include "../entities/LauncherUpdateInfo.h"
#include <functional>
#include <string>

using UpdateInfoCallback = std::function<void(const LauncherUpdateInfo&)>;
using ErrorCallback = std::function<void(const std::string&)>;

class ILauncherUpdateRepository {
public:
    virtual ~ILauncherUpdateRepository() = default;

    // QtIFWのmaintenancetool.exeを使用してアップデートをチェックする
    virtual void checkUpdateWithMaintenanceTool(
        const std::string  &toolPath,
        UpdateInfoCallback onSuccess,
        ErrorCallback      onError
    ) = 0;

    // maintenancetool.exeを起動してアップデートプロセスを開始する
    virtual void runMaintenanceTool(
        const std::string  &toolPath,
        bool               silent,
        std::function<void()> onStarted,
        ErrorCallback      onError
    ) = 0;

    // 互換性維持のための既存メソッド（後ほど移行が完了したら削除検討）
    virtual void fetchUpdateInfo(
        const std::string  &manifestUrl,
        const std::string  &currentVersion,
        UpdateInfoCallback onSuccess,
        ErrorCallback      onError
    ) = 0;

    virtual void downloadAndApply(
        const LauncherUpdateInfo                &updateInfo,
        std::function<void(int)>                onProgress,
        std::function<void(const std::string&)> onFinished,
        ErrorCallback                           onError
    ) = 0;
};

#endif //GAMELAUNCHER_ILAUNCHERUPDATEREPOSITORY_H