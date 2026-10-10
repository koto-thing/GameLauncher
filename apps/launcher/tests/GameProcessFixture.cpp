#include <filesystem>
#include <fstream>
#include <string>

#if defined(_WIN32)
#include <windows.h>
#else
#include <csignal>
#endif

/** @brief Engine非依存のprocess起動・終了・crash fixture */
int main(int argc, char* argv[]) {
    const auto saveDirectory = std::getenv("PANDD_SAVE_DIR");
    if (saveDirectory == nullptr || std::string(saveDirectory).empty()) {
        return 3;
    }
    std::filesystem::create_directories(saveDirectory);
    std::ofstream(std::filesystem::path(saveDirectory) / "fixture-ran.txt") << "ok";
    // 物理配布インストーラーが渡す媒体と選択ゲームを検証する
    for (int index = 1; index + 1 < argc; ++index) {
        if (std::string(argv[index]) == "--install-media" &&
            !std::filesystem::exists(std::filesystem::path(argv[index + 1]) /
                                     "edition/edition.json")) {
            return 4;
        }
        if (std::string(argv[index]) == "--game") {
            std::ofstream(std::filesystem::path(saveDirectory) / "selected-game.txt")
                << argv[index + 1];
        }
    }
    if (argc > 0 && std::string(argv[0]).find("crash") != std::string::npos) {
        // Windows Error Reportingを起動せず非0終了のcrash通知契約を検証する
        return 42;
    }

    // 実際の異常終了をUIなしで発生させ、非0の通常終了との違いを検証する
    if (argc > 0 && std::string(argv[0]).find("abort") != std::string::npos) {
#if defined(_WIN32)
        TerminateProcess(GetCurrentProcess(), 0xC0000005);
#else
        std::raise(SIGKILL);
#endif
    }

    return 0;
}
