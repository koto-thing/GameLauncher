function Component() {
    // Qt IFW constructs this object and calls createOperations during installation
}

Component.prototype.createOperations = function() {
    component.createOperations();
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
