#include "WindowsStartupRepository.h"

#include <stdexcept>

#ifdef Q_OS_WIN
#include <windows.h>
#include <QString>
#include <stdexcept>

void WindowsStartupRepository::enable (
    const std::string &appName, const std::string &executablePath
) {
    HKEY hKey;
    LONG result = RegOpenKeyExW(
        HKEY_CURRENT_USER, kRegistryKey, 0, KEY_SET_VALUE, &hKey
    );

    if (result != ERROR_SUCCESS) {
        throw std::runtime_error("Failed to open registry key");
    }

    // パスをワイド文字列に変換する
    std::wstring wPath(executablePath.begin(), executablePath.end());
    std::wstring wName(appName.begin(), appName.end());

    result = RegSetValueExW(
        hKey,
        wName.c_str(),
        0,
        REG_SZ,
        reinterpret_cast<const BYTE *>(wPath.c_str()),
        static_cast<DWORD>((wPath.size()) + 1) * sizeof(wchar_t)
    );

    RegCloseKey(hKey);

    if (result != ERROR_SUCCESS) {
        throw std::runtime_error("Failed to set registry key");
    }
}

void WindowsStartupRepository::disable(const std::string &appName) {
    HKEY hKey;
    LONG result = RegOpenKeyExW(
        HKEY_CURRENT_USER, kRegistryKey, 0, KEY_SET_VALUE, &hKey
    );

    if (result != ERROR_SUCCESS) {
        throw std::runtime_error("Failed to open registry key");
    }

    std::wstring wName(appName.begin(), appName.end());
    result = RegSetValueExW(
        hKey, wName.c_str()
    );

    RegCloseKey(hKey);

    if (result != ERROR_SUCCESS && result != ERROR_FILE_NOT_FOUND) {
        throw std::runtime_error("Failed to set registry key");
    }
}

bool WindowsStartupRepository::isEnabled(const std::string &appName) {
    HKEY hKey;
    LONG result = RegOpenKeyExW(
        HKEY_CURRENT_USER, kRegistryKey, 0, KEY_QUERY_VALUE, &hKey
    );

    if (result != ERROR_SUCCESS) {
        return false;
    }

    std::wstring wName(appName.begin(), appName.end());
    result = RegQueryValueExW(
        hKey, wName.c_str(), nullptr, nullptr, nullptr, nullptr
    );

    RegCloseKey(hKey);

    return result == ERROR_SUCCESS;
}
#endif