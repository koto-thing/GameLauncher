#include <QtTest>
#include <QCoreApplication>
#include <QDir>
#include <QSignalSpy>
#include "infrastructure/network/QtLauncherUpdateRepository.h"

class QtLauncherUpdateRepositoryTest : public QObject {
    Q_OBJECT

private slots:
    void initTestCase() {
        // テストケース全体が始まる前に呼ばれる
    }

    void testCheckUpdateWithMaintenanceTool_Found() {
        QtLauncherUpdateRepository repo;
        
        // モックツールのパスを取得
        QString mockPath = QDir::currentPath() + "/mock_maintenancetool.exe";
        if (!QFile::exists(mockPath)) {
            QSKIP("Mock tool not found. Run build first.");
        }

        bool successCalled = false;
        bool errorCalled = false;
        LauncherUpdateInfo resultInfo;

        repo.checkUpdateWithMaintenanceTool(
            mockPath.toStdString(),
            [&](const LauncherUpdateInfo& info) {
                successCalled = true;
                resultInfo = info;
            },
            [&](const std::string& err) {
                errorCalled = true;
                qDebug() << "Error occurred:" << QString::fromStdString(err);
            }
        );

        // QProcessは非同期なので、少し待つ
        QTRY_VERIFY_WITH_TIMEOUT(successCalled || errorCalled, 5000);
        
        QVERIFY(successCalled);
        QVERIFY(!errorCalled);
        QCOMPARE(resultInfo.hasUpdate, true);
        QCOMPARE(QString::fromStdString(resultInfo.latestVersion), QString("1.2.3"));
        QCOMPARE(QString::fromStdString(resultInfo.releaseNotes), QString("Test Release Notes"));
    }

    void testCheckUpdateWithMaintenanceTool_NotFound() {
        QtLauncherUpdateRepository repo;
        
        // 存在しないパスを指定してみる
        QString invalidPath = QDir::currentPath() + "/non_existent_tool.exe";

        bool successCalled = false;
        bool errorCalled = false;

        repo.checkUpdateWithMaintenanceTool(
            invalidPath.toStdString(),
            [&](const LauncherUpdateInfo& info) { successCalled = true; },
            [&](const std::string& err) { errorCalled = true; }
        );

        QTRY_VERIFY_WITH_TIMEOUT(successCalled || errorCalled, 5000);
        
        QVERIFY(!successCalled);
        QVERIFY(errorCalled);
    }
};

QTEST_MAIN(QtLauncherUpdateRepositoryTest)
#include "QtLauncherUpdateRepositoryTest.moc"
