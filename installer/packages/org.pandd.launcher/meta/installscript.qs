function Component() {
    // Qt IFW constructs this object and calls createOperations during installation
}

Component.prototype.createOperations = function() {
    component.createOperations();
    if (systemInfo.productType === "windows") {
        component.addOperation("CreateShortcut",
                               "@TargetDir@/bin/PandD Game Launcher.exe",
                               "@StartMenuDir@/PandD Game Launcher.lnk");
    } else if (systemInfo.productType === "linux") {
        component.addOperation("CreateShortcut",
                               "@TargetDir@/bin/PandD Game Launcher",
                               "@HomeDir@/.local/share/applications/pandd-game-launcher.desktop");
    }
};
