#pragma once

#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace pandd {

/** @brief 安定したエラー識別子 */
enum class ErrorCode {
    None,
    NetworkOffline,
    DownloadHttpError,
    DownloadRangeUnsupported,
    ManifestInvalid,
    ManifestSignatureInvalid,
    SettingsInvalid,
    FileHashMismatch,
    DiskSpaceInsufficient,
    InstallPermissionDenied,
    GameAlreadyRunning,
    LaunchExecutableMissing,
    LauncherUpdateFailed,
    OperationCancelled,
};

/** @brief 利用者向け情報と診断情報を分離した操作エラー */
struct OperationError {
    ErrorCode code{ErrorCode::None};
    std::string userMessage;
    std::string detail;
    bool retryable{false};
};

/** @brief 例外を境界外へ漏らさない操作結果 */
struct OperationResult {
    bool ok{true};
    OperationError error;

    /** @brief 成功結果を作成する */
    static OperationResult success();

    /** @brief 失敗結果を作成する */
    static OperationResult failure(OperationError error);
};

/** @brief 検証済みゲーム識別子 */
class GameId final {
  public:
    /** @brief ASCII小文字のゲーム識別子を構築する */
    explicit GameId(std::string value);

    /** @brief 識別子文字列を返す */
    [[nodiscard]] const std::string& value() const noexcept;

    /** @brief 同一性を比較する */
    bool operator==(const GameId&) const = default;

  private:
    std::string value_;
};

/** @brief Semantic Versioningの比較に使う値オブジェクト */
class SemanticVersion final {
  public:
    /** @brief major.minor.patch形式を解析する */
    explicit SemanticVersion(std::string value);

    /** @brief 元の正規化済み文字列を返す */
    [[nodiscard]] const std::string& value() const noexcept;

    /** @brief バージョン順を比較する */
    std::strong_ordering operator<=>(const SemanticVersion& other) const;

    /** @brief 同一性を比較する */
    bool operator==(const SemanticVersion& other) const;

  private:
    std::string value_;
    int major_{0};
    int minor_{0};
    int patch_{0};
};

/** @brief content-addressedな配布チャンク */
struct FileChunk {
    std::uint64_t offset{0};
    std::uint64_t size{0};
    std::string sha256;
    std::string url;
};

/** @brief リリースに含まれる一ファイル */
struct GameFile {
    std::string path;
    std::uint64_t size{0};
    std::string sha256;
    bool executable{false};
    std::vector<FileChunk> chunks;
};

/** @brief 署名付きゲームリリース契約 */
struct GameRelease {
    int schemaVersion{1};
    GameId gameId{GameId("invalid")};
    SemanticVersion version{SemanticVersion("0.0.0")};
    std::string platform;
    std::string architecture;
    SemanticVersion minimumLauncherVersion{SemanticVersion("1.0.0")};
    std::string engine;
    std::string entrypoint;
    std::string workingDirectory;
    std::vector<std::string> arguments;
    std::string saveDirectoryName;
    std::uint64_t totalSize{0};
    std::vector<GameFile> files;
    std::string publishedAt;
    std::string signature;
};

/** @brief カタログのゲーム表示情報 */
struct GameCatalogEntry {
    GameId gameId{GameId("invalid")};
    std::string name;
    std::string summary;
    std::string heroUrl;
    std::string thumbnailUrl;
    std::string latestReleaseUrl;
    double heroFocalX{0.5};
    double heroFocalY{0.5};
};

/** @brief お知らせ表示情報 */
struct Announcement {
    std::string id;
    std::string category;
    std::string title;
    std::string publishedAt;
    std::string body;
};

/** @brief 静的Endpointから取得するランチャーrelease情報 */
struct LauncherRelease {
    int schemaVersion{1};
    SemanticVersion version{SemanticVersion("0.0.0")};
    bool mandatory{false};
    std::string title;
    std::string publishedAt;
    std::string ifwRepositoryUrl;
};

/** @brief 設定画面へ表示するランチャー更新履歴 */
struct LauncherChangelogEntry {
    SemanticVersion version{SemanticVersion("0.0.0")};
    std::string title;
    std::string publishedAt;
    std::vector<std::string> changes;
};

/** @brief UIへ公開するランチャー更新状態 */
struct LauncherUpdateStatus {
    SemanticVersion currentVersion{SemanticVersion("0.0.0")};
    SemanticVersion latestVersion{SemanticVersion("0.0.0")};
    bool updateAvailable{false};
    bool mandatory{false};
    std::string title;
    std::string checkedAt;
};

/** @brief ローカルに記録する導入済みゲーム */
struct InstalledGame {
    GameId gameId{GameId("invalid")};
    SemanticVersion version{SemanticVersion("0.0.0")};
    std::string gameRoot;
    std::string entrypoint;
    std::string workingDirectory;
    std::string saveDirectoryName;
    std::uint64_t installedSize{0};
};

/** @brief UIが表示するインストール状態 */
enum class InstallState {
    NotInstalled,
    Resolving,
    Downloading,
    Paused,
    Verifying,
    Installing,
    Ready,
    CheckingUpdate,
    Repairing,
    Running,
    Failed,
};

/** @brief ダウンロードの集約進捗 */
struct DownloadProgress {
    std::uint64_t receivedBytes{0};
    std::uint64_t totalBytes{0};
    std::uint64_t bytesPerSecond{0};
    std::size_t completedFiles{0};
    std::size_t totalFiles{0};
};

/** @brief 永続化するランチャー設定 */
struct LauncherSettings {
    std::string language{"ja-JP"};
    std::string installRoot;
    bool startOnLogin{false};
    bool startMinimized{false};
    bool closeToTray{false};
    bool showAfterGameExit{true};
    bool darkTheme{false};
    bool checkLauncherUpdateOnStart{true};
    bool autoApplyLauncherUpdate{false};
    std::uint64_t downloadLimitBytesPerSecond{0};
    bool checkGameUpdateBeforeLaunch{true};
    bool continueOtherDownloadsWhilePlaying{true};
    bool notifyDownloadComplete{true};
    bool notifyInstallComplete{true};
    bool notifyErrors{true};
    bool notifyLauncherUpdate{true};
    std::string lastLauncherUpdateCheck;
};

/** @brief 進捗通知関数 */
using ProgressCallback = std::function<void(const DownloadProgress&)>;

} // namespace pandd
