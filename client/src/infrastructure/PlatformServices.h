#pragma once

#include "application/Ports.h"

#include <QMutex>
#include <QObject>
#include <QProcess>

#include <map>
#include <memory>

namespace pandd {

/** @brief QProcessでmain processを監視するゲーム起動Service */
class QtGameProcessService final : public QObject, public IGameProcessService {
  public:
    /** @brief 空のprocess管理Serviceを構築する */
    QtGameProcessService();

    /** @brief 実行中processを終了せずhandleだけを解放する */
    ~QtGameProcessService() override;

    /** @copydoc IGameProcessService::launch */
    OperationResult launch(const InstalledGame& installed, const std::string& saveDirectory,
                           ExitCallback onExit) override;

    /** @copydoc IGameProcessService::isRunning */
    [[nodiscard]] bool isRunning(const GameId& gameId) const override;

  private:
    std::map<std::string, std::unique_ptr<QProcess>> processes_;
    mutable QMutex processesMutex_;
};

/** @brief OS別のログイン時自動起動Service */
class PlatformStartupService final : public IStartupService {
  public:
    /** @copydoc IStartupService::apply */
    OperationResult apply(bool enabled, bool minimized) override;

  private:
    /** @brief platform標準の自動起動設定をファイルへ保存する */
    static OperationResult applyFileBasedStartup(bool enabled, bool minimized);
};

/** @brief Qt Installer Framework Maintenance Tool Adapter */
class MaintenanceToolService final : public ILauncherUpdateService {
  public:
    /** @brief Application配置からMaintenance Toolを解決する */
    MaintenanceToolService();

    /** @copydoc ILauncherUpdateService::check */
    OperationResult check() override;

    /** @copydoc ILauncherUpdateService::apply */
    OperationResult apply() override;

    /** @brief Application directoryからOS別Maintenance Toolパスを解決する */
    [[nodiscard]] static QString
    executablePathForApplicationDirectory(const QString& applicationDirectory);

  private:
    /** @brief OS別Maintenance Tool実行パスを返す */
    [[nodiscard]] static QString executablePath();
};

/** @brief OS時計をUTC RFC 3339へ変換するClock */
class SystemClock final : public IClock {
  public:
    /** @copydoc IClock::nowUtc */
    std::string nowUtc() override;
};

} // namespace pandd
