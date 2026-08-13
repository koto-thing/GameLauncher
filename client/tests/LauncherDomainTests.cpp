#include "application/Localization.h"
#include "domain/ManifestValidator.h"
#include "domain/Models.h"

#include <QTest>

#include <limits>

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

    /** @brief 不連続chunkを拒否する */
    void rejectsChunkGap();

    /** @brief file範囲を越えるchunk sizeを拒否する */
    void rejectsChunkOverflow();

    /** @brief CDN上限方針を超える単一chunkを拒否する */
    void rejectsOversizedChunk();

    /** @brief 言語tagとgame単位の日本語fallbackを検証する */
    void mergesLocalizedCatalogWithJapaneseFallback();
};

/** @brief テスト用の正しいreleaseを作成する */
GameRelease validRelease() {
    GameRelease release;
    release.gameId = GameId("sample-game");
    release.version = SemanticVersion("1.2.3");
    release.platform = "windows";
    release.architecture = "x86_64";
    release.engine = "unity";
    release.entrypoint = "bin/game.exe";
    release.workingDirectory = "bin";
    release.saveDirectoryName = "sample-game";
    release.totalSize = 4;
    release.publishedAt = "2026-08-10T00:00:00Z";
    release.signature = "signed";
    release.files = {
        {"bin/game.exe",
         4,
         std::string(64, 'a'),
         true,
         {{0, 4, std::string(64, 'b'), "https://downloads.koto-thing.com/blobs/sha256/value"}}}};
    return release;
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
    QVERIFY(validator.validate(validRelease()).ok);
    auto rootExecutable = validRelease();
    rootExecutable.entrypoint = "game.exe";
    rootExecutable.workingDirectory = ".";
    rootExecutable.files.front().path = "game.exe";
    QVERIFY(validator.validate(rootExecutable).ok);
}

void LauncherDomainTests::rejectsChunkGap() {
    auto release = validRelease();
    release.files.front().chunks.front().offset = 1;
    const ManifestValidator validator({"downloads.koto-thing.com"});
    QVERIFY(!validator.validate(release).ok);
}

void LauncherDomainTests::rejectsChunkOverflow() {
    auto release = validRelease();
    release.files.front().chunks.front().size = std::numeric_limits<std::uint64_t>::max();
    const ManifestValidator validator({"downloads.koto-thing.com"});
    QVERIFY(!validator.validate(release).ok);
}

void LauncherDomainTests::rejectsOversizedChunk() {
    auto release = validRelease();
    constexpr std::uint64_t oversized = 256ULL * 1024ULL * 1024ULL + 1;
    release.totalSize = oversized;
    release.files.front().size = oversized;
    release.files.front().chunks.front().size = oversized;
    const ManifestValidator validator({"downloads.koto-thing.com"});
    QVERIFY(!validator.validate(release).ok);
}

QTEST_GUILESS_MAIN(LauncherDomainTests)
#include "LauncherDomainTests.moc"
