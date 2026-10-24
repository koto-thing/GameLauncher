#include "application/Localization.h"
#include "domain/ManifestValidator.h"
#include "domain/Models.h"

#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTest>
#include <stdexcept>

using namespace pandd;

/** @brief Qt非依存domain規則のUnit Test */
class LauncherDomainTests final : public QObject {
    Q_OBJECT

  private slots:
    /** @brief Semantic Versionを数値順で比較できる */
    void comparesSemanticVersions();

    /** @brief パスTraversalと絶対パスを拒否する */
    void rejectsUnsafePaths();

    /** @brief 完全なmanifest契約を受理する */
    void acceptsValidManifest();

    /** @brief 共有fixtureの署名をCXX境界越しに検証する */
    void verifiesSharedManifest();

    /** @brief 重複JSONキーと許可外hostをRust境界で拒否する */
    void rejectsAmbiguousJsonAndUntrustedHost();

    /** @brief 不連続chunkを拒否する */
    void rejectsChunkGap();

    /** @brief file範囲を越えるchunk sizeを拒否する */
    void rejectsChunkOverflow();

    /** @brief CDN上限方針を超える単一chunkを拒否する */
    void rejectsOversizedChunk();

    /** @brief 言語tagとgame単位の日本語fallbackを検証する */
    void mergesLocalizedCatalogWithJapaneseFallback();
};

/** @brief Rustと共用する署名済みJSONと公開鍵を読む */
QByteArray fixture(const char* name) {
    QFile file(QString(PANDD_MANIFEST_FIXTURE_DIR) + "/" + name);
    if (!file.open(QIODevice::ReadOnly)) {
        throw std::runtime_error("manifest fixture is missing");
    }
    return file.readAll();
}

/** @brief 改変テスト用に署名済みfixtureをJSON objectへ変換する */
QJsonObject validRelease() { return QJsonDocument::fromJson(fixture("release.json")).object(); }

/** @brief JSON objectを元の境界と同じUTF-8 byte列へ符号化する */
std::string encoded(const QJsonObject& object) {
    return QJsonDocument(object).toJson(QJsonDocument::Compact).toStdString();
}

void LauncherDomainTests::comparesSemanticVersions() {
    QVERIFY(SemanticVersion("1.10.0") > SemanticVersion("1.2.9"));
    QVERIFY(SemanticVersion("2.0.0") > SemanticVersion("1.99.99"));
    QCOMPARE(SemanticVersion("1.2.3"), SemanticVersion("1.2.3"));
}

void LauncherDomainTests::rejectsUnsafePaths() {
    QVERIFY(!ManifestValidator::isSafeRelativePath("../game.exe"));
    QVERIFY(!ManifestValidator::isSafeRelativePath("C:/game.exe"));
    QVERIFY(!ManifestValidator::isSafeRelativePath("C:game.exe"));
    QVERIFY(!ManifestValidator::isSafeRelativePath("bin//game.exe"));
    QVERIFY(ManifestValidator::isSafeRelativePath("bin/game.exe"));
}

void LauncherDomainTests::mergesLocalizedCatalogWithJapaneseFallback() {
    QVERIFY(isValidLocaleTag("ja-JP"));
    QVERIFY(isValidLocaleTag("zh-Hans"));
    QVERIFY(!isValidLocaleTag("../en-US"));
    std::vector<GameCatalogEntry> japanese{
        {GameId("alpha-game"), "アルファ", "日本語", "hero-a", "thumb-a", "release-a"},
        {GameId("beta-game"), "ベータ", "日本語", "hero-b", "thumb-b", "release-b"},
    };
    const std::vector<GameCatalogEntry> english{
        {GameId("alpha-game"), "Alpha", "English", "hero-a", "thumb-a", "release-a"},
    };
    const auto merged = mergeCatalogTranslations(std::move(japanese), english);
    QCOMPARE(merged.size(), std::size_t(2));
    QCOMPARE(merged[0].name, std::string("Alpha"));
    QCOMPARE(merged[1].name, std::string("ベータ"));
}

void LauncherDomainTests::acceptsValidManifest() {
    const ManifestValidator validator({"downloads.koto-thing.com"});
    QVERIFY(validator.validate(fixture("release.json").toStdString()).ok);
    auto rootExecutable = validRelease();
    rootExecutable["entrypoint"] = "game.exe";
    rootExecutable["workingDirectory"] = ".";
    auto file = rootExecutable["files"].toArray().first().toObject();
    file["path"] = "game.exe";
    rootExecutable["files"] = QJsonArray{file};
    QVERIFY(validator.validate(encoded(rootExecutable)).ok);
}

void LauncherDomainTests::verifiesSharedManifest() {
    const ManifestValidator validator({"downloads.koto-thing.com"});
    const auto key = fixture("public-key.txt").trimmed().toStdString();
    const auto release = validator.verify(fixture("release.json").toStdString(), key);
    QCOMPARE(release.gameId.value(), std::string("sample-game"));
    QCOMPARE(release.version.value(), std::string("1.2.3"));
    QCOMPARE(release.totalSize, std::uint64_t(4));
    QCOMPARE(release.files.size(), std::size_t(1));
    QCOMPARE(release.entrypoint, std::string("bin/ゲーム.exe"));
    QCOMPARE(release.files.front().chunks.front().url,
             std::string("https://downloads.koto-thing.com/blobs/sha256/value"));
    auto tampered = validRelease();
    tampered["version"] = "1.2.4";
    QVERIFY_EXCEPTION_THROWN((void)validator.verify(encoded(tampered), key), std::runtime_error);
}

void LauncherDomainTests::rejectsAmbiguousJsonAndUntrustedHost() {
    const ManifestValidator validator({"downloads.koto-thing.com"});
    auto duplicate = fixture("release.json");
    duplicate.replace("\"schemaVersion\":1", "\"schemaVersion\":1,\"schemaVersion\":1");
    QVERIFY(!validator.validate(duplicate.toStdString()).ok);
    const ManifestValidator untrusted({"evil.example"});
    QVERIFY(!untrusted.validate(fixture("release.json").toStdString()).ok);
}

void LauncherDomainTests::rejectsChunkGap() {
    auto bytes = fixture("release.json");
    bytes.replace("\"offset\":0", "\"offset\":1");
    const ManifestValidator validator({"downloads.koto-thing.com"});
    QVERIFY(!validator.validate(bytes.toStdString()).ok);
}

void LauncherDomainTests::rejectsChunkOverflow() {
    auto bytes = fixture("release.json");
    bytes.replace("\"size\":4,\"url\"", "\"size\":18446744073709551615,\"url\"");
    const ManifestValidator validator({"downloads.koto-thing.com"});
    QVERIFY(!validator.validate(bytes.toStdString()).ok);
}

void LauncherDomainTests::rejectsOversizedChunk() {
    auto bytes = fixture("release.json");
    bytes.replace("\"size\":4,\"url\"", "\"size\":268435457,\"url\"");
    const ManifestValidator validator({"downloads.koto-thing.com"});
    QVERIFY(!validator.validate(bytes.toStdString()).ok);
}

QTEST_GUILESS_MAIN(LauncherDomainTests)
#include "LauncherDomainTests.moc"
