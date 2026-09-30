#pragma once

#include <QHash>
#include <QString>

#include <optional>

namespace pandd {
/** @brief 同梱VRMモデルと正規化した表示位置 */
struct VrmAsset {
    QString modelPath;
    float centerX{0.65F};
    float centerY{0.5F};
    float scale{1.F};

    /** @brief 同じモデルと配置かを比較する */
    bool operator==(const VrmAsset&) const = default;
};

/** @brief ゲームIDから同梱VRMモデルを解決する */
class VrmAssetCatalog final {
  public:
    /** @brief 同梱レジストリを読み込む */
    bool load(QString& error);

    /** @brief モデル相対パスと配置を検証して登録する */
    bool parse(const QByteArray& json, const QString& root, QString& error);

    /** @brief 未登録のゲームはモデルなしを返す */
    [[nodiscard]] std::optional<VrmAsset> find(const QString& gameId) const;

  private:
    QHash<QString, VrmAsset> assets_;
};
} // namespace pandd
