#pragma once
#include <atomic>
#include <cstdint>
#include <functional>

namespace pandd::manifest_bridge {
struct DownloadControl {
    const std::atomic_bool* cancellation;
    const std::atomic_bool* pause;
    std::function<void(std::uint64_t, std::uint64_t)> callback;

    /** @brief Read cancellation from the application worker */
    bool cancelled() const noexcept { return cancellation->load(std::memory_order_relaxed); }

    /** @brief Read pause without blocking the runtime */
    bool paused() const noexcept { return pause->load(std::memory_order_relaxed); }

    /** @brief Deliver progress on the calling worker thread */
    void progress(std::uint64_t received, std::uint64_t speed) const { callback(received, speed); }
};
} // namespace pandd::manifest_bridge
