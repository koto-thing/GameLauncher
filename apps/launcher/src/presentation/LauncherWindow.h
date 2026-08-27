#pragma once

#include "presentation/LauncherViewModel.h"
#include "presentation/live2d/Live2DAssetCatalog.h"

#include <QHash>
#include <QMainWindow>
#include <QPixmap>
#include <QSet>

class QLabel;
class QLineEdit;
class QListWidget;
class QFrame;
class QPropertyAnimation;
class QProgressBar;
class QPushButton;
class QStackedWidget;
class QSystemTrayIcon;
class QNetworkAccessManager;

namespace pandd {

class ElidedLabel;
class GameDetailPage;

/** @brief ストアと所持ゲームを明確に分けたゲームランチャー画面 */
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

    /** @brief 現在設定に応じたライトまたはダークテーマを適用する */
    void applyTheme();

    /** @brief 未所持ゲームを紹介するトップページを構築する */
    QWidget* createHomePage();

    /** @brief 未所持ゲームを検索するページを構築する */
    QWidget* createDiscoverPage();

    /** @brief 所持ゲームだけを表示する一覧ページを構築する */
    QWidget* createLibraryPage();

    /** @brief ゲーム詳細ページを構築する */
    QWidget* createDetailPage();

    /** @brief ViewModel signalを画面操作へ接続する */
    void connectViewModel();

    /** @brief カタログと導入済み一覧を再描画する */
    void refreshData();

    /** @brief 検索文字列を反映して未所持ゲーム一覧を再描画する */
    void refreshDiscover();

    /** @brief 指定ページへ移動しナビゲーション状態を更新する */
    void navigateTo(int pageIndex);

    /** @brief 選択中のナビゲーション項目へインジケーターを移動する */
    void updateNavigationIndicator(bool animated);

    /** @brief カタログ画像を取得し各ゲームカードへ反映する */
    void requestCatalogImage(const QString& gameId, const QString& imageUrl);

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
    QListWidget* homeList_{nullptr};
    QListWidget* discoverList_{nullptr};
    QListWidget* libraryList_{nullptr};
    QLineEdit* searchInput_{nullptr};
    QLabel* homeEmpty_{nullptr};
    QLabel* discoverEmpty_{nullptr};
    QLabel* libraryEmpty_{nullptr};
    QPushButton* homeButton_{nullptr};
    QPushButton* discoverButton_{nullptr};
    QPushButton* libraryButton_{nullptr};
    QFrame* navigationIndicator_{nullptr};
    QPropertyAnimation* navigationIndicatorAnimation_{nullptr};
    ElidedLabel* heroTitle_{nullptr};
    QLabel* summary_{nullptr};
    QLabel* stagingBadge_{nullptr};
    QListWidget* announcements_{nullptr};
    QPushButton* primaryButton_{nullptr};
    QPushButton* locateButton_{nullptr};
    QProgressBar* progressBar_{nullptr};
    QLabel* transferLabel_{nullptr};
    QSystemTrayIcon* trayIcon_{nullptr};
    GameDetailPage* detailPage_{nullptr};
    Live2DAssetCatalog live2dAssets_;
    QSet<QString> runningGames_;
    QNetworkAccessManager* imageNetwork_{nullptr};
    QHash<QString, QPixmap> heroCache_;
    QString selectedGameId_;
    int selectedState_{static_cast<int>(InstallState::NotInstalled)};
    bool initialUpdateCheckStarted_{false};
    bool mandatoryUpdate_{false};
};

} // namespace pandd
