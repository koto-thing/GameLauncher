#pragma once

#include "domain/Models.h"
#include <QString>
#include <atomic>

namespace pandd::FileIntegrity {

/** @brief 共有Rust実装でサイズとSHA-256を検証する */
bool verify(const QString& path, std::uint64_t size, const std::string& digest);

/** @brief チャンクと全体を結合中に検証し原子的に確定する */
OperationResult assemble(const GameFile& file, const QString& chunksRoot,
                         const QString& destination, const std::atomic_bool& cancelled);

/** @brief 既存ファイルを読み取り中に検証してコピーする */
OperationResult copy(const QString& source, const QString& destination, std::uint64_t size,
                     const std::string& digest);

/** @brief 既存ファイルの範囲を検証してキャッシュへ復元する */
OperationResult recover(const QString& source, const FileChunk& chunk, const QString& destination,
                        const std::atomic_bool& cancelled);

} // namespace pandd::FileIntegrity
