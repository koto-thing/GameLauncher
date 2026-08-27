#include "presentation/live2d/Live2DAssetCatalog.h"
#include "presentation/live2d/Live2DModelData.h"

#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTemporaryDir>
#include <QtTest>

namespace {
QByteArray registry(const QJsonValue& model = QStringLiteral("character/Haru.model3.json")) {
    return QJsonDocument(
               QJsonObject{{"games", QJsonObject{{"test-game", QJsonObject{{"model", model},
                                                                           {"idleGroup", "Idle"},
                                                                           {"centerX", 0.65},
                                                                           {"centerY", 0.5},
                                                                           {"scale", 1.0}}}}}})
        .toJson();
}
} // namespace

/** @brief 信頼済み背景登録をGPU非依存で検証する */
class Live2DTests final : public QObject {
    Q_OBJECT
  private slots:
    void loadsBundledRegistry() {
        pandd::Live2DAssetCatalog catalog;
        QString error;
        QVERIFY2(catalog.load(error), qPrintable(error));
    }

    void preparesAssetsWithoutGpu_data() {
        QTest::addColumn<QString>("scenario");
        for (const auto* scenario :
             {"valid", "missing", "traversal", "absolute", "invalid-json", "invalid-texture",
              "oversized-texture", "missing-idle", "canceled"}) {
            QTest::newRow(scenario) << QString::fromLatin1(scenario);
        }
    }

    void preparesAssetsWithoutGpu() {
        QFETCH(QString, scenario);
        QTemporaryDir directory;
        QVERIFY(directory.isValid());
        auto write = [&](const QString& name, const QByteArray& bytes) {
            QFile file(directory.filePath(name));
            return file.open(QIODevice::WriteOnly) && file.write(bytes) == bytes.size();
        };
        QVERIFY(write("model.moc3", "test-only CPU data"));
        QVERIFY(write("idle.motion3.json", "{}"));
        QImage texture(scenario == "oversized-texture" ? 16385 : 2, 2, QImage::Format_RGBA8888);
        texture.fill(QColor(200, 100, 50, 128));
        QVERIFY(texture.save(directory.filePath("texture.png")));
        if (scenario == "invalid-texture") {
            QVERIFY(write("texture.png", "broken"));
        }
        QJsonObject references{
            {"Moc", "model.moc3"},
            {"Textures", QJsonArray{"texture.png"}},
            {"Motions",
             QJsonObject{{"Idle", QJsonArray{QJsonObject{{"File", "idle.motion3.json"}}}}}}};
        if (scenario == "missing") {
            references["Moc"] = "absent.moc3";
        }
        if (scenario == "traversal") {
            references["Moc"] = "../model.moc3";
        }
        if (scenario == "absolute") {
            references["Moc"] = directory.filePath("model.moc3");
        }
        if (scenario == "missing-idle") {
            references.remove("Motions");
        }
        const auto bytes =
            scenario == "invalid-json"
                ? QByteArray("{")
                : QJsonDocument(QJsonObject{{"Version", 3}, {"FileReferences", references}})
                      .toJson();
        QVERIFY(write("model.model3.json", bytes));
        std::atomic_bool canceled{scenario == "canceled"};
        const auto data =
            pandd::prepareLive2DModel({directory.filePath("model.model3.json"), "Idle"}, canceled);
        if (scenario == "valid") {
            QVERIFY2(data.error.isEmpty(), qPrintable(data.error));
            QCOMPARE(data.motions.size(), 1);
            QCOMPARE(data.textures.size(), 1);
            QCOMPARE(data.textures.first().format(), QImage::Format_RGBA8888_Premultiplied);
        } else if (scenario == "canceled") {
            QVERIFY(data.textures.isEmpty());
        } else {
            QVERIFY(!data.error.isEmpty());
        }
    }

    void resolvesRegisteredGame() {
        pandd::Live2DAssetCatalog catalog;
        QString error;
        QVERIFY2(catalog.parse(registry(), ":/live2d", error), qPrintable(error));
        const auto asset = catalog.find("test-game");
        if (!asset) {
            QFAIL("Registered Live2D asset was not found");
            return;
        }
        const auto& resolved = asset.value();
        QCOMPARE(resolved.modelPath, ":/live2d/character/Haru.model3.json");
        QCOMPARE(resolved.idleGroup, "Idle");
        QCOMPARE(resolved.centerX, 0.65F);
        QVERIFY(!catalog.find("other-game"));
    }

    void acceptsEmptyRegistry() {
        pandd::Live2DAssetCatalog catalog;
        QString error;
        QVERIFY(catalog.parse(R"({"games":{}})", ":/live2d", error));
        QVERIFY(!catalog.find("test-game"));
    }

    void rejectsUnsafePaths_data() {
        QTest::addColumn<QString>("path");
        QTest::newRow("parent") << "../Haru.model3.json";
        QTest::newRow("nested-parent") << "models/../Haru.model3.json";
        QTest::newRow("absolute") << "/models/Haru.model3.json";
        QTest::newRow("windows") << "C:/models/Haru.model3.json";
        QTest::newRow("resource") << ":/another/Haru.model3.json";
        QTest::newRow("backslash") << "models\\Haru.model3.json";
        QTest::newRow("empty-segment") << "models//Haru.model3.json";
        QTest::newRow("url") << "https://example.com/Haru.model3.json";
        QTest::newRow("wrong-extension") << "models/Haru.moc3";
        QTest::newRow("empty") << "";
    }

    void rejectsUnsafePaths() {
        QFETCH(QString, path);
        pandd::Live2DAssetCatalog catalog;
        QString error;
        QVERIFY(!catalog.parse(registry(path), ":/live2d", error));
        QVERIFY(!error.isEmpty());
        QVERIFY(!catalog.find("test-game"));
    }

    void rejectsMalformedRegistration_data() {
        QTest::addColumn<QByteArray>("json");
        QTest::newRow("not-json") << QByteArray("{");
        QTest::newRow("array") << QByteArray("[]");
        QTest::newRow("missing-games") << QByteArray("{}");
        QTest::newRow("wrong-games-type") << QByteArray(R"({"games":[]})");
        QTest::newRow("unknown-root-key") << QByteArray(R"({"games":{},"version":1})");
        QTest::newRow("missing-fields") << QByteArray(R"({"games":{"test-game":{}}})");
        auto document = QJsonDocument::fromJson(registry()).object();
        auto game = document["games"].toObject()["test-game"].toObject();
        game["scale"] = -1;
        document["games"] = QJsonObject{{"test-game", game}};
        QTest::newRow("negative-scale") << QJsonDocument(document).toJson();
        game["scale"] = 1;
        game["centerX"] = 2;
        document["games"] = QJsonObject{{"test-game", game}};
        QTest::newRow("outside-viewport") << QJsonDocument(document).toJson();
        game["centerX"] = "0.5";
        document["games"] = QJsonObject{{"test-game", game}};
        QTest::newRow("wrong-number-type") << QJsonDocument(document).toJson();
        game["centerX"] = 0.5;
        document["games"] = QJsonObject{{"../invalid", game}};
        QTest::newRow("invalid-game-id") << QJsonDocument(document).toJson();
    }

    void rejectsMalformedRegistration() {
        QFETCH(QByteArray, json);
        pandd::Live2DAssetCatalog catalog;
        QString error;
        QVERIFY(catalog.parse(registry(), ":/live2d", error));
        QVERIFY(!catalog.parse(json, ":/live2d", error));
        QVERIFY(!error.isEmpty());
        // 不正な置換後に前のゲームのモデル登録を残さない
        QVERIFY(!catalog.find("test-game"));
    }
};

QTEST_GUILESS_MAIN(Live2DTests)
#include "Live2DTests.moc"
