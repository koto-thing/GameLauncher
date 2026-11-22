/** @brief コンポーネントの更新処理を登録する */
function Component() {
    // 更新前に IFW へ置き換え用のバイナリとリソースを登録する
    if (systemInfo.productType === "windows") {
        installer.installationStarted.connect(this, Component.prototype.prepareMaintenanceTool);
    }
}

/** @brief 更新時にインストール先のメンテナンスツールへ PandD のロゴと画面設定を反映する */
Component.prototype.prepareMaintenanceTool = function() {
    var edition = installer.componentByName("org.pandd.edition");
    if (component.updateRequested() || (component.installationRequested() && !edition)) {
        installer.setInstallerBaseBinary("@TargetDir@/maintenance/installerbase.exe");
        // 配布版の名前・起動引数・設定は専用リソースが保持する
        if (!edition) {
            installer.setValue("DefaultResourceReplacement", installer.value("TargetDir") + "/maintenance/update.rcc");
        }
    }
};

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
