#include <windows.h>

#include <filesystem>
#include <string>
#include <system_error>
#include <vector>

namespace {

std::filesystem::path executableDirectory() {
    std::vector<wchar_t> buffer(32768);
    const DWORD length =
        GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
    if (length == 0 || length == buffer.size()) {
        return {};
    }
    return std::filesystem::path(std::wstring(buffer.data(), length)).parent_path();
}

void showLaunchError(const std::wstring& message) {
    MessageBoxW(nullptr, message.c_str(), L"PandD Game Launcher のアンインストール",
                MB_OK | MB_ICONERROR | MB_SETFOREGROUND);
}

} // namespace

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR arguments, int) {
    const auto directory = executableDirectory();
    if (directory.empty()) {
        showLaunchError(L"アンインストーラーの場所を取得できませんでした。");
        return 1;
    }

    const auto maintenanceTool = directory / L"maintenancetool.exe";
    std::error_code fileError;
    if (!std::filesystem::is_regular_file(maintenanceTool, fileError)) {
        showLaunchError(L"maintenancetool.exe が見つかりません。\n"
                        L"ランチャーを再インストールしてから、もう一度お試しください。");
        return 2;
    }

    std::wstring commandLine = L"\"" + maintenanceTool.wstring() + L"\"";
    if (arguments != nullptr && arguments[0] != L'\0') {
        commandLine += L" ";
        commandLine += arguments;
    }
    std::vector<wchar_t> mutableCommand(commandLine.begin(), commandLine.end());
    mutableCommand.push_back(L'\0');

    STARTUPINFOW startupInfo{};
    startupInfo.cb = sizeof(startupInfo);
    PROCESS_INFORMATION processInfo{};
    const BOOL launched =
        CreateProcessW(maintenanceTool.c_str(), mutableCommand.data(), nullptr, nullptr, FALSE, 0,
                       nullptr, directory.c_str(), &startupInfo, &processInfo);
    if (!launched) {
        showLaunchError(L"アンインストール画面を起動できませんでした。\n"
                        L"maintenancetool.exe を直接起動してください。");
        return 3;
    }

    CloseHandle(processInfo.hThread);
    if (WaitForSingleObject(processInfo.hProcess, INFINITE) == WAIT_FAILED) {
        CloseHandle(processInfo.hProcess);
        return 4;
    }
    DWORD exitCode = 1;
    GetExitCodeProcess(processInfo.hProcess, &exitCode);
    CloseHandle(processInfo.hProcess);
    return static_cast<int>(exitCode);
}
