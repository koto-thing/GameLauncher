#include <filesystem>
#include <fstream>
#include <string>

/** @brief Engine非依存のprocess起動・終了・crash fixture */
int main(int argc, char* argv[]) {
    const auto saveDirectory = std::getenv("PANDD_SAVE_DIR");
    if (saveDirectory == nullptr || std::string(saveDirectory).empty()) {
        return 3;
    }
    std::filesystem::create_directories(saveDirectory);
    std::ofstream(std::filesystem::path(saveDirectory) / "fixture-ran.txt") << "ok";
    if (argc > 0 && std::string(argv[0]).find("crash") != std::string::npos) {
        // A non-zero exit exercises the launcher's crash-reporting contract without
        // invoking Windows Error Reporting, which can keep CI processes alive.
        return 42;
    }
    return 0;
}
