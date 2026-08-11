#pragma once

#include "presentation/LauncherViewModel.h"

#include <QHash>
#include <QMainWindow>
#include <QPixmap>

class QLabel;
class QListWidget;
class QProgressBar;
class QPushButton;
class QStackedWidget;
class QSystemTrayIcon;
class QNetworkAccessManager;

namespace pandd {

class HeroPage;

/** @brief HoYoPlayの情報階層を参考にしたゲームランチャー画面 */
class LauncherWindow final : public QMainWindow {
    Q_OBJECT

  public:
    /** @brief ViewModelを借用して画面を構築する */
    explicit LauncherWindow(LauncherViewModel& viewModel, bool initialize = true,
                            QWidget* parent = nullptr);

  protected:
    /** @brief close-to-tray設定を反映する */
    void closeEvent(QCloseEvent* event) override;

  private:
    /** @brief 左サイドバーと各ページを構築する */
    void buildUi();

    /** @brief カタログページを構築する */
    QWidget* createCatalogPage();

    /** @brief ゲーム詳細ページを構築する */
    QWidget* createDetailPage();

    /** @brief ViewModel signalを画面操作へ接続する */
    void connectViewModel();

    /** @brief カタログと導入済み一覧を再描画する */
    void refreshData();

    /** @brief 指定ゲームの詳細ページを表示する */
    void showGame(const QString& gameId);

    /** @brief 選択ゲームが導入済みかを返す */
    [[nodiscard]] bool selectedGameInstalled() const;

    /** @brief 選択ゲームの主操作を実行する */
    void runPrimaryAction();

    /** @brief ダウンロード確認を表示する */
    bool confirmInstall() const;

    /** @brief 全設定カテゴリを含むdialogを表示する */
    void showSettingsDialog();

    /** @brief 選択ゲームのツールmenuを表示する */
    void showToolsMenu();

    /** @brief 組込みMarkdown文書を読取専用dialogへ表示する */
    void showTextDocument(const QString& title, const QString& resourcePath);

    /** @brief 取得済みランチャー更新履歴を表示する */
    void showLauncherChangelog();

    /** @brief 個人pathを含まない診断情報をclipboardへコピーする */
    void copyDiagnostics();

    /** @brief byte数を利用者向け単位へ整形する */
    [[nodiscard]] static QString formatBytes(quint64 bytes);

    LauncherViewModel& viewModel_;
    QStackedWidget* pages_{nullptr};
    QListWidget* installedList_{nullptr};
    QListWidget* catalogList_{nullptr};
    QLabel* heroTitle_{nullptr};
    QLabel* summary_{nullptr};
    QLabel* stagingBadge_{nullptr};
    QListWidget* announcements_{nullptr};
    QPushButton* primaryButton_{nullptr};
    QPushButton* locateButton_{nullptr};
    QProgressBar* progressBar_{nullptr};
    QLabel* transferLabel_{nullptr};
    QSystemTrayIcon* trayIcon_{nullptr};
    HeroPage* detailPage_{nullptr};
    QNetworkAccessManager* imageNetwork_{nullptr};
    QHash<QString, QPixmap> heroCache_;
    QString selectedGameId_;
    int selectedState_{static_cast<int>(InstallState::NotInstalled)};
    bool initialUpdateCheckStarted_{false};
    bool mandatoryUpdate_{false};
};

} // namespace pandd
