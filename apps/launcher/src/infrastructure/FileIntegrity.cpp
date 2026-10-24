#include "infrastructure/FileIntegrity.h"

#include "pandd-launcher-rust/src/lib.rs.h"
#include <QDir>
#include <vector>

namespace pandd::FileIntegrity {
namespace {

/** @brief Rustの失敗分類を既存のアプリケーションエラーへ変換する */
OperationResult result(const manifest_bridge::IoStatus& status) {
    if (status.code == 0) {
        return OperationResult::success();
    }
    const auto code = status.code == 1   ? ErrorCode::FileHashMismatch
                      : status.code == 2 ? ErrorCode::OperationCancelled
                                         : ErrorCode::InstallPermissionDenied;
    return OperationResult::failure({code, "ゲームファイルの処理を完了できません",
                                     std::string(status.detail), status.code != 2});
}

} // namespace

/** @brief ディスク上の内容を同じファイルハンドルで検証する */
bool verify(const QString& path, std::uint64_t size, const std::string& digest) {
    return manifest_bridge::verify_file(path.toStdString(), size, digest);
}

/** @brief チャンク読み取りと全体検証を一度のRust呼び出しにまとめる */
// 入力キャッシュと出力ファイルは別のパスとして扱う
// NOLINTNEXTLINE(bugprone-easily-swappable-parameters)
OperationResult assemble(const GameFile& file, const QString& chunksRoot,
                         const QString& destination, const std::atomic_bool& cancelled) {
    std::vector<manifest_bridge::LocalPart> parts;
    for (const auto& chunk : file.chunks) {
        parts.push_back(
            {QDir(chunksRoot).filePath(QString::fromStdString(chunk.sha256)).toStdString(),
             chunk.size, chunk.sha256});
    }
    const manifest_bridge::FileIoControl control{&cancelled};
    return result(manifest_bridge::assemble_files(
        {parts.data(), parts.size()}, destination.toStdString(), file.size, file.sha256, control));
}

/** @brief コピーと検証を同時に行い不一致なら出力を確定しない */
// コピー元とコピー先を独立したパスとして受け取る
// NOLINTNEXTLINE(bugprone-easily-swappable-parameters)
OperationResult copy(const QString& source, const QString& destination, std::uint64_t size,
                     const std::string& digest) {
    const manifest_bridge::FileIoControl control;
    return result(manifest_bridge::copy_verified_file(
        source.toStdString(), destination.toStdString(), size, digest, control));
}

/** @brief 元ファイルの指定範囲だけを検証しながらコピーする */
OperationResult recover(const QString& source, const FileChunk& chunk, const QString& destination,
                        const std::atomic_bool& cancelled) {
    const manifest_bridge::FileIoControl control{&cancelled};
    return result(manifest_bridge::recover_chunk(source.toStdString(), chunk.offset,
                                                 destination.toStdString(), chunk.size,
                                                 chunk.sha256, control));
}

} // namespace pandd::FileIntegrity
