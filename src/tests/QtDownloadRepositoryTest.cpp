#include <QtTest>
#include <QSignalSpy>
#include <QEventLoop>
#include <QDir>
#include <QFile>
#include "../infrastructure/network/QtDownloadRepository.h"
#include "../domain/entities/DownloadTask.h"

class QtDownloadRepositoryTest : public QObject {
    Q_OBJECT

private slots:
    void initTestCase() {
        QDir().mkpath("test_download");
    }

    void cleanupTestCase() {
        QDir("test_download").removeRecursively();
    }

    void testDownloadSuccess() {
        QtDownloadRepository repository;
        
        DownloadTask task;
        task.gameId = "test_game";
        task.installDir = "test_download";
        // Use a small, reliable URL for testing
        task.file.path = "test.txt";
        task.file.url = "https://raw.githubusercontent.com/google/gemini-cli/main/README.md";
        task.file.size = 0;
        task.file.checksum = "";

        QEventLoop loop;
        bool finished = false;
        bool error = false;
        QString errorMessage;
        QString downloadedPath;

        repository.startDownload(
            task,
            [](int64_t recv, int64_t total) {
                // Progress callback
                qDebug() << "Progress:" << recv << "/" << total;
            },
            [&](const std::string &path) {
                finished = true;
                downloadedPath = QString::fromStdString(path);
                loop.quit();
            },
            [&](const std::string &msg) {
                error = true;
                errorMessage = QString::fromStdString(msg);
                loop.quit();
            }
        );

        // Timeout after 10 seconds
        QTimer::singleShot(10000, &loop, &QEventLoop::quit);
        loop.exec();

        if (error) {
            QFAIL(qPrintable("Download failed: " + errorMessage));
        }
        
        QVERIFY(finished);
        QVERIFY(QFile::exists(downloadedPath));
    }

    void testDownloadInvalidUrl() {
        QtDownloadRepository repository;
        
        DownloadTask task;
        task.gameId = "test_game";
        task.installDir = "test_download";
        task.file.path = "invalid.txt";
        task.file.url = "https://this-is-an-invalid-url-hopefully.com/file.txt";

        QEventLoop loop;
        bool errorOccurred = false;

        repository.startDownload(
            task,
            nullptr,
            [&](const std::string&) { loop.quit(); },
            [&](const std::string&) {
                errorOccurred = true;
                loop.quit();
            }
        );

        QTimer::singleShot(5000, &loop, &QEventLoop::quit);
        loop.exec();

        QVERIFY(errorOccurred);
    }
};

QTEST_MAIN(QtDownloadRepositoryTest)
#include "QtDownloadRepositoryTest.moc"
