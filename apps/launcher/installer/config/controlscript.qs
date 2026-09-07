var launcherDirectoryName = "PandDGameLauncher";
var targetPageInitialized = false;

/** @brief platform別のランチャー実行pathを返す */
function getLauncherExecutablePath(targetDir) {
    // IFWのtarget directoryから実行pathを組み立てる
    var prefix = targetDir ? installer.fromNativeSeparators(targetDir).replace(/\/+$/, "") : "@TargetDir@";
    if (systemInfo.productType === "windows") {
        return prefix + "/bin/PandD Game Launcher.exe";
    } else if (systemInfo.productType === "osx" || systemInfo.productType === "darwin") {
        return prefix + "/PandD Game Launcher.app/Contents/MacOS/PandD Game Launcher";
    }
    return prefix + "/bin/PandD Game Launcher";
}

/** @brief 指定installer pageの表示時処理を登録する */
function hookPageEntered(pageId) {
    var page = gui.pageById(pageId);
    if (!page || !page.entered) {
        return;
    }
    page.entered.connect(function() {
        if (installer.isInstaller()) {
            try {
                if (pageId === QInstaller.Introduction) {
                    page.title = "PANDD LAUNCHER";
                } else if (pageId === QInstaller.TargetDirectory) {
                    page.title = "CHOOSE YOUR DESTINATION";
                } else if (pageId === QInstaller.PerformInstallation) {
                    page.title = "LOADING PANDD LAUNCHER";
                    page.subTitle = "PREPARING YOUR ADVENTURE...";
                } else if (pageId === QInstaller.InstallationFinished) {
                    if (installer.status === QInstaller.Success) {
                        page.title = "READY TO PLAY";
                    } else {
                        page.title = "SETUP INCOMPLETE";
                    }
                }
            } catch (e) {
                // Safe property assignment fallback
            }
        }
    });
}

/** @brief installer共通設定とpage callbackを初期化する */
function Controller() {
    // installer modeだけに実行設定を適用する
    if (installer.isInstaller()) {
        gui.showSettingsButton(false);
        installer.setValue("RunProgram", getLauncherExecutablePath());
        installer.setDefaultPageVisible(QInstaller.ComponentSelection, false);
        installer.setDefaultPageVisible(QInstaller.ReadyForInstallation, false);
        installer.setDefaultPageVisible(QInstaller.StartMenuSelection, false);
        installer.setDefaultPageVisible(QInstaller.LicenseCheck, false);
    }

    // 利用する全pageへ表示時処理を登録する
    var pages = [
        QInstaller.Introduction,
        QInstaller.TargetDirectory,
        QInstaller.ComponentSelection,
        QInstaller.LicenseCheck,
        QInstaller.StartMenuSelection,
        QInstaller.ReadyForInstallation,
        QInstaller.PerformInstallation,
        QInstaller.InstallationFinished
    ];
    for (var i = 0; i < pages.length; i++) {
        hookPageEntered(pages[i]);
    }
}

/** @brief native separatorを統一して末尾separatorを除去する */
function normalizedPath(path) {
    var normalized = installer.fromNativeSeparators(path).replace(/\/+$/, "");
    return normalized;
}

/** @brief ランチャー専用の最終インストールpathを返す */
function finalInstallPath(path) {
    var normalized = normalizedPath(path);
    if (normalized === "") {
        return "";
    }
    var suffix = "/" + launcherDirectoryName;
    if (normalized.toLowerCase().slice(-suffix.length) === suffix.toLowerCase()) {
        return normalized;
    }
    return normalized + suffix;
}

/** @brief install directoryの存在と空状態を検査する */
function inspectDirectory(path) {
    // 未作成directoryは空として扱う
    if (!installer.fileExists(path)) {
        return "empty";
    }

    if (systemInfo.productType === "windows") {
        var script =
            "& { $ErrorActionPreference='Stop'; " +
            "try { " +
            "if (-not (Test-Path -LiteralPath $args[0] -PathType Container)) { exit 21 }; " +
            "if (@(Get-ChildItem -LiteralPath $args[0] -Force).Count -gt 0) { exit 20 }; " +
            "exit 0 " +
            "} catch { exit 21 } }";
        var result = installer.execute("powershell.exe",
                                       ["-NoProfile", "-NonInteractive", "-Command", script, path]);
        if (result.length < 2 || Number(result[1]) === 21) {
            return "unreadable";
        }
        return Number(result[1]) === 20 ? "not-empty" : "empty";
    }

    var result = installer.execute("/bin/sh",
                                   ["-c",
                                    "test -d \"$1\" || exit 21; " +
                                    "test -z \"$(ls -A -- \"$1\" 2>/dev/null)\"",
                                    "pandd-installer", path]);
    if (result.length < 2 || Number(result[1]) === 21) {
        return "unreadable";
    }
    return Number(result[1]) === 0 ? "empty" : "not-empty";
}

/** @brief IFW introduction pageの表示を初期化する */
Controller.prototype.IntroductionPageCallback = function() {
    var page = gui.pageById(QInstaller.Introduction);
    if (page && installer.isInstaller()) {
        try {
            page.title = "PANDD LAUNCHER";
        } catch (e) {}

        // installerの案内文を組み立てる
        var welcomeHtml =
            "<div style='padding: 8px 4px;'>" +
            "<h1 style='color: #ffffff; font-size: 20px; font-weight: bold; margin: 0 0 6px 0;'>" +
            "PandD Game Launcher" +
            "</h1>" +
            "<p style='color: #65a7ff; font-size: 13px; font-weight: bold; margin: 0 0 16px 0; letter-spacing: 0.5px;'>" +
            "READY FOR YOUR NEXT ADVENTURE" +
            "</p>" +
            "<p style='color: #c8d0dc; font-size: 13px; line-height: 1.6; margin: 0 0 12px 0;'>" +
            "PandD Game Launcher のセットアップを開始します。<br>" +
            "本体ランチャーおよびゲーム管理ランタイムをインストールします。" +
            "</p>" +
            "<p style='color: #8a99ad; font-size: 12px; line-height: 1.5; margin: 0;'>" +
            "CONTINUE // インストール先を設定" +
            "</p>" +
            "</div>";

        if (page.MessageLabel) {
            page.MessageLabel.setText(welcomeHtml);
        }
    }
};

/** @brief install先表示と空directory検証を更新する */
function updateTargetDirectory() {
    var page = gui.pageById(QInstaller.TargetDirectory);
    if (!page) {
        return;
    }

    var target = finalInstallPath(page.TargetDirectoryLineEdit.text);
    if (page.TargetDirectoryLineEdit.text !== target) {
        page.setTargetDir(target);
    }

    // platform別のshortcut説明を設定する
    var shortcutInfo = "";
    if (systemInfo.productType === "windows") {
        shortcutInfo = "ショートカット: スタートメニュー (PandD / PandD Game Launcher) に登録されます。";
    } else if (systemInfo.productType === "linux") {
        shortcutInfo = "ショートカット: デスクトップエントリー (pandd-game-launcher.desktop) に登録されます。";
    } else {
        shortcutInfo = "ショートカット: アプリケーションメニューに登録されます。";
    }

    // 選択されたinstall先をpageへ表示する
    page.MessageLabel.setText(
        "インストール先の親フォルダを選択してください。\n\n" +
        "ランチャーは、" + installer.toNativeSeparators(target) +
        " としてインストールされます。\n\n" +
        shortcutInfo + "\n\n" +
        "INSTALL // 準備を開始"
    );

    // install先の安全性を検証して自動回答を設定する
    var state = inspectDirectory(target);
    if (state === "not-empty") {
        installer.setMessageBoxAutomaticAnswer("OverwriteTargetDirectory", QMessageBox.No);
        page.WarningLabel.setText(
            "インストール先フォルダが空ではありません。\n" +
            "対象: " + installer.toNativeSeparators(target) + "\n" +
            "安全のため、別の空のフォルダを選択してください。"
        );
        return;
    }
    if (state === "unreadable") {
        installer.setMessageBoxAutomaticAnswer("OverwriteTargetDirectory", QMessageBox.No);
        page.WarningLabel.setText(
            "インストール先フォルダの内容を確認できません。\n" +
            "対象: " + installer.toNativeSeparators(target) + "\n" +
            "読み取り可能な別のフォルダを選択してください。"
        );
        return;
    }
    installer.setMessageBoxAutomaticAnswer("OverwriteTargetDirectory", QMessageBox.Yes);
    page.WarningLabel.setText("");
}

/** @brief IFW target directory pageの表示とsignalを初期化する */
Controller.prototype.TargetDirectoryPageCallback = function() {
    var page = gui.pageById(QInstaller.TargetDirectory);
    if (page) {
        if (installer.isInstaller()) {
            try {
                page.title = "CHOOSE YOUR DESTINATION";
            } catch (e) {}
        }
        if (!targetPageInitialized) {
            page.TargetDirectoryLineEdit.editingFinished.connect(updateTargetDirectory);
            var browseButton = gui.findChild(page, "TargetDirectoryButton");
            if (browseButton !== null) {
                browseButton.clicked.connect(updateTargetDirectory);
            }
            targetPageInitialized = true;
        }
        updateTargetDirectory();
    }
};

/** @brief component selection pageを初期化する */
Controller.prototype.ComponentSelectionPageCallback = function() {};

/** @brief license agreement pageを初期化する */
Controller.prototype.LicenseAgreementPageCallback = function() {};

/** @brief start menu directory pageを初期化する */
Controller.prototype.StartMenuDirectoryPageCallback = function() {};

/** @brief ready for installation pageを初期化する */
Controller.prototype.ReadyForInstallationPageCallback = function() {};

/** @brief installation実行中の表示を初期化する */
Controller.prototype.PerformInstallationPageCallback = function() {
    var page = gui.pageById(QInstaller.PerformInstallation);
    if (page && installer.isInstaller()) {
        try {
            page.title = "LOADING PANDD LAUNCHER";
            page.subTitle = "PREPARING YOUR ADVENTURE...";
        } catch (e) {
            // Safe fallback if property assignment varies across IFW revisions
        }
    }
};

/** @brief installation完了または失敗の表示を構築する */
Controller.prototype.FinishedPageCallback = function() {
    var page = gui.pageById(QInstaller.InstallationFinished);

    if (installer.isInstaller()) {
        if (installer.status === QInstaller.Success) {
            if (page) {
                try {
                    page.title = "READY TO PLAY";
                } catch (e) {}
            }
            var targetDir = installer.value("TargetDir");
            var executablePath = getLauncherExecutablePath(targetDir);
            installer.setValue("RunProgram", executablePath);

            // 成功時の案内文と自動起動設定を構築する
            var finishedHtml =
                "<div style='padding: 8px 4px;'>" +
                "<h1 style='color: #65a7ff; font-size: 22px; font-weight: bold; margin: 0 0 6px 0; letter-spacing: 1px;'>" +
                "READY TO PLAY" +
                "</h1>" +
                "<p style='color: #ffffff; font-size: 14px; font-weight: bold; margin: 0 0 16px 0;'>" +
                "インストールが正常に完了しました" +
                "</p>" +
                "<p style='color: #c8d0dc; font-size: 13px; line-height: 1.6; margin: 0 0 14px 0;'>" +
                "PandD Game Launcher の準備が整いました。<br>" +
                "LAUNCH // 右下の操作からランチャーを起動し、ゲームの世界へ飛び込みましょう。" +
                "</p>" +
                "<p style='color: #8a99ad; font-size: 12px; margin: 0;'>" +
                "インストール先: " + installer.toNativeSeparators(targetDir) +
                "</p>" +
                "</div>";

            if (page && page.MessageLabel) {
                page.MessageLabel.setText(finishedHtml);
            }
            if (page && page.RunItCheckBox) {
                page.RunItCheckBox.setChecked(true);
                page.RunItCheckBox.setVisible(false);
            }
        } else {
            if (page) {
                try {
                    page.title = "SETUP INCOMPLETE";
                } catch (e) {}
            }
            installer.setValue("RunProgram", "");
            // 失敗時は自動起動を無効にして案内文を表示する
            var failureHtml =
                "<div style='padding: 8px 4px;'>" +
                "<h1 style='color: #ff6b6b; font-size: 20px; font-weight: bold; margin: 0 0 6px 0;'>" +
                "SETUP INCOMPLETE" +
                "</h1>" +
                "<p style='color: #c8d0dc; font-size: 13px; line-height: 1.6; margin: 0;'>" +
                "インストールが完了しませんでした。右下の操作から終了してください。" +
                "</p>" +
                "</div>";

            if (page && page.MessageLabel) {
                page.MessageLabel.setText(failureHtml);
            }
            if (page && page.RunItCheckBox) {
                page.RunItCheckBox.setChecked(false);
                page.RunItCheckBox.setVisible(false);
            }
        }
    } else {
        installer.setValue("RunProgram", "");
        if (page && page.RunItCheckBox) {
            page.RunItCheckBox.setChecked(false);
            page.RunItCheckBox.setVisible(false);
        }
    }
};
