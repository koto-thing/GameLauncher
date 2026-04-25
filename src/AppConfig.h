//
// Created by koton on 2026/04/01.
//

#ifndef GAMELAUNCHER_APPCONFIG_H
#define GAMELAUNCHER_APPCONFIG_H


namespace AppConfig {
    constexpr std::string_view kAppName          = "GameLauncher";
    constexpr std::string_view kOrganizationName = "PandD";

    inline QString themeFilePath(const QString& themeName) {
        return QStringLiteral(":/theme/%1.qss").arg(themeName);
    }
}


#endif //GAMELAUNCHER_APPCONFIG_H