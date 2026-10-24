#pragma once

#include "domain/Models.h"

#include <set>
#include <string>
#include <string_view>

namespace pandd {

/** @brief ゲームマニフェストの境界検証器 */
class ManifestValidator final {
  public:
    /** @brief 許可配布ホストを指定する */
    explicit ManifestValidator(std::set<std::string> allowedHosts);

    /** @brief 元のJSONの全フィールドと相互整合性をRustで検証する */
    [[nodiscard]] OperationResult validate(std::string_view json) const;

    /** @brief 署名と配布先まで検証したreleaseだけを返す */
    [[nodiscard]] GameRelease verify(std::string_view json, std::string_view publicKeyBase64) const;

    /** @brief 固定公開鍵の形式をRustで検証し不正なら例外を送出する */
    static void validatePublicKey(std::string_view publicKeyBase64);

    /** @brief 配布情報などの分離署名を共有Rust実装で検証する */
    [[nodiscard]] static bool verifySignature(std::string_view payload,
                                              std::string_view signatureBase64,
                                              std::string_view publicKeyBase64);

    /** @brief install root内へ収まる相対パスかを検証する */
    [[nodiscard]] static bool isSafeRelativePath(const std::string& path);

  private:
    std::set<std::string> allowedHosts_;
};

} // namespace pandd
