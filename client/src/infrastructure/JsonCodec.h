#pragma once

#include "domain/Models.h"

#include <QByteArray>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>

namespace pandd {

/** @brief 静的配布契約とローカル状態のJSON変換 */
class JsonCodec final {
  public:
    /** @brief カタログJSONをドメイン型へ変換する */
    static std::vector<GameCatalogEntry> parseCatalog(const QByteArray& data);

    /** @brief お知らせJSONをドメイン型へ変換する */
    static std::vector<Announcement> parseAnnouncements(const QByteArray& data);

    /** @brief リリースJSONをドメイン型へ変換する */
    static GameRelease parseRelease(const QByteArray& data);

    /** @brief ランチャーrelease JSONをドメイン型へ変換する */
    static LauncherRelease parseLauncherRelease(const QByteArray& data);

    /** @brief ランチャー更新履歴JSONをドメイン型へ変換する */
    static std::vector<LauncherChangelogEntry> parseLauncherChangelog(const QByteArray& data);

    /** @brief signatureを除くCanonical JSONを生成する */
    static QByteArray canonicalReleasePayload(const QByteArray& data);

    /** @brief 導入済み一覧をJSONへ変換する */
    static QJsonArray serializeInstalledGames(const std::vector<InstalledGame>& games);

    /** @brief version付き導入済み一覧をJSONから復元する */
    static std::vector<InstalledGame> parseInstalledGames(const QJsonObject& document);

    /** @brief 設定をJSONへ変換する */
    static QJsonObject serializeSettings(const LauncherSettings& settings);

    /** @brief 設定をJSONから復元する */
    static LauncherSettings parseSettings(const QJsonObject& object, LauncherSettings defaults);

  private:
    /** @brief JSON値をキー順・空白なしで符号化する */
    static QByteArray canonicalize(const QJsonValue& value);
};

} // namespace pandd
