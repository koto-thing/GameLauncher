#pragma once

#include "application/Ports.h"

#include <QJsonObject>
#include <QString>

namespace pandd {

/** @brief 物理配布版の固定情報と署名済み同梱リリースを読む */
class EditionProfile final : public IGameCatalogRepository, public IPhysicalMediaRepository {
  public:
    /** @brief アプリ配置から固定情報を読み込み、破損時は起動を拒否する */
    static void initialize();

    /** @brief 起動時に確定した配布版情報を返す */
    static const EditionProfile& current();

    /** @brief 通常版か配布版かを返す */
    bool enabled() const { return !id_.isEmpty(); }

    /** @brief 配布版の永続識別子を返す */
    QString id() const { return id_; }

    /** @brief 配布版の表示名を返す */
    QString name() const { return document_["name"].toString(); }

    /** @brief 配布版の強調色を返す */
    QString accent() const { return document_["accentColor"].toString(); }

    /** @brief 検証済み同梱画像への絶対パスを返す */
    QString asset(const QString& name) const;

    /** @brief 収録対象を操作境界で検証する */
    bool allows(const GameId& gameId) const;

    /** @brief 固定された署名済みゲームリリースを検証する */
    GameRelease bundledRelease(const GameId& gameId) const;

    /** @brief 指定媒体が同じ配布ビルドであることを検証する */
    QString mediaGameDirectory(const GameId& gameId, const QString& media) const;

    /** @copydoc IPhysicalMediaRepository::mediaSource */
    std::string mediaSource(const GameId& gameId, const std::string& media) const override;

    /** @copydoc IGameCatalogRepository::fetchCatalog */
    std::vector<GameCatalogEntry> fetchCatalog(const std::string& language) override;

    /** @copydoc IGameCatalogRepository::fetchAnnouncements */
    std::vector<Announcement> fetchAnnouncements(const std::string& language) override;

  private:
    QString root_;
    QString id_;
    QByteArray digest_;
    QJsonObject document_;
};

} // namespace pandd
