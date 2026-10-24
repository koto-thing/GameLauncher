mod installation;

use anyhow::Result;
use pandd_distribution_contracts::{crypto, manifest, schema};

#[cxx::bridge(namespace = "pandd::manifest_bridge")]
mod ffi {
    struct FileChunk {
        offset: u64,
        size: u64,
        sha256: String,
        url: String,
    }

    struct GameFile {
        path: String,
        size: u64,
        sha256: String,
        executable: bool,
        chunks: Vec<FileChunk>,
    }

    struct GameRelease {
        schema_version: u32,
        game_id: String,
        version: String,
        platform: String,
        arch: String,
        minimum_launcher_version: String,
        engine: String,
        entrypoint: String,
        working_directory: String,
        arguments: Vec<String>,
        save_directory_name: String,
        total_size: u64,
        files: Vec<GameFile>,
        published_at: String,
        signature: String,
    }

    struct DownloadChunk {
        url: String,
        digest: String,
        size: u64,
    }

    struct LocalPart {
        path: String,
        size: u64,
        sha256: String,
    }

    struct IoStatus {
        code: u8,
        detail: String,
    }

    unsafe extern "C++" {
        include!("DownloadControl.h");
        type DownloadControl;
        fn cancelled(self: &DownloadControl) -> bool;
        fn paused(self: &DownloadControl) -> bool;
        fn progress(self: &DownloadControl, received: u64, speed: u64);
        include!("FileIoControl.h");
        type FileIoControl;
        fn cancelled(self: &FileIoControl) -> bool;
    }

    extern "Rust" {
        fn download_chunks(
            chunks: &[DownloadChunk],
            root: &str,
            cached: u64,
            speed_limit: u64,
            control: &DownloadControl,
        ) -> IoStatus;
        fn activate_install(
            root: &str,
            game_id: &str,
            version: &str,
            entrypoint: &str,
            imported: bool,
        ) -> IoStatus;
        fn cleanup_install(root: &str, game_id: &str) -> IoStatus;
        fn discard_install(root: &str, game_id: &str, version: &str, imported: bool) -> IoStatus;

        fn verify_file(path: &str, size: u64, digest: &str) -> bool;
        fn assemble_files(
            parts: &[LocalPart],
            destination: &str,
            size: u64,
            digest: &str,
            control: &FileIoControl,
        ) -> IoStatus;
        fn copy_verified_file(
            source: &str,
            destination: &str,
            size: u64,
            digest: &str,
            control: &FileIoControl,
        ) -> IoStatus;
        fn recover_chunk(
            source: &str,
            offset: u64,
            destination: &str,
            size: u64,
            digest: &str,
            control: &FileIoControl,
        ) -> IoStatus;

        fn validate_manifest(bytes: &[u8], allowed_hosts: &[String]) -> Result<()>;
        fn verify_manifest(
            bytes: &[u8],
            public_key: &str,
            allowed_hosts: &[String],
        ) -> Result<GameRelease>;
        fn validate_public_key(public_key: &str) -> Result<()>;
        fn verify_signature(payload: &[u8], signature: &str, public_key: &str) -> bool;
        fn safe_relative_path(path: &str) -> bool;
    }
}

/// 署名の真正性とは別に JSON と配信ホストを検証する
///
/// # 引数
///
/// * `bytes` - 処理対象のバイト列
/// * `allowed_hosts` - 配信を許可するホスト名の一覧
///
/// # 戻り値
///
/// 処理が完了した場合は Ok(())
fn validate_manifest(bytes: &[u8], allowed_hosts: &[String]) -> Result<()> {
    manifest::validate_hosts(&manifest::parse(bytes)?, allowed_hosts)
}

/// 認証と検証を終えた Rust のリリースだけを CXX 境界へ渡す
///
/// # 引数
///
/// * `bytes` - 処理対象のバイト列
/// * `public_key` - Base64 形式の固定公開鍵
/// * `allowed_hosts` - 配信を許可するホスト名の一覧
///
/// # 戻り値
///
/// 認証済みリリースの CXX 受渡し用データ
fn verify_manifest(
    bytes: &[u8],
    public_key: &str,
    allowed_hosts: &[String],
) -> Result<ffi::GameRelease> {
    let release = manifest::verify(bytes, public_key, allowed_hosts)?;
    Ok(ffi::GameRelease {
        schema_version: release.schema_version,
        game_id: release.game_id,
        version: release.version,
        platform: release.platform,
        arch: release.arch,
        minimum_launcher_version: release.minimum_launcher_version,
        engine: release.engine,
        entrypoint: release.entrypoint,
        working_directory: release.working_directory,
        arguments: release.arguments,
        save_directory_name: release.save_directory_name,
        total_size: release.total_size,
        files: release
            .files
            .into_iter()
            .map(|file| ffi::GameFile {
                path: file.path,
                size: file.size,
                sha256: file.sha256,
                executable: file.executable,
                chunks: file
                    .chunks
                    .into_iter()
                    .map(|chunk| ffi::FileChunk {
                        offset: chunk.offset,
                        size: chunk.size,
                        sha256: chunk.sha256,
                        url: chunk.url,
                    })
                    .collect(),
            })
            .collect(),
        published_at: release.published_at,
        signature: release.signature,
    })
}

/// リポジトリの構築時に不正な固定公開鍵を拒否する
///
/// # 引数
///
/// * `public_key` - Base64 形式の固定公開鍵
///
/// # 戻り値
///
/// 処理が完了した場合は Ok(())
fn validate_public_key(public_key: &str) -> Result<()> {
    crypto::public_key(public_key).map(|_| ())
}

/// 共通の暗号処理で物理配布プロファイルの分離署名を検証する
///
/// # 引数
///
/// * `payload` - 署名または検証の対象となる元のバイト列
/// * `signature` - Base64 形式の Ed25519 署名
/// * `public_key` - Base64 形式の固定公開鍵
///
/// # 戻り値
///
/// 署名が固定公開鍵と一致する場合は true
fn verify_signature(payload: &[u8], signature: &str, public_key: &str) -> bool {
    crypto::verify(payload, signature, public_key).is_ok()
}

/// ランチャーの入力に共有の相対パス規則を適用する
///
/// # 引数
///
/// * `path` - 操作または検証の対象パス
///
/// # 戻り値
///
/// 共有の相対パス規則を満たす場合は true
fn safe_relative_path(path: &str) -> bool {
    schema::relative_path(path).is_ok()
}

/// C++ 側へ整合性不一致、キャンセル、入出力エラーの区分を伝える
///
/// # 引数
///
/// * `result` - C++ 側へ変換するファイル操作の結果
///
/// # 戻り値
///
/// 成功は0、整合性不一致は1、キャンセルは2、その他のエラーは3の状態
fn io_status(result: anyhow::Result<()>) -> ffi::IoStatus {
    match result {
        Ok(()) => ffi::IoStatus {
            code: 0,
            detail: String::new(),
        },
        Err(error) => ffi::IoStatus {
            code: match error.downcast_ref::<pandd_file_integrity::Failure>() {
                Some(pandd_file_integrity::Failure::Integrity) => 1,
                Some(pandd_file_integrity::Failure::Cancelled) => 2,
                None => 3,
            },
            detail: format!("{error:#}"),
        },
    }
}

/// 読込ブロックごとに CXX 境界を越えずディスク上のファイルを検証する
///
/// # 引数
///
/// * `path` - 操作または検証の対象パス
/// * `size` - 期待するバイト数
/// * `digest` - 期待する SHA-256 の16進文字列
///
/// # 戻り値
///
/// サイズと SHA-256 が一致する場合は true
fn verify_file(path: &str, size: u64, digest: &str) -> bool {
    pandd_file_integrity::verify_file(path.as_ref(), size, digest).is_ok()
}

/// 認証対象のチャンクを結合し全体のハッシュが一致してから確定する
///
/// # 引数
///
/// * `parts` - 結合順に並んだ検証対象チャンク
/// * `destination` - 書込先のパス
/// * `size` - 期待するバイト数
/// * `digest` - 期待する SHA-256 の16進文字列
/// * `control` - ファイル処理のキャンセル状態を取得する制御オブジェクト
///
/// # 戻り値
///
/// 操作結果の状態コードと詳細文字列
fn assemble_files(
    parts: &[ffi::LocalPart],
    destination: &str,
    size: u64,
    digest: &str,
    control: &ffi::FileIoControl,
) -> ffi::IoStatus {
    let parts: Vec<_> = parts
        .iter()
        .map(|part| pandd_file_integrity::Part {
            path: part.path.as_str().into(),
            size: part.size,
            sha256: part.sha256.clone(),
        })
        .collect();
    io_status(pandd_file_integrity::assemble(
        &parts,
        destination.as_ref(),
        size,
        digest,
        || control.cancelled(),
    ))
}

/// コピー元とコピー先を別々にハッシュ化せず既存ファイルを検証付きでコピーする
///
/// # 引数
///
/// * `source` - 入力ファイルまたはディレクトリのパス
/// * `destination` - 書込先のパス
/// * `size` - 期待するバイト数
/// * `digest` - 期待する SHA-256 の16進文字列
/// * `control` - ファイル処理のキャンセル状態を取得する制御オブジェクト
///
/// # 戻り値
///
/// 操作結果の状態コードと詳細文字列
fn copy_verified_file(
    source: &str,
    destination: &str,
    size: u64,
    digest: &str,
    control: &ffi::FileIoControl,
) -> ffi::IoStatus {
    io_status(pandd_file_integrity::copy_verified(
        source.as_ref(),
        destination.as_ref(),
        size,
        digest,
        || control.cancelled(),
    ))
}

/// コピー中に内容を検証してキャッシュのチャンクを復元する
///
/// # 引数
///
/// * `source` - 入力ファイルまたはディレクトリのパス
/// * `offset` - 読込元の先頭からのバイト位置
/// * `destination` - 書込先のパス
/// * `size` - 期待するバイト数
/// * `digest` - 期待する SHA-256 の16進文字列
/// * `control` - ファイル処理のキャンセル状態を取得する制御オブジェクト
///
/// # 戻り値
///
/// 操作結果の状態コードと詳細文字列
fn recover_chunk(
    source: &str,
    offset: u64,
    destination: &str,
    size: u64,
    digest: &str,
    control: &ffi::FileIoControl,
) -> ffi::IoStatus {
    io_status(pandd_file_integrity::copy_range_verified(
        source.as_ref(),
        offset,
        destination.as_ref(),
        size,
        digest,
        || control.cancelled(),
    ))
}

/// インストールを確定し確定後の整理に関する警告を区別して返す
///
/// # 引数
///
/// * `root` - 操作の基準となる管理ルート
/// * `game_id` - インストール先と照合するゲーム ID
/// * `version` - 対象リリースのバージョン
/// * `entrypoint` - リリース内の起動ファイルの相対パス
/// * `imported` - 物理配布からの取込用ステージングを選ぶ場合は true
///
/// # 戻り値
///
/// 有効化の状態コードと整理の警告文字列、有効化後の整理失敗も成功コード0
fn activate_install(
    root: &str,
    game_id: &str,
    version: &str,
    entrypoint: &str,
    imported: bool,
) -> ffi::IoStatus {
    match installation::activate(root.as_ref(), game_id, version, entrypoint, imported) {
        Ok(detail) => ffi::IoStatus { code: 0, detail },
        Err(error) => io_status(Err(error)),
    }
}

/// 識別済みのインストール済みゲームに属する一時ツリーだけを削除する
///
/// # 引数
///
/// * `root` - 操作の基準となる管理ルート
/// * `game_id` - インストール先と照合するゲーム ID
///
/// # 戻り値
///
/// 操作結果の状態コードと詳細文字列
fn cleanup_install(root: &str, game_id: &str) -> ffi::IoStatus {
    io_status(installation::cleanup(root.as_ref(), game_id))
}

/// 管理ルートの境界を検証して失敗したステージングだけを削除する
///
/// # 引数
///
/// * `root` - 操作の基準となる管理ルート
/// * `game_id` - インストール先と照合するゲーム ID
/// * `version` - 対象リリースのバージョン
/// * `imported` - 物理配布からの取込用ステージングを選ぶ場合は true
///
/// # 戻り値
///
/// 操作結果の状態コードと詳細文字列
fn discard_install(root: &str, game_id: &str, version: &str, imported: bool) -> ffi::IoStatus {
    io_status(installation::discard(
        root.as_ref(),
        game_id,
        version,
        imported,
    ))
}

impl pandd_transfer::download::Control for ffi::DownloadControl {
    /// 共有のキャンセルフラグを取得する
    ///
    /// # 戻り値
    ///
    /// キャンセルが要求されている場合は true
    fn cancelled(&self) -> bool {
        self.cancelled()
    }
    /// 共有の一時停止フラグを取得する
    ///
    /// # 戻り値
    ///
    /// 一時停止が要求されている場合は true
    fn paused(&self) -> bool {
        self.paused()
    }
    /// 元の呼出元スレッドで進捗コールバックを実行する
    ///
    /// # 引数
    ///
    /// * `received` - キャッシュ済みデータを含む取得済みバイト数
    /// * `speed` - ネットワーク転送速度のバイト毎秒
    ///
    /// # 戻り値
    ///
    /// 戻り値なし
    fn progress(&self, received: u64, speed: u64) {
        self.progress(received, speed);
    }
}

/// UI 通知と管理ルートの検証を保ちながらチャンクをまとめて取得する
///
/// # 引数
///
/// * `chunks` - 取得するチャンクの一覧
/// * `root` - 操作の基準となる管理ルート
/// * `cached` - 開始時点で検証済みのキャッシュのバイト数
/// * `speed_limit` - 全チャンクで共有するバイト毎秒の上限、0は無制限
/// * `control` - 一時停止やキャンセルの状態と進捗通知先
///
/// # 戻り値
///
/// 成功は0、キャンセルは2、その他は3、再試行可能な通信エラーは4、再試行不可は5の状態
fn download_chunks(
    chunks: &[ffi::DownloadChunk],
    root: &str,
    cached: u64,
    speed_limit: u64,
    control: &ffi::DownloadControl,
) -> ffi::IoStatus {
    let chunks: Vec<_> = chunks
        .iter()
        .map(|chunk| pandd_transfer::download::Chunk {
            url: chunk.url.clone(),
            digest: chunk.digest.clone(),
            size: chunk.size,
        })
        .collect();
    match pandd_transfer::download::download(&chunks, root.as_ref(), cached, speed_limit, control) {
        Ok(()) => ffi::IoStatus {
            code: 0,
            detail: String::new(),
        },
        Err(error) => ffi::IoStatus {
            code: match error.downcast_ref::<pandd_transfer::download::Failure>() {
                Some(pandd_transfer::download::Failure::Cancelled) => 2,
                Some(pandd_transfer::download::Failure::Http { retryable: true }) => 4,
                Some(pandd_transfer::download::Failure::Http { retryable: false }) => 5,
                None => 3,
            },
            detail: format!("{error:#}"),
        },
    }
}
