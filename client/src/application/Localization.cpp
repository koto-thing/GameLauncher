#include "application/Localization.h"

#include <algorithm>
#include <regex>

namespace pandd {

bool isValidLocaleTag(const std::string& locale) {
    static const std::regex pattern(R"(^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$)");
    return std::regex_match(locale, pattern);
}

std::vector<GameCatalogEntry>
// The two parameters have distinct source/fallback roles despite sharing a container type.
// NOLINTNEXTLINE(bugprone-easily-swappable-parameters)
mergeCatalogTranslations(std::vector<GameCatalogEntry> japanese,
                         const std::vector<GameCatalogEntry>& localized) {
    for (const auto& translated : localized) {
        const auto existing =
            std::find_if(japanese.begin(), japanese.end(), [&translated](const auto& entry) {
                return entry.gameId == translated.gameId;
            });
        if (existing == japanese.end()) {
            japanese.push_back(translated);
        } else {
            *existing = translated;
        }
    }
    std::sort(japanese.begin(), japanese.end(), [](const auto& left, const auto& right) {
        return left.gameId.value() < right.gameId.value();
    });
    return japanese;
}

std::vector<Announcement>
// The two parameters have distinct source/fallback roles despite sharing a container type.
// NOLINTNEXTLINE(bugprone-easily-swappable-parameters)
mergeAnnouncementTranslations(std::vector<Announcement> japanese,
                              const std::vector<Announcement>& localized) {
    for (const auto& translated : localized) {
        const auto existing =
            std::find_if(japanese.begin(), japanese.end(),
                         [&translated](const auto& item) { return item.id == translated.id; });
        if (existing == japanese.end()) {
            japanese.push_back(translated);
        } else {
            *existing = translated;
        }
    }
    return japanese;
}

std::vector<LauncherChangelogEntry>
// The two parameters have distinct source/fallback roles despite sharing a container type.
// NOLINTNEXTLINE(bugprone-easily-swappable-parameters)
mergeChangelogTranslations(std::vector<LauncherChangelogEntry> japanese,
                           const std::vector<LauncherChangelogEntry>& localized) {
    for (const auto& translated : localized) {
        const auto existing =
            std::find_if(japanese.begin(), japanese.end(), [&translated](const auto& item) {
                return item.version == translated.version;
            });
        if (existing == japanese.end()) {
            japanese.push_back(translated);
        } else {
            *existing = translated;
        }
    }
    std::sort(japanese.begin(), japanese.end(),
              [](const auto& left, const auto& right) { return left.version > right.version; });
    return japanese;
}

} // namespace pandd
