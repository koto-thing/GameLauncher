#include <QtTest>
#include <QDir>
#include <memory>
#include "application/usecases/CheckLauncherUpdateUseCase.h"
#include "infrastructure/network/QtLauncherUpdateRepository.h"
#include "infrastructure/storage/JsonSettingsRepository.h"

class CheckLauncherUpdateUseCaseTest : public QObject {
    Q_OBJECT

private slots:
    void testExecute_FoundUpdate() {
        // mock_maintenancetool.exe を maintenancetool.exe としてコピー
        QString mockSource = QDir::currentPath() + "/mock_maintenancetool.exe";
        QString mockDest = QDir::currentPath() + "/maintenancetool.exe";
        if (QFile::exists(mockDest)) QFile::remove(mockDest);
        if (!QFile::copy(mockSource, mockDest)) {
            QSKIP("Failed to setup mock maintenancetool.exe");
        }

        // Repositoryの準備
        auto updateRepo = std::make_shared<QtLauncherUpdateRepository>();
        
        QString settingsPath = "test_data/usecase_settings.json";
        if (QFile::exists(settingsPath)) QFile::remove(settingsPath);
        auto settingsRepo = std::make_shared<JsonSettingsRepository>(settingsPath.toStdString());

        // UseCaseの準備
        CheckLauncherUpdateUseCase useCase(updateRepo, settingsRepo, "1.0.0");

        bool resultCalled = false;
        UpdateCheckResultDto finalResult;

        useCase.execute("http://dummy.url", 
            [&](UpdateCheckResultDto result) {
                resultCalled = true;
                finalResult = result;
            },
            [](const std::string& err) { QFAIL(err.c_str()); }
        );

        QTRY_VERIFY_WITH_TIMEOUT(resultCalled, 5000);
        
        QVERIFY(finalResult.hasUpdate);
        QCOMPARE(QString::fromStdString(finalResult.latestVersion), QString("1.2.3"));
        QCOMPARE(QString::fromStdString(finalResult.currentVersion), QString("1.0.0"));
        QVERIFY(!finalResult.releaseNotes.empty());
    }
};

QTEST_MAIN(CheckLauncherUpdateUseCaseTest)
#include "CheckLauncherUpdateUseCaseTest.moc"
