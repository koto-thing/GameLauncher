#include "infrastructure/FileLogger.h"

#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QMutex>
#include <QMutexLocker>
#include <QRegularExpression>
#include <QStandardPaths>
#include <QTextStream>

namespace pandd {
namespace {
QMutex logMutex;
}

void FileLogger::install() {
    QDir().mkpath(logDirectory());
    qInstallMessageHandler(&FileLogger::messageHandler);
}

QString FileLogger::logDirectory() {
    return QDir(QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation))
        .filePath("logs");
}

void FileLogger::messageHandler(QtMsgType type, const QMessageLogContext&, const QString& message) {
    QMutexLocker lock(&logMutex);
    const auto path = QDir(logDirectory()).filePath("launcher.log");
    rotateIfNeeded(path);
    QFile file(path);
    if (!file.open(QIODevice::WriteOnly | QIODevice::Append | QIODevice::Text)) {
        return;
    }
    QString sanitized = message;
    sanitized.replace(QRegularExpression("([?&](?:token|signature|key)=[^&\\s]+)"), "?redacted");
    const char* level = type == QtCriticalMsg || type == QtFatalMsg ? "ERROR"
                        : type == QtWarningMsg                      ? "WARN"
                                                                    : "INFO";
    QTextStream(&file) << QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs) << ' '
                       << level << ' ' << sanitized << '\n';
}

void FileLogger::rotateIfNeeded(const QString& path) {
    constexpr qint64 maximumBytes = qint64{5} * 1024 * 1024;
    if (QFileInfo(path).size() < maximumBytes) {
        return;
    }
    QFile::remove(path + ".3");
    QFile::rename(path + ".2", path + ".3");
    QFile::rename(path + ".1", path + ".2");
    QFile::rename(path, path + ".1");
}

} // namespace pandd
