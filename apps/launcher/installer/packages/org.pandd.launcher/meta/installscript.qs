function Component() {
    // Qt IFW constructs this object and calls createOperations during installation
}

Component.prototype.createOperations = function() {
    component.createOperations();
    // 配布版のショートカットは固定情報componentが所有し共通更新から独立させる
    if (installer.componentByName("org.pandd.edition") || installer.fileExists("@TargetDir@/edition/edition.json")) {
        return;
    }
    if (systemInfo.productType === "windows") {
        component.addOperation("Mkdir", "@UserStartMenuProgramsPath@/PandD");
        component.addOperation("CreateShortcut",
                               "@TargetDir@/bin/PandD Game Launcher.exe",
                               "@UserStartMenuProgramsPath@/PandD/PandD Game Launcher.lnk",
                               "workingDirectory=@TargetDir@/bin",
                               "iconPath=@TargetDir@/bin/PandD Game Launcher.exe",
                               "description=PandD Game Launcher");
    } else if (systemInfo.productType === "linux") {
        component.addOperation("CreateShortcut",
                               "@TargetDir@/bin/PandD Game Launcher",
                               "@HomeDir@/.local/share/applications/pandd-game-launcher.desktop");
    }
};
