var launcherDirectoryName = "PandDGameLauncher";
var targetPageInitialized = false;

function Controller() {
}

function normalizedPath(path) {
    var normalized = installer.fromNativeSeparators(path).replace(/\/+$/, "");
    return normalized;
}

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

function inspectDirectory(path) {
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

function updateTargetDirectory() {
    var page = gui.pageById(QInstaller.TargetDirectory);
    if (page === null) {
        return;
    }

    var target = finalInstallPath(page.TargetDirectoryLineEdit.text);
    if (page.TargetDirectoryLineEdit.text !== target) {
        page.setTargetDir(target);
    }

    page.MessageLabel.setText(
        "インストール先の親フォルダを選択してください。\n\n" +
        "ランチャーは、" + installer.toNativeSeparators(target) +
        " としてインストールされます。"
    );

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

Controller.prototype.TargetDirectoryPageCallback = function() {
    var page = gui.pageById(QInstaller.TargetDirectory);
    if (page === null) {
        return;
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
};
