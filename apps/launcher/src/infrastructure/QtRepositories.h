#pragma once

#include "application/Ports.h"
#include "domain/ManifestValidator.h"

#include <QByteArray>
#include <QNetworkAccessManager>
#include <QString>
#include <QUrl>

namespace pandd {

/** @brief versioned static endpointを読むRepository */
class StaticContentRepository final : public IGameCatalogRepository,
                                      public IGameReleaseRepository,
                                      public ILauncherReleaseRepository {
  public:
    /** @brief 固定配布元と固定公開鍵で構築する */
    StaticContentRepository(QUrl baseUrl, QByteArray manifestPublicKeyBase64,
                            QObject* networkParent = nullptr);

    /** @copydoc IGameCatalogRepository::fetchCatalog */
    std::vector<GameCatalogEntry> fetchCatalog(const std::string& language) override;

    /** @copydoc IGameCatalogRepository::fetchAnnouncements */
    std::vector<Announcement> fetchAnnouncements(const std::string& language) override;

    /** @copydoc IGameReleaseRepository::fetchLatestRelease */
    GameRelease fetchLatestRelease(const std::string& releaseUrl) override;

    /** @copydoc ILauncherReleaseRepository::fetchLatestLauncherRelease */
    LauncherRelease fetchLatestLauncherRelease(const std::string& language) override;

    /** @copydoc ILauncherReleaseRepository::fetchLauncherChangelog */
    std::vector<LauncherChangelogEntry>
    fetchLauncherChangelog(const std::string& language) override;

  private:
    /** @brief 応答上限付きGETを実行し一時障害だけを再試行する */
    QByteArray get(const QUrl& url, qsizetype maximumBytes);

    /** @brief catalog内URLが固定配布元かを検査する */
    [[nodiscard]] bool isAllowedUrl(const QUrl& url) const;

    /** @brief 現在platformのendpoint名を返す */
    [[nodiscard]] static QString platformName();

    /** @brief 現在architectureのendpoint名を返す */
    [[nodiscard]] static QString architectureName();

    QUrl baseUrl_;
    QString allowedHost_;
    ManifestValidator validator_;
    QByteArray manifestPublicKeyBase64_;
};

/** @brief QSaveFileで設定と導入状態を一元保存するRepository */
class JsonStateRepository final : public IInstalledGameRepository, public ISettingsRepository {
  public:
    /** @brief 指定Application Dataディレクトリを使用する */
    explicit JsonStateRepository(QString dataDirectory);

    /** @brief OS標準Application Dataディレクトリを使用する */
    JsonStateRepository();

    /** @copydoc IInstalledGameRepository::loadAll */
    std::vector<InstalledGame> loadAll() override;

    /** @copydoc IInstalledGameRepository::save */
    OperationResult save(const InstalledGame& game) override;

    /** @copydoc IInstalledGameRepository::remove */
    OperationResult remove(const GameId& gameId) override;

    /** @copydoc ISettingsRepository::load */
    LauncherSettings load() override;

    /** @copydoc ISettingsRepository::save */
    OperationResult save(const LauncherSettings& settings) override;

  private:
    /** @brief JSON objectを原子的に保存する */
    OperationResult writeJson(const QString& path, const QJsonObject& object);

    /** @brief JSON objectを読み込み存在しなければ空を返す */
    QJsonObject readJson(const QString& path) const;

    QString dataDirectory_;
};

} // namespace pandd
