#include "infrastructure/PlatformServices.h"

#include <QCoreApplication>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QMetaObject>
#include <QMutexLocker>
#include <QProcessEnvironment>
#include <QSaveFile>
#include <QSettings>
#include <QStandardPaths>
#include <QThread>
#include <QTimer>

namespace pandd {
namespace {

/** @brief OS操作失敗結果を作成する */
OperationResult platformFailure(ErrorCode code, QString message, QString detail) {
    return OperationResult::failure({code, message.toStdString(), detail.toStdString(), true});
}

/** @brief 自動起動用command lineを組み立てる */
QString startupCommand(bool minimized) {
    // 空白を含む実行pathだけをquote
    QString command = QDir::toNativeSeparators(QCoreApplication::applicationFilePath());
    if (command.contains(' ')) {
        command = '"' + command + '"';
    }
    if (minimized) {
        command += " --minimized";
    }
    return command;
}

} // namespace

QtGameProcessService::QtGameProcessService() : QObject(nullptr) {}

QtGameProcessService::~QtGameProcessService() {
    // 管理中processを保護しながらcallback接続だけを解除
    QMutexLocker lock(&processesMutex_);
    for (auto& [key, process] : processes_) {
        Q_UNUSED(key)
        if (process->state() != QProcess::NotRunning) {
            // Launcher終了はgame終了を意味しないため終了callbackを切ってOS handleを残す
            process->disconnect();
            [[maybe_unused]] auto* detachedProcess = process.release();
        }
    }
}

OperationResult QtGameProcessService::launch(const InstalledGame& installed,
                                             const std::string& saveDirectory,
                                             ExitCallback onExit) {
    // QProcessを所有するthreadへ同期転送
    if (QThread::currentThread() != thread()) {
        OperationResult result;
        auto callback = std::move(onExit);
        QMetaObject::invokeMethod(
            this, [&] { result = launch(installed, saveDirectory, std::move(callback)); },
            Qt::BlockingQueuedConnection);
        return result;
    }
    // 同一gameの多重起動を拒否
    if (isRunning(installed.gameId)) {
        return platformFailure(ErrorCode::GameAlreadyRunning, "ゲームは既に実行中です",
                               "duplicate process launch");
    }
    // 導入記録から有効releaseの実行pathを解決
    const QDir releaseRoot(
        QDir(QString::fromStdString(installed.gameRoot))
            .filePath("releases/" + QString::fromStdString(installed.version.value())));
    const QString executable = releaseRoot.filePath(QString::fromStdString(installed.entrypoint));
    if (!QFileInfo::exists(executable)) {
        return platformFailure(ErrorCode::LaunchExecutableMissing,
                               "ゲーム実行ファイルがありません。修復を実行してください",
                               executable);
    }

    // shellを介さずworking directoryとsave rootを明示
    auto process = std::make_unique<QProcess>();
    process->setProgram(executable);
    process->setArguments({});
    process->setWorkingDirectory(
        releaseRoot.filePath(QString::fromStdString(installed.workingDirectory)));
    auto environment = QProcessEnvironment::systemEnvironment();
    QDir().mkpath(QString::fromStdString(saveDirectory));
    environment.insert("PANDD_SAVE_DIR", QString::fromStdString(saveDirectory));
    process->setProcessEnvironment(environment);
    const auto key = installed.gameId.value();
    // 終了結果を通知して次のevent loopで所有権を解放
    QObject::connect(
        process.get(), &QProcess::finished,
        [this, key, callback = std::move(onExit)](int exitCode, QProcess::ExitStatus status) {
            if (callback) {
                callback(exitCode, status == QProcess::CrashExit || exitCode != 0);
            }
            QTimer::singleShot(0, [this, key] {
                QMutexLocker lock(&processesMutex_);
                // finished signal完了後に送信元を破棄
                // NOLINTNEXTLINE(clang-analyzer-core.CallAndMessage)
                processes_.erase(key);
            });
        });
    // 起動完了を確認してから管理mapへ登録
    process->start();
    if (!process->waitForStarted(5000)) {
        return platformFailure(ErrorCode::LaunchExecutableMissing, "ゲームを起動できませんでした",
                               process->errorString());
    }
    {
        QMutexLocker lock(&processesMutex_);
        processes_.emplace(key, std::move(process));
    }
    return OperationResult::success();
}

bool QtGameProcessService::isRunning(const GameId& gameId) const {
    QMutexLocker lock(&processesMutex_);
    return processes_.contains(gameId.value());
}

OperationResult PlatformStartupService::apply(bool enabled, bool minimized) {
#if defined(Q_OS_WIN)
    // Windowsの利用者単位Run keyへ設定を反映
    QSettings registry("HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                       QSettings::NativeFormat);
    if (enabled) {
        registry.setValue("PandDGameLauncher", startupCommand(minimized));
    } else {
        registry.remove("PandDGameLauncher");
    }
    registry.sync();
    if (registry.status() != QSettings::NoError) {
        return platformFailure(ErrorCode::InstallPermissionDenied, "自動起動設定を変更できません",
                               "Windows Run key update failed");
    }
    return OperationResult::success();
#else
    // macOSとLinuxは設定fileへ反映
    return applyFileBasedStartup(enabled, minimized);
#endif
}

OperationResult PlatformStartupService::applyFileBasedStartup(bool enabled, bool minimized) {
#if defined(Q_OS_MACOS)
    // macOS LaunchAgentのplistを構築
    const auto directory = QDir::home().filePath("Library/LaunchAgents");
    const auto path = QDir(directory).filePath("org.pandd.launcher.plist");
    const auto arguments =
        minimized ? QString("<string>%1</string><string>--minimized</string>")
                        .arg(QCoreApplication::applicationFilePath())
                  : QString("<string>%1</string>").arg(QCoreApplication::applicationFilePath());
    const auto contents = QString("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
                                  "<plist version=\"1.0\"><dict>"
                                  "<key>Label</key><string>org.pandd.launcher</string>"
                                  "<key>ProgramArguments</key><array>%1</array>"
                                  "<key>RunAtLoad</key><true/></dict></plist>")
                              .arg(arguments);
#else
    // Linux desktopのautostart entryを構築
    const auto directory = QDir(QStandardPaths::writableLocation(QStandardPaths::ConfigLocation))
                               .filePath("autostart");
    const auto path = QDir(directory).filePath("pandd-game-launcher.desktop");
    const auto contents = QString("[Desktop Entry]\nType=Application\nName=PandD Game Launcher\n"
                                  "Exec=%1\nTerminal=false\nX-GNOME-Autostart-enabled=true\n")
                              .arg(startupCommand(minimized));
#endif
    // 無効化時は既存設定fileだけを削除
    if (!enabled) {
        if (QFileInfo::exists(path) && !QFile::remove(path)) {
            return platformFailure(ErrorCode::InstallPermissionDenied,
                                   "自動起動設定を削除できません", path);
        }
        return OperationResult::success();
    }
    // 有効化時は一時file経由で原子的に保存
    QDir().mkpath(directory);
    QSaveFile file(path);
    if (!file.open(QIODevice::WriteOnly) || file.write(contents.toUtf8()) < 0 || !file.commit()) {
        return platformFailure(ErrorCode::InstallPermissionDenied, "自動起動設定を変更できません",
                               file.errorString());
    }
    return OperationResult::success();
}

MaintenanceToolService::MaintenanceToolService() = default;

OperationResult MaintenanceToolService::check() {
    // install配置から更新toolを解決
    const auto executable = executablePath();
    if (!QFileInfo::exists(executable)) {
        return platformFailure(ErrorCode::LauncherUpdateFailed,
                               "更新ツールはインストール版で利用できます", executable);
    }
    // 更新確認commandの正常終了まで待機
    QProcess process;
    process.start(executable, {"check-updates"});
    if (!process.waitForStarted(5000) || !process.waitForFinished(120000) ||
        process.exitStatus() != QProcess::NormalExit || process.exitCode() != 0) {
        return platformFailure(ErrorCode::LauncherUpdateFailed, "ランチャーの更新を確認できません",
                               process.errorString());
    }
    return OperationResult::success();
}

OperationResult MaintenanceToolService::apply() {
    // Launcher終了後も継続できる独立processとしてupdaterを起動
    const auto executable = executablePath();
    if (!QFileInfo::exists(executable) ||
        !QProcess::startDetached(executable, {"--start-updater"},
                                 QFileInfo(executable).absolutePath())) {
        return platformFailure(ErrorCode::LauncherUpdateFailed, "更新ツールを起動できません",
                               executable);
    }
    return OperationResult::success();
}

QString MaintenanceToolService::executablePath() {
    return executablePathForApplicationDirectory(QCoreApplication::applicationDirPath());
}

QString
MaintenanceToolService::executablePathForApplicationDirectory(const QString& applicationDirectory) {
    QDir directory(applicationDirectory);
#if defined(Q_OS_WIN)
    // IFWがbinの隣へ配置する更新toolを解決
    directory.cdUp();
    return directory.filePath("maintenancetool.exe");
#elif defined(Q_OS_MACOS)
    // Application bundleからIFW install rootへ移動
    directory.cdUp();
    directory.cdUp();
    directory.cdUp();
    return directory.filePath("maintenancetool.app/Contents/MacOS/maintenancetool");
#else
    // binの隣にあるIFW更新toolを解決
    directory.cdUp();
    return directory.filePath("maintenancetool");
#endif
}

std::string SystemClock::nowUtc() {
    return QDateTime::currentDateTimeUtc().toString(Qt::ISODate).toStdString();
}

} // namespace pandd
