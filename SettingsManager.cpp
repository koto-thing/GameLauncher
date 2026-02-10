#include <QJsonDocument>
#include <QStandardPaths>
#include <QDir>
#include <QDebug>

#include "SettingsManager.h"

SettingsManager* SettingsManager::s_instance = nullptr;

/**
 * @brief コンストラクタ
 * @param parent 親オブジェクト
 */
SettingsManager::SettingsManager(QObject *parent) : QObject(parent) {
    setDefaultSettings();
}

/**
 * @brief デストラクタ
 */
SettingsManager::~SettingsManager() {
    saveSettings();
}

/**
 * @brief シングルトンインスタンスを取得
 * @return SettingsManagerのインスタンス
 */
SettingsManager* SettingsManager::instance() {
    if (!s_instance) {
        s_instance = new SettingsManager();
        s_instance->loadSettings();
    }
    return s_instance;
}

/**
 * @brief 設定ファイルのパスを取得
 * @return 設定ファイルのフルパス
 */
QString SettingsManager::getSettingsFilePath() const {
    QString appDataPath = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
    QDir dir(appDataPath);
    if (!dir.exists()) {
        dir.mkpath(".");
    }

    return appDataPath + "/settings.json";
}

/**
 * @brief デフォルト設定を適用
 */
void SettingsManager::setDefaultSettings() {
    // 一般設定のデフォルト値
    m_language = "日本語";
    m_autoRunOnStartup = false;
    m_showLauncherAfterGameExit = true;
    m_windowCloseAction = WindowCloseAction::Close;
    m_autoUpdateEnabled = false;

    // ダウンロード設定のデフォルト値
    m_downloadSpeedUnlimited = true;
    m_downloadSpeedLimit = 4096;
    m_continueDownloadAfterGameStart = true;

    // 通知設定のデフォルト値
    m_desktopNotificationEnabled = true;
}

/**
 * @brief 設定をファイルから読み込む
 * @return 成功した場合はtrue、失敗した場合はfalse
 */
bool SettingsManager::loadSettings() {
    QString filePath = getSettingsFilePath();
    QFile file(filePath);

    if (!file.exists()) {
        qDebug() << "Settings file does not exist. Using default settings.";
        return false;
    }

    if (!file.open(QIODevice::ReadOnly)) {
        qWarning() << "Failed to open settings file:" << filePath;
        return false;
    }

    QByteArray data = file.readAll();
    file.close();

    QJsonDocument doc = QJsonDocument::fromJson(data);
    if (doc.isNull() || !doc.isObject()) {
        qWarning() << "Failed to parse settings JSON";
        return false;
    }

    fromJson(doc.object());
    qDebug() << "Settings loaded from:" << filePath;
    return true;
}

/**
 * @brief 設定をファイルに保存する
 * @return 成功した場合はtrue、失敗した場合はfalse
 */
bool SettingsManager::saveSettings() {
    QString filePath = getSettingsFilePath();
    QFile file(filePath);

    if (!file.open(QIODevice::WriteOnly)) {
        qWarning() << "Failed to open settings file for writing:" << filePath;
        return false;
    }

    QJsonDocument doc(toJson());
    file.write(doc.toJson(QJsonDocument::Indented));
    file.close();

    qDebug() << "Settings saved to:" << filePath;
    return true;
}

/**
 * @brief 設定をJSONオブジェクトに変換
 * @return 設定を表すQJsonObject
 */
QJsonObject SettingsManager::toJson() const {
    QJsonObject json;

    // 一般設定
    QJsonObject general;
    general["language"] = m_language;
    general["autoRunOnStartup"] = m_autoRunOnStartup;
    general["showLauncherAfterGameExit"] = m_showLauncherAfterGameExit;
    general["windowCloseAction"] = static_cast<int>(m_windowCloseAction);
    general["autoUpdateEnabled"] = m_autoUpdateEnabled;
    json["general"] = general;

    // ダウンロード設定
    QJsonObject download;
    download["speedUnlimited"] = m_downloadSpeedUnlimited;
    download["speedLimit"] = m_downloadSpeedLimit;
    download["continueAfterGameStart"] = m_continueDownloadAfterGameStart;
    json["download"] = download;

    // 通知設定
    QJsonObject notification;
    notification["desktopNotificationEnabled"] = m_desktopNotificationEnabled;
    json["notification"] = notification;

    return json;
}

/**
 * @brief JSONオブジェクトから設定を読み込む
 * @param json 設定を表すQJsonObject
 */
void SettingsManager::fromJson(const QJsonObject& json) {
    // 一般設定
    if (json.contains("general") && json["general"].isObject()) {
        QJsonObject general = json["general"].toObject();
        m_language = general["language"].toString(m_language);
        m_autoRunOnStartup = general["autoRunOnStartup"].toBool(m_autoRunOnStartup);
        m_showLauncherAfterGameExit = general["showLauncherAfterGameExit"].toBool(m_showLauncherAfterGameExit);
        m_windowCloseAction = static_cast<WindowCloseAction>(general["windowCloseAction"].toInt(static_cast<int>(m_windowCloseAction)));
        m_autoUpdateEnabled = general["autoUpdateEnabled"].toBool(m_autoUpdateEnabled);
    }

    // ダウンロード設定
    if (json.contains("download") && json["download"].isObject()) {
        QJsonObject download = json["download"].toObject();
        m_downloadSpeedUnlimited = download["speedUnlimited"].toBool(m_downloadSpeedUnlimited);
        m_downloadSpeedLimit = download["speedLimit"].toInt(m_downloadSpeedLimit);
        m_continueDownloadAfterGameStart = download["continueAfterGameStart"].toBool(m_continueDownloadAfterGameStart);
    }

    // 通知設定
    if (json.contains("notification") && json["notification"].isObject()) {
        QJsonObject notification = json["notification"].toObject();
        m_desktopNotificationEnabled = notification["desktopNotificationEnabled"].toBool(m_desktopNotificationEnabled);
    }
}

/**
 * @brief 言語設定のセッター
 * @param lang 設定する言語
 */
void SettingsManager::setLanguage(const QString& lang) {
    if (m_language != lang) {
        m_language = lang;
        emit languageChanged(lang);
        emit settingsChanged();
    }
}

/**
 * @brief 一般設定のセッター
 * @param enabled 自動実行を有効にするかどうか
 */
void SettingsManager::setAutoRunOnStartup(bool enabled) {
    if (m_autoRunOnStartup != enabled) {
        m_autoRunOnStartup = enabled;
        emit autoRunOnStartupChanged(enabled);
        emit settingsChanged();
    }
}

/**
 * @brief ランチャー表示設定のセッター
 * @param enabled ゲーム終了後にランチャーを表示するかどうか
 */
void SettingsManager::setShowLauncherAfterGameExit(bool enabled) {
    if (m_showLauncherAfterGameExit != enabled) {
        m_showLauncherAfterGameExit = enabled;
        emit showLauncherAfterGameExitChanged(enabled);
        emit settingsChanged();
    }
}

/**
 * @brief ウィンドウ閉じる動作設定のセッター
 * @param action ウィンドウ閉じる動作
 */
void SettingsManager::setWindowCloseAction(WindowCloseAction action) {
    if (m_windowCloseAction != action) {
        m_windowCloseAction = action;
        emit windowCloseActionChanged(action);
        emit settingsChanged();
    }
}

/**
 * @brief 自動アップデート設定のセッター
 * @param enabled 自動アップデートを有効にするかどうか
 */
void SettingsManager::setAutoUpdateEnabled(bool enabled) {
    if (m_autoUpdateEnabled != enabled) {
        m_autoUpdateEnabled = enabled;
        emit autoUpdateEnabledChanged(enabled);
        emit settingsChanged();
    }
}

/**
 * @brief ダウンロード設定のセッター
 * @param unlimited ダウンロード速度を無制限にするかどうか
 */
void SettingsManager::setDownloadSpeedUnlimited(bool unlimited) {
    if (m_downloadSpeedUnlimited != unlimited) {
        m_downloadSpeedUnlimited = unlimited;
        emit downloadSpeedUnlimitedChanged(unlimited);
        emit settingsChanged();
    }
}

/**
 * @brief ダウンロード速度制限設定のセッター
 * @param limit ダウンロード速度制限値（KB/s）
 */
void SettingsManager::setDownloadSpeedLimit(int limit) {
    if (m_downloadSpeedLimit != limit) {
        m_downloadSpeedLimit = limit;
        emit downloadSpeedLimitChanged(limit);
        emit settingsChanged();
    }
}

/**
 * @brief ゲーム起動中のダウンロード継続設定のセッター
 * @param enabled ゲーム起動中にダウンロードを継続するかどうか
 */
void SettingsManager::setContinueDownloadAfterGameStart(bool enabled) {
    if (m_continueDownloadAfterGameStart != enabled) {
        m_continueDownloadAfterGameStart = enabled;
        emit continueDownloadAfterGameStartChanged(enabled);
        emit settingsChanged();
    }
}

/**
 * @brief デスクトップ通知設定のセッター
 * @param enabled デスクトップ通知を有効にするかどうか
 */
void SettingsManager::setDesktopNotificationEnabled(bool enabled) {
    if (m_desktopNotificationEnabled != enabled) {
        m_desktopNotificationEnabled = enabled;
        emit desktopNotificationEnabledChanged(enabled);
        emit settingsChanged();
    }
}