use anyhow::Result;
use clap::{Args, Parser, Subcommand};
use pandd_publisher::{
    CANCELLED, gc, release,
    storage::{self, AwsStore, Phase},
};
use std::{path::PathBuf, sync::atomic::Ordering};

#[derive(Parser)]
#[command(version, about = "Build, sign, and publish PandD distribution objects")]
struct Cli {
    #[command(subcommand)]
    command: Operation,
}

#[derive(Args)]
struct Output {
    #[arg(long)]
    output: PathBuf,
}

#[derive(Args)]
struct Remote {
    #[arg(long)]
    endpoint: String,
    #[arg(long)]
    bucket: String,
}

impl Remote {
    /// 実行環境の AWS 認証情報を利用するオブジェクトストアを組み立てる
    ///
    /// # 戻り値
    ///
    /// 指定されたエンドポイントとバケットの AWS ストア
    fn store(self) -> AwsStore {
        AwsStore {
            endpoint: self.endpoint,
            bucket: self.bucket,
        }
    }
}

#[derive(Args)]
struct Platform {
    #[arg(long, value_parser = ["windows", "macos", "linux"])]
    platform: String,
    #[arg(long, value_parser = ["x86_64", "arm64"])]
    arch: String,
}

#[derive(Args)]
struct Cleanup {
    #[arg(long, default_value_t = 7, value_parser = clap::value_parser!(u32).range(7..))]
    grace_days: u32,
    #[arg(long)]
    dry_run: bool,
}

#[derive(Subcommand)]
enum Operation {
    SignFile {
        #[arg(long)]
        source: PathBuf,
        #[arg(long)]
        private_key: PathBuf,
    },
    InitKey {
        #[arg(long)]
        private_key: PathBuf,
        #[arg(long)]
        public_key: PathBuf,
    },
    PublishGame {
        #[arg(long)]
        metadata: PathBuf,
        #[arg(long)]
        build_dir: PathBuf,
        #[command(flatten)]
        output: Output,
        #[arg(long)]
        base_url: String,
        #[arg(long)]
        private_key: PathBuf,
        #[command(flatten)]
        platform: Platform,
        #[arg(long, requires = "bucket")]
        endpoint: Option<String>,
        #[arg(long, requires = "endpoint")]
        bucket: Option<String>,
    },
    PublishAnnouncements {
        #[arg(long)]
        source: PathBuf,
        #[command(flatten)]
        output: Output,
    },
    PublishLauncher {
        #[arg(long)]
        source: PathBuf,
        #[command(flatten)]
        output: Output,
        #[arg(long)]
        base_url: String,
        #[arg(long)]
        locale: String,
        #[command(flatten)]
        platform: Platform,
    },
    PublishChangelog {
        #[arg(long)]
        source: PathBuf,
        #[command(flatten)]
        output: Output,
        #[arg(long)]
        locale: String,
    },
    GcLocal {
        #[command(flatten)]
        output: Output,
        #[command(flatten)]
        cleanup: Cleanup,
    },
    GcRemote {
        #[command(flatten)]
        remote: Remote,
        #[command(flatten)]
        cleanup: Cleanup,
    },
    Upload {
        #[command(flatten)]
        output: Output,
        #[command(flatten)]
        remote: Remote,
    },
    UploadImmutable {
        #[command(flatten)]
        output: Output,
        #[command(flatten)]
        remote: Remote,
    },
    PromotePointers {
        #[command(flatten)]
        output: Output,
        #[command(flatten)]
        remote: Remote,
    },
}

/// 指定された操作を実行し公開処理の安全な境界で終了要求を反映する
///
/// # 戻り値
///
/// 処理が完了した場合は Ok(())
fn main() -> Result<()> {
    let cli = Cli::parse();
    ctrlc::set_handler(|| CANCELLED.store(true, Ordering::Relaxed))?;
    match cli.command {
        Operation::SignFile {
            source,
            private_key,
        } => println!(
            "{}",
            release::sign_payload(&std::fs::read(source)?, &private_key)?
        ),
        Operation::InitKey {
            private_key,
            public_key,
        } => release::create_key(&private_key, &public_key)?,
        Operation::PublishGame {
            metadata,
            build_dir,
            output,
            base_url,
            private_key,
            platform,
            endpoint,
            bucket,
        } => {
            release::build_game(
                &metadata,
                &build_dir,
                &output.output,
                &base_url,
                &private_key,
                &platform.platform,
                &platform.arch,
            )?;
            if let (Some(endpoint), Some(bucket)) = (endpoint, bucket) {
                storage::upload(&output.output, &AwsStore { endpoint, bucket }, Phase::All)?;
            }
        }
        Operation::PublishAnnouncements { source, output } => {
            release::announcements(&source, &output.output)?
        }
        Operation::PublishLauncher {
            source,
            output,
            base_url,
            locale,
            platform,
        } => release::launcher(
            &source,
            &output.output,
            &base_url,
            &locale,
            &platform.platform,
            &platform.arch,
        )?,
        Operation::PublishChangelog {
            source,
            output,
            locale,
        } => release::changelog(&source, &output.output, &locale)?,
        Operation::GcLocal { output, cleanup } => {
            for path in gc::local(&output.output, cleanup.grace_days, cleanup.dry_run)? {
                println!("{}", path.display());
            }
        }
        Operation::GcRemote { remote, cleanup } => {
            for key in gc::remote(&remote.store(), cleanup.grace_days, cleanup.dry_run)? {
                println!("{key}");
            }
        }
        Operation::Upload { output, remote } => {
            storage::upload(&output.output, &remote.store(), Phase::All)?
        }
        Operation::UploadImmutable { output, remote } => {
            storage::upload(&output.output, &remote.store(), Phase::Immutable)?
        }
        Operation::PromotePointers { output, remote } => {
            storage::upload(&output.output, &remote.store(), Phase::Pointers)?
        }
    }
    Ok(())
}
