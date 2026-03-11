#include "ApplyLauncherUpdateUseCase.h"

ApplyLauncherUpdateUseCase::ApplyLauncherUpdateUseCase(
    std::shared_ptr<ILauncherUpdateRepository> updateRepo,
    std::shared_ptr<ISettingsRepository> settingsRepo)
        : m_updateRepo(std::move(updateRepo))
        , m_settingsRepo(std::move(settingsRepo)) {

}

void ApplyLauncherUpdateUseCase::execute(
    const std::string &manifestUrl,
    std::function<void(UpdateCheckResultDto)> onResult,
    std::function<void(const std::string &)> onError
) {
    // QtIFWのMaintenanceToolを起動して自身のプロセスを終了
    m_updateRepo->runMaintenanceTool(
        "", // デフォルトのパスを使用
        false, // silent=false: UIを表示してユーザーに操作を委ねる
        [this, onResult]() {
            UpdateCheckResultDto result;
            result.hasUpdate = true;
            result.autoUpdate = m_settingsRepo->isAutoUpdateEnabled();
            onResult(result);
            // TODO: ここでアプリを終了させる
        },
        onError
    );
}
