//
// Created by koton on 2026/04/01.
//

#include "./QtApplicationProvider.h"

#include <QApplication>
#include <QFile>

#include "AppConfig.h"

QtApplicationProvider::QtApplicationProvider(int &argc, char **argv)
    : m_app(new QApplication(argc, argv)) {
    QApplication::setApplicationName(QString::fromUtf8(AppConfig::kAppName.data()));
    QApplication::setOrganizationName(QString::fromUtf8(AppConfig::kOrganizationName.data()));
}

int QtApplicationProvider::run() {
    return QApplication::exec();
}

void QtApplicationProvider::quit(const int exitCode) {
    QApplication::exit(exitCode);
}

bool QtApplicationProvider::applyTheme(const QString &themeName) {
    QFile file(AppConfig::themeFilePath(themeName));
    if (!file.open(QFile::ReadOnly | QFile::Text)) {
        qWarning() << "Failed to open theme file: " << file.errorString();
        return false;
    }

    QApplication::setStyle(QString::fromUtf8(file.readAll()));
    return true;
}