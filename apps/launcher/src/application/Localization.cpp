#include "application/Localization.h"

#include <algorithm>
#include <regex>

namespace pandd {

/** @brief 公開pathへ使用できるBCP 47形式の言語tagか検証する */
bool isValidLocaleTag(const std::string& locale) {
    // 公開pathへ埋め込む前に許可文字と区切り形式を限定
    static const std::regex pattern(R"(^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$)");
    return std::regex_match(locale, pattern);
}

/** @brief 日本語catalogへ選択言語のgame単位翻訳を重ねる */
std::vector<GameCatalogEntry>
// 同じcontainer型の引数を翻訳元とfallbackの異なる役割で受け取る
// NOLINTNEXTLINE(bugprone-easily-swappable-parameters)
mergeCatalogTranslations(std::vector<GameCatalogEntry> japanese,
                         const std::vector<GameCatalogEntry>& localized) {
    // game IDをキーに選択言語の項目を上書き
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
    // 入力順に依存しない安定した表示順へ正規化
    std::sort(japanese.begin(), japanese.end(), [](const auto& left, const auto& right) {
        return left.gameId.value() < right.gameId.value();
    });
    return japanese;
}

/** @brief 日本語お知らせへ選択言語のID単位翻訳を重ねる */
std::vector<Announcement>
// 同じcontainer型の引数を翻訳元とfallbackの異なる役割で受け取る
// NOLINTNEXTLINE(bugprone-easily-swappable-parameters)
mergeAnnouncementTranslations(std::vector<Announcement> japanese,
                              const std::vector<Announcement>& localized) {
    // お知らせIDをキーに翻訳済み項目だけを上書き
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

/** @brief 日本語更新履歴へ選択言語のversion単位翻訳を重ねる */
std::vector<LauncherChangelogEntry>
// 同じcontainer型の引数を翻訳元とfallbackの異なる役割で受け取る
// NOLINTNEXTLINE(bugprone-easily-swappable-parameters)
mergeChangelogTranslations(std::vector<LauncherChangelogEntry> japanese,
                           const std::vector<LauncherChangelogEntry>& localized) {
    // versionをキーに翻訳済み履歴だけを上書き
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
    // 新しいversionから表示できる順序へ正規化
    std::sort(japanese.begin(), japanese.end(),
              [](const auto& left, const auto& right) { return left.version > right.version; });
    return japanese;
}

} // namespace pandd
