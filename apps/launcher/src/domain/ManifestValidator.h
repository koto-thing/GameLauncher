#pragma once

#include "domain/Models.h"

#include <set>
#include <string>

namespace pandd {

/** @brief ゲームマニフェストの境界検証器 */
class ManifestValidator final {
  public:
    /** @brief 許可配布ホストと上限値を指定する */
    explicit ManifestValidator(std::set<std::string> allowedHosts);

    /** @brief 全フィールドと相互整合性を検証する */
    [[nodiscard]] OperationResult validate(const GameRelease& release) const;

    /** @brief install root内へ収まる相対パスかを検証する */
    [[nodiscard]] static bool isSafeRelativePath(const std::string& path);

    /** @brief SHA-256文字列の形式を検証する */
    [[nodiscard]] static bool isSha256(const std::string& value);

  private:
    /** @brief HTTPSかつ許可ホストのURLかを検証する */
    [[nodiscard]] bool isAllowedUrl(const std::string& url) const;

    std::set<std::string> allowedHosts_;
};

} // namespace pandd
