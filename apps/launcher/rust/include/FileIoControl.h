#pragma once

#include <atomic>

namespace pandd::manifest_bridge {

/** @brief Rustの各I/Oブロックで参照するキャンセル状態 */
struct FileIoControl {
    const std::atomic_bool* flag = nullptr;

    /** @brief 所有権を移さず呼び出し元のキャンセル状態を読む */
    bool cancelled() const noexcept {
        return flag != nullptr && flag->load(std::memory_order_relaxed);
    }
};

} // namespace pandd::manifest_bridge
