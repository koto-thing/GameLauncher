use pandd_transfer::command_output;
use std::{
    process::Command,
    time::{Duration, Instant},
};

/// 子プロセスで起動用テストだけを実行する
fn fixture(mode: &str) -> Command {
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args(["--ignored", "--exact", "process_fixture", "--nocapture"])
        .env("PANDD_TRANSFER_TEST_MODE", mode);
    command
}

#[test]
#[ignore = "child process fixture"]
fn process_fixture() {
    match std::env::var("PANDD_TRANSFER_TEST_MODE").unwrap().as_str() {
        "wait" => std::thread::sleep(Duration::from_secs(20)),
        "output" => {
            println!("{}", "x".repeat(256 * 1024));
            eprintln!("{}", "y".repeat(256 * 1024));
        }
        _ => panic!("unknown fixture mode"),
    }
}

#[test]
fn cancellation_kills_and_reaps_provider_process() {
    let started = Instant::now();
    let error = command_output(&mut fixture("wait"), || {
        anyhow::ensure!(started.elapsed() < Duration::from_millis(150), "cancelled");
        Ok(())
    })
    .unwrap_err();
    assert_eq!(error.to_string(), "cancelled");
    assert!(started.elapsed() < Duration::from_secs(2));
}

#[test]
fn captures_both_streams_without_pipe_deadlock() {
    let output = command_output(&mut fixture("output"), || Ok(())).unwrap();
    assert!(output.status.success());
    assert!(output.stdout.len() >= 256 * 1024);
    assert!(output.stderr.len() >= 256 * 1024);
}
