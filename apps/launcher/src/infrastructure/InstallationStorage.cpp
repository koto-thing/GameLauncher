#include "infrastructure/InstallationStorage.h"

#include "pandd-launcher-rust/src/lib.rs.h"
#include <QDebug>

namespace pandd::InstallationStorage {
namespace {

/** @brief 確定後の清掃警告と操作失敗を区別してアプリへ返す */
OperationResult result(const manifest_bridge::IoStatus& status) {
    if (status.code == 0) {
        if (!status.detail.empty()) {
            qWarning().noquote() << QString::fromStdString(std::string(status.detail));
        }
        return OperationResult::success();
    }
    return OperationResult::failure({ErrorCode::InstallPermissionDenied,
                                     "ゲームの配置または一時データの整理に失敗しました",
                                     std::string(status.detail), true});
}

} // namespace

/** @brief stagingの配置とactive markerの確定をRustへ委譲する */
OperationResult activate(const GameRelease& release, const QString& gameRoot, bool imported) {
    return result(manifest_bridge::activate_install(gameRoot.toStdString(), release.gameId.value(),
                                                    release.version.value(), release.entrypoint,
                                                    imported));
}

/** @brief 有効版と復旧用データを保持して一時領域を整理する */
OperationResult cleanup(const InstalledGame& installed) {
    return result(manifest_bridge::cleanup_install(installed.gameRoot, installed.gameId.value()));
}

/** @brief 失敗した操作のstagingを管理root内に限定して破棄する */
OperationResult discard(const GameRelease& release, const QString& gameRoot, bool imported) {
    return result(manifest_bridge::discard_install(gameRoot.toStdString(), release.gameId.value(),
                                                   release.version.value(), imported));
}

} // namespace pandd::InstallationStorage
