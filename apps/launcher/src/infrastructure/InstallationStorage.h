#pragma once

#include "domain/Models.h"
#include <QString>

namespace pandd::InstallationStorage {

/** @brief 検証済みの配置をRustで確定し失敗時に復旧する */
OperationResult activate(const GameRelease& release, const QString& gameRoot, bool imported);

/** @brief 識別済みゲームの一時領域とキャッシュだけを削除する */
OperationResult cleanup(const InstalledGame& installed);

/** @brief 指定操作のstagingだけを安全に削除する */
OperationResult discard(const GameRelease& release, const QString& gameRoot, bool imported);

} // namespace pandd::InstallationStorage
