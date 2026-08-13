#pragma once

#include "domain/Models.h"

#include <string>
#include <vector>

namespace pandd {

/** @brief 公開pathへ使用できるBCP 47形式の言語tagか検証する */
[[nodiscard]] bool isValidLocaleTag(const std::string& locale);

/** @brief 日本語catalogへ選択言語のgame単位翻訳を重ねる */
[[nodiscard]] std::vector<GameCatalogEntry>
mergeCatalogTranslations(std::vector<GameCatalogEntry> japanese,
                         const std::vector<GameCatalogEntry>& localized);

/** @brief 日本語お知らせへ選択言語のID単位翻訳を重ねる */
[[nodiscard]] std::vector<Announcement>
mergeAnnouncementTranslations(std::vector<Announcement> japanese,
                              const std::vector<Announcement>& localized);

/** @brief 日本語更新履歴へ選択言語のversion単位翻訳を重ねる */
[[nodiscard]] std::vector<LauncherChangelogEntry>
mergeChangelogTranslations(std::vector<LauncherChangelogEntry> japanese,
                           const std::vector<LauncherChangelogEntry>& localized);

} // namespace pandd
