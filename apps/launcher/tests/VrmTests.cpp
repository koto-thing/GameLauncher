#include "presentation/vrm/VrmAssetCatalog.h"

#include <QJsonDocument>
#include <QJsonObject>
#include <QtTest>

namespace {
/** @brief テスト対象のゲーム登録を作る */
QByteArray registry(const QString& path, double scale = 1.0) {
    return QJsonDocument(
               QJsonObject{{"games", QJsonObject{{"test-game", QJsonObject{{"model", path},
                                                                           {"centerX", 0.65},
                                                                           {"centerY", 0.5},
                                                                           {"scale", scale}}}}}})
        .toJson();
}
} // namespace

/** @brief VRMカタログの入力境界をGPUなしで検証する */
class VrmTests final : public QObject {
    Q_OBJECT
  private slots:
    /** @brief 同梱レジストリとモデルパスの解決を検証する */
    void resolvesModel() {
        pandd::VrmAssetCatalog catalog;
        QString error;
        QVERIFY2(catalog.load(error), qPrintable(error));
        QVERIFY(catalog.parse(registry("character/avatar.vrm"), ":/vrm", error));
        const auto asset = catalog.find("test-game");
        QVERIFY(asset.has_value());
        QCOMPARE(asset->modelPath, ":/vrm/character/avatar.vrm");
        QCOMPARE(asset->centerX, 0.65F);
        QVERIFY(!catalog.find("other-game"));
    }

    /** @brief 不正パスが以前の正常登録も消すことを確認する */
    void rejectsUnsafePaths() {
        pandd::VrmAssetCatalog catalog;
        QString error;
        for (const auto* path :
             {"../avatar.vrm", "/avatar.vrm", "C:/avatar.vrm", "https://example.com/avatar.vrm",
              "a\\avatar.vrm", "a//avatar.vrm", "a/./avatar.vrm", "avatar.glb", ""}) {
            QVERIFY(catalog.parse(registry("avatar.vrm"), ":/vrm", error));
            QVERIFY(!catalog.parse(registry(QString::fromLatin1(path)), ":/vrm", error));
            QVERIFY(!catalog.find("test-game"));
            QVERIFY(!error.isEmpty());
        }
    }

    /** @brief 不正な配置と構造を拒否する */
    void rejectsInvalidRegistry() {
        pandd::VrmAssetCatalog catalog;
        QString error;
        for (const auto scale : {-1.0, 0.0, 4.1}) {
            QVERIFY(!catalog.parse(registry("avatar.vrm", scale), ":/vrm", error));
        }
        QVERIFY(!catalog.parse("[]", ":/vrm", error));
        QVERIFY(!catalog.parse("{", ":/vrm", error));
        QVERIFY(!catalog.parse(QByteArray(1024 * 1024 + 1, ' '), ":/vrm", error));
        QVERIFY(catalog.parse(R"({"games":{}})", ":/vrm", error));
        QVERIFY(error.isEmpty());
    }
};

QTEST_GUILESS_MAIN(VrmTests)
#include "VrmTests.moc"
