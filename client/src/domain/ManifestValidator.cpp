#include "domain/ManifestValidator.h"

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <regex>
#include <set>

namespace pandd {
namespace {

/** @brief MANIFEST_INVALID結果を短く作成する */
OperationResult invalid(std::string detail) {
    return OperationResult::failure({
        .code = ErrorCode::ManifestInvalid,
        .userMessage = "配布情報が正しくないため処理を続行できません",
        .detail = std::move(detail),
        .retryable = false,
    });
}

} // namespace

ManifestValidator::ManifestValidator(std::set<std::string> allowedHosts)
    : allowedHosts_(std::move(allowedHosts)) {}

OperationResult ManifestValidator::validate(const GameRelease& release) const {
    constexpr std::size_t maximumFiles = 10000;
    constexpr std::uint64_t maximumFileSize = 16ULL * 1024ULL * 1024ULL * 1024ULL;
    constexpr std::uint64_t maximumChunkSize = 256ULL * 1024ULL * 1024ULL;
    if (release.schemaVersion != 1 || release.files.empty() ||
        release.files.size() > maximumFiles) {
        return invalid("unsupported schema or file count");
    }
    if (release.engine != "unity" && release.engine != "godot" && release.engine != "siv3d") {
        return invalid("unsupported engine");
    }
    if ((release.platform != "windows" && release.platform != "macos" &&
         release.platform != "linux") ||
        (release.architecture != "x86_64" && release.architecture != "arm64")) {
        return invalid("unsupported platform or architecture");
    }
    if (!release.arguments.empty() || !isSafeRelativePath(release.entrypoint) ||
        (release.workingDirectory != "." && !isSafeRelativePath(release.workingDirectory))) {
        return invalid("unsafe launch contract");
    }
    static const std::regex saveName("^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$");
    if (!std::regex_match(release.saveDirectoryName, saveName)) {
        return invalid("invalid saveDirectoryName");
    }

    // パス重複、チャンク順、総容量を同時に検証
    std::set<std::string> paths;
    std::uint64_t calculatedTotal = 0;
    bool entrypointFound = false;
    for (const auto& file : release.files) {
        if (!isSafeRelativePath(file.path) || !paths.insert(file.path).second ||
            file.size > maximumFileSize || !isSha256(file.sha256) || file.chunks.empty()) {
            return invalid("invalid file entry: " + file.path);
        }
        std::uint64_t nextOffset = 0;
        for (const auto& chunk : file.chunks) {
            if (chunk.offset != nextOffset || chunk.size == 0 || chunk.size > maximumChunkSize ||
                !isSha256(chunk.sha256) || !isAllowedUrl(chunk.url) || nextOffset > file.size ||
                chunk.size > file.size - nextOffset) {
                return invalid("invalid chunk entry: " + file.path);
            }
            nextOffset += chunk.size;
        }
        if (nextOffset != file.size) {
            return invalid("chunk size mismatch: " + file.path);
        }
        calculatedTotal += file.size;
        entrypointFound |= file.path == release.entrypoint;
    }
    if (!entrypointFound || calculatedTotal != release.totalSize || release.signature.empty()) {
        return invalid("manifest totals, entrypoint, or signature are invalid");
    }
    return OperationResult::success();
}

bool ManifestValidator::isSafeRelativePath(const std::string& path) {
    if (path.empty() || path.size() > 240 || path.find('\\') != std::string::npos) {
        return false;
    }
    const std::filesystem::path candidate(path);
    if (candidate.is_absolute() || candidate.has_root_name() || candidate.has_root_directory()) {
        return false;
    }
    for (const auto& component : candidate) {
        if (component == ".." || component == "." || component.empty()) {
            return false;
        }
    }
    return candidate.lexically_normal().generic_string() == path;
}

bool ManifestValidator::isSha256(const std::string& value) {
    return value.size() == 64 &&
           std::all_of(value.begin(), value.end(), [](unsigned char character) {
               return std::isdigit(character) || (character >= 'a' && character <= 'f');
           });
}

bool ManifestValidator::isAllowedUrl(const std::string& url) const {
    static const std::regex urlPattern("^(https?)://([^/:?#]+)(?::[0-9]+)?(?:/|$)",
                                       std::regex::icase);
    std::smatch match;
    if (!std::regex_search(url, match, urlPattern)) {
        return false;
    }
    std::string scheme = match[1].str();
    std::string host = match[2].str();
    std::transform(host.begin(), host.end(), host.begin(),
                   [](unsigned char value) { return static_cast<char>(std::tolower(value)); });
    const bool secure = scheme == "https" || scheme == "HTTPS";
    const bool localDevelopment =
        (host == "127.0.0.1" || host == "localhost") && (scheme == "http" || scheme == "HTTP");
    return (secure || localDevelopment) && allowedHosts_.contains(host);
}

} // namespace pandd
