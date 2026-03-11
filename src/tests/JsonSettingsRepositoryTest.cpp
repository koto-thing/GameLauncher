#include <QtTest>
#include <QFile>
#include <QDir>
#include "infrastructure/storage/JsonSettingsRepository.h"

class JsonSettingsRepositoryTest : public QObject {
    Q_OBJECT

private slots:
    void initTestCase() {
        QDir().mkpath("test_data");
    }

    void testLoadSaveEntity() {
        QString filePath = "test_data/settings.json";
        if (QFile::exists(filePath)) QFile::remove(filePath);

        JsonSettingsRepository repo(filePath.toStdString());
        
        LauncherSettings s;
        s.language = "en";
        s.installDir = "C:/Games";
        s.startOnBoot = true;
        s.maxDownloadSpeedKB = 1024;
        s.closeToTray = false;
        s.autoUpdate = false;
        s.enableNotifications = true;
        s.launcherVersion = "2.0.0";

        // 保存
        repo.save(s);

        // 新しいリポジトリインスタンスでロード
        JsonSettingsRepository repo2(filePath.toStdString());
        LauncherSettings s2 = repo2.load();

        QCOMPARE(QString::fromStdString(s2.language), QString("en"));
        QCOMPARE(QString::fromStdString(s2.installDir), QString("C:/Games"));
        QCOMPARE(s2.startOnBoot, true);
        QCOMPARE(s2.maxDownloadSpeedKB, 1024);
        QCOMPARE(s2.closeToTray, false);
        QCOMPARE(s2.autoUpdate, false);
        QCOMPARE(s2.enableNotifications, true);
        QCOMPARE(QString::fromStdString(s2.launcherVersion), QString("2.0.0"));
    }

    void testPropertyAccessors() {
        QString filePath = "test_data/settings_props.json";
        JsonSettingsRepository repo(filePath.toStdString());

        repo.setLanguage("fr");
        repo.setInstallDir("/opt/games");
        repo.setAutoRunOnStartup(true);

        QCOMPARE(repo.getLanguage(), std::string("fr"));
        QCOMPARE(repo.getInstallDir(), std::string("/opt/games"));
        QCOMPARE(repo.isAutoRunOnStartup(), true);
    }
};

QTEST_MAIN(JsonSettingsRepositoryTest)
#include "JsonSettingsRepositoryTest.moc"
