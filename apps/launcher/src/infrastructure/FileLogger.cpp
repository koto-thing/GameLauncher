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
    // log directoryを準備してQt全体のmessage handlerを差し替え
    QDir().mkpath(logDirectory());
    qInstallMessageHandler(&FileLogger::messageHandler);
}

QString FileLogger::logDirectory() {
    return QDir(QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation))
        .filePath("logs");
}

void FileLogger::messageHandler(QtMsgType type, const QMessageLogContext&, const QString& message) {
    // 複数threadからの追記とrotateを直列化
    QMutexLocker lock(&logMutex);
    const auto path = QDir(logDirectory()).filePath("launcher.log");
    rotateIfNeeded(path);
    QFile file(path);
    if (!file.open(QIODevice::WriteOnly | QIODevice::Append | QIODevice::Text)) {
        return;
    }
    // URL queryに含まれる代表的な機密値を記録前に除去
    QString sanitized = message;
    sanitized.replace(QRegularExpression("([?&](?:token|signature|key)=[^&\\s]+)"), "?redacted");
    const char* level = type == QtCriticalMsg || type == QtFatalMsg ? "ERROR"
                        : type == QtWarningMsg                      ? "WARN"
                                                                    : "INFO";
    QTextStream(&file) << QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs) << ' '
                       << level << ' ' << sanitized << '\n';
}

void FileLogger::rotateIfNeeded(const QString& path) {
    // 上限未満のlogはそのまま追記
    constexpr qint64 maximumBytes = qint64{5} * 1024 * 1024;
    if (QFileInfo(path).size() < maximumBytes) {
        return;
    }
    // 古い世代から順に繰り上げて最大3世代を保持
    QFile::remove(path + ".3");
    QFile::rename(path + ".2", path + ".3");
    QFile::rename(path + ".1", path + ".2");
    QFile::rename(path, path + ".1");
}

} // namespace pandd
