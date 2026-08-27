#pragma once

#include <QByteArray>
#include <QHash>
#include <QString>

#include <optional>

namespace pandd {

/** @brief 信頼済み同梱背景モデルと表示位置 */
struct Live2DAsset {
    QString modelPath;
    QString idleGroup{"Idle"};
    float centerX{0.65F};
    float centerY{0.5F};
    float scale{1.0F};

    bool operator==(const Live2DAsset&) const = default;
};

/** @brief 同梱モデル登録を検証してゲームIDから解決する */
class Live2DAssetCatalog final {
  public:
    /** @brief Application Resourceの登録を読み不正内容をエラーとして返す */
    bool load(QString& error);
    /** @brief 信頼済みResourceまたはfilesystem root基準で登録を解析する */
    bool parse(const QByteArray& json, const QString& root, QString& error);
    /** @brief 背景未登録のゲームにはモデルなしを返す */
    [[nodiscard]] std::optional<Live2DAsset> find(const QString& gameId) const;

  private:
    QHash<QString, Live2DAsset> assets_;
};

} // namespace pandd
