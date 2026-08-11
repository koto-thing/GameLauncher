#include "domain/Models.h"

#include <array>
#include <charconv>
#include <compare>
#include <regex>
#include <stdexcept>

namespace pandd {

OperationResult OperationResult::success() { return {}; }

OperationResult OperationResult::failure(OperationError error) {
    return {.ok = false, .error = std::move(error)};
}

GameId::GameId(std::string value) : value_(std::move(value)) {
    static const std::regex pattern("^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$");
    if (!std::regex_match(value_, pattern)) {
        throw std::invalid_argument("gameId must be stable lowercase ASCII");
    }
}

const std::string& GameId::value() const noexcept { return value_; }

SemanticVersion::SemanticVersion(std::string value) : value_(std::move(value)) {
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

const std::string& SemanticVersion::value() const noexcept { return value_; }

std::strong_ordering SemanticVersion::operator<=>(const SemanticVersion& other) const {
    if (major_ != other.major_) {
        return major_ <=> other.major_;
    }
    if (minor_ != other.minor_) {
        return minor_ <=> other.minor_;
    }
    return patch_ <=> other.patch_;
}

bool SemanticVersion::operator==(const SemanticVersion& other) const {
    return major_ == other.major_ && minor_ == other.minor_ && patch_ == other.patch_;
}

} // namespace pandd
