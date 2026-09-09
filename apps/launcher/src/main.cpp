#include "bootstrap/AppContainer.h"
#include "infrastructure/FileLogger.h"
#include "infrastructure/QtRepositories.h"
#include "presentation/LauncherViewModel.h"
#include "presentation/LauncherWindow.h"
#include "presentation/LocalizationManager.h"

#include <QApplication>
#include <QImageReader>
#include <QLocalServer>
#include <QLocalSocket>
#include <QMessageBox>
#include <QPixmap>
#include <QStyleHints>
#include <QTranslator>

#include <exception>

/** @brief ランチャーを単一instanceで起動するentrypoint */
int main(int argc, char* argv[]) {
    QApplication application(argc, argv);
    QImageReader::setAllocationLimit(128);
    QCoreApplication::setOrganizationName("PandD_org");
    QCoreApplication::setOrganizationDomain("pandd.org");
    QCoreApplication::setApplicationName("GameLauncher");
    QCoreApplication::setApplicationVersion(PANDD_LAUNCHER_VERSION);
    try {
        pandd::EditionProfile::initialize();
    } catch (const std::exception& error) {
        if (!application.arguments().contains("--install-media")) {
            QMessageBox::critical(nullptr, "配布版ランチャー", QString::fromUtf8(error.what()));
        }
        return 3;
    }
    pandd::FileLogger::install();

    // 保存済み言語をwindow構築前に適用
    pandd::JsonStateRepository initialState;
    QTranslator applicationTranslator;
    try {
        const auto language = QString::fromStdString(initialState.load().language);
        if (!pandd::installApplicationTranslation(application, applicationTranslator, language)) {
            qWarning() << "Translation is not bundled; using Japanese:" << language;
        }
    } catch (const std::exception& error) {
        // 状態は上書きせず、通常loadで利用者向けの破損errorとして報告する
        qWarning() << "Deferred invalid settings handling:" << error.what();
    }

    // 既存instanceへ表示要求を送り二重操作を防止
    const auto serverName =
        QString("org.pandd.game-launcher.single-instance") +
        (pandd::EditionProfile::current().enabled() ? "-" + pandd::EditionProfile::current().id()
                                                    : "");
    QLocalSocket probe;
    probe.connectToServer(serverName);
    if (probe.waitForConnected(250)) {
        if (application.arguments().contains("--install-media")) {
            return 4;
        }
        probe.write("show");
        probe.waitForBytesWritten(250);
        return 0;
    }
    QLocalServer::removeServer(serverName);
    QLocalServer server;
    if (!server.listen(serverName)) {
        qCritical() << "Cannot establish the single-instance server" << server.errorString();
        return 1;
    }

    pandd::AppContainer container;
    const auto mediaIndex = application.arguments().indexOf("--install-media");
    if (mediaIndex >= 0) {
        // インストーラーから同じApplication Serviceを呼び、UIを開かず完了を返す
        const auto media = application.arguments().value(mediaIndex + 1);
        const auto gameIndex = application.arguments().indexOf("--game");
        if (media.isEmpty() || gameIndex < 0 || !container.launcherService().load().ok) {
            return 5;
        }
        try {
            const auto result = container.launcherService().installFromMedia(
                pandd::GameId(application.arguments().value(gameIndex + 1).toStdString()),
                media.toStdString(), {});
            if (!result.ok) {
                qCritical() << QString::fromStdString(result.error.userMessage)
                            << QString::fromStdString(result.error.detail);
            }
            return result.ok ? 0 : 6;
        } catch (const std::exception& error) {
            qCritical() << error.what();
            return 7;
        }
    }
    pandd::LauncherViewModel viewModel(container.launcherService());
    const auto smokeTest = application.arguments().contains("--smoke-test") ||
                           qEnvironmentVariableIsSet("PANDD_SMOKE_TEST");
    if (smokeTest) {
        // platform plugin・resource・composition rootを外部通信なしで検証
        return QPixmap(":/images/launcher_background_placeholder.png").isNull() ? 2 : 0;
    }
    pandd::LauncherWindow window(viewModel);
    QObject::connect(&server, &QLocalServer::newConnection, &window, [&] {
        while (auto* connection = server.nextPendingConnection()) {
            connection->deleteLater();
        }
        window.showNormal();
        window.raise();
        window.activateWindow();
    });
    if (!application.arguments().contains("--minimized")) {
        window.show();
    }
    return QApplication::exec();
}
