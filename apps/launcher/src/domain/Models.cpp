#include "domain/Models.h"

#include <array>
#include <charconv>
#include <compare>
#include <regex>
#include <stdexcept>

namespace pandd {

/** @brief 成功結果を作成する */
OperationResult OperationResult::success() {
    // 成功時は既定値のエラー情報を保持する
    return {};
}

/** @brief 失敗結果を作成する */
OperationResult OperationResult::failure(OperationError error) {
    // エラー情報を失敗結果へ移動する
    return {.ok = false, .error = std::move(error)};
}

/** @brief ASCII小文字のゲーム識別子を構築する */
GameId::GameId(std::string value) : value_(std::move(value)) {
    // pathや永続化keyとして安全な小文字ASCIIだけを許可
    static const std::regex pattern("^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$");
    if (!std::regex_match(value_, pattern)) {
        throw std::invalid_argument("gameId must be stable lowercase ASCII");
    }
}

/** @brief 識別子文字列を返す */
const std::string& GameId::value() const noexcept {
    // 保持している検証済み識別子を返す
    return value_;
}

/** @brief major.minor.patch形式のバージョンを構築する */
SemanticVersion::SemanticVersion(std::string value) : value_(std::move(value)) {
    // 比較可能な三要素のversionだけを受理
    static const std::regex pattern("^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$");
    std::smatch match;
    if (!std::regex_match(value_, match, pattern)) {
        throw std::invalid_argument("version must use major.minor.patch");
    }

    // 数値変換を一箇所に集約して比較の曖昧さをなくす
    major_ = std::stoi(match[1].str());
    minor_ = std::stoi(match[2].str());
    patch_ = std::stoi(match[3].str());
}

/** @brief 元の正規化済みバージョン文字列を返す */
const std::string& SemanticVersion::value() const noexcept {
    // 保持している検証済みバージョンを返す
    return value_;
}

/** @brief major minor patchの順にバージョンを比較する */
std::strong_ordering SemanticVersion::operator<=>(const SemanticVersion& other) const {
    // majorから順に最初の差を比較結果として返す
    if (major_ != other.major_) {
        return major_ <=> other.major_;
    }
    if (minor_ != other.minor_) {
        return minor_ <=> other.minor_;
    }
    return patch_ <=> other.patch_;
}

/** @brief バージョンの各要素が一致するかを返す */
bool SemanticVersion::operator==(const SemanticVersion& other) const {
    return major_ == other.major_ && minor_ == other.minor_ && patch_ == other.patch_;
}

} // namespace pandd
