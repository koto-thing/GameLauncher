#include "domain/ManifestValidator.h"

#include "pandd-launcher-rust/src/lib.rs.h"
#include "rust/cxx.h"

#include <stdexcept>
#include <utility>

namespace pandd {
namespace {

/** @brief 所有権を移さずJSONや署名対象をRustへ渡す */
rust::Slice<const std::uint8_t> bytes(std::string_view value) {
    return {reinterpret_cast<const std::uint8_t*>(value.data()), value.size()};
}

/** @brief 配布元の固定host集合をCXXの文字列配列へ変換する */
rust::Vec<rust::String> rustHosts(const std::set<std::string>& hosts) {
    rust::Vec<rust::String> result;
    for (const auto& host : hosts) {
        result.push_back(rust::String(host));
    }
    return result;
}

/** @brief 検証済みRustデータだけを既存application層の値へ写す */
GameRelease domainRelease(const manifest_bridge::GameRelease& source) {
    GameRelease release;
    release.schemaVersion = static_cast<int>(source.schema_version);
    release.gameId = GameId(std::string(source.game_id));
    release.version = SemanticVersion(std::string(source.version));
    release.platform = std::string(source.platform);
    release.architecture = std::string(source.arch);
    release.minimumLauncherVersion = SemanticVersion(std::string(source.minimum_launcher_version));
    release.engine = std::string(source.engine);
    release.entrypoint = std::string(source.entrypoint);
    release.workingDirectory = std::string(source.working_directory);
    release.saveDirectoryName = std::string(source.save_directory_name);
    release.totalSize = source.total_size;
    release.publishedAt = std::string(source.published_at);
    release.signature = std::string(source.signature);

    for (const auto& argument : source.arguments) {
        release.arguments.emplace_back(argument);
    }
    for (const auto& item : source.files) {
        GameFile file{
            std::string(item.path), item.size, std::string(item.sha256), item.executable, {}};
        for (const auto& chunk : item.chunks) {
            file.chunks.push_back(
                {chunk.offset, chunk.size, std::string(chunk.sha256), std::string(chunk.url)});
        }
        release.files.push_back(std::move(file));
    }
    return release;
}

} // namespace

/** @brief 許可配布hostの集合を保持する */
ManifestValidator::ManifestValidator(std::set<std::string> allowedHosts)
    : allowedHosts_(std::move(allowedHosts)) {}

/** @brief JSONの構造と配布先検証を共有Rustライブラリへ委譲する */
OperationResult ManifestValidator::validate(std::string_view json) const {
    try {
        const auto hosts = rustHosts(allowedHosts_);
        manifest_bridge::validate_manifest(bytes(json), {hosts.data(), hosts.size()});
        return OperationResult::success();
    } catch (const rust::Error& error) {
        return OperationResult::failure({ErrorCode::ManifestInvalid,
                                         "配布情報が正しくないため処理を続行できません",
                                         error.what(), false});
    }
}

/** @brief JSON解析から署名検証まで一度のRust呼び出しで完了する */
GameRelease ManifestValidator::verify(std::string_view json,
                                      std::string_view publicKeyBase64) const {
    try {
        const auto hosts = rustHosts(allowedHosts_);
        return domainRelease(manifest_bridge::verify_manifest(
            bytes(json), rust::Str(publicKeyBase64.data(), publicKeyBase64.size()),
            {hosts.data(), hosts.size()}));
    } catch (const rust::Error& error) {
        throw std::runtime_error(error.what());
    }
}

/** @brief 固定公開鍵の形式を検証する */
void ManifestValidator::validatePublicKey(std::string_view publicKeyBase64) {
    try {
        manifest_bridge::validate_public_key(
            rust::Str(publicKeyBase64.data(), publicKeyBase64.size()));
    } catch (const rust::Error& error) {
        throw std::invalid_argument(error.what());
    }
}

/** @brief 物理版の配布情報にも同じEd25519検証を適用する */
bool ManifestValidator::verifySignature(std::string_view payload, std::string_view signatureBase64,
                                        std::string_view publicKeyBase64) {
    return manifest_bridge::verify_signature(
        bytes(payload), rust::Str(signatureBase64.data(), signatureBase64.size()),
        rust::Str(publicKeyBase64.data(), publicKeyBase64.size()));
}

/** @brief Publisherと同じ相対path検証を適用する */
bool ManifestValidator::isSafeRelativePath(const std::string& path) {
    return manifest_bridge::safe_relative_path(path);
}

} // namespace pandd
