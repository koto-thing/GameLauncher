#![cfg(feature = "http")]
use pandd_transfer::download::{Chunk, Control, Failure, download};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

#[derive(Default)]
struct State {
    cancelled: AtomicBool,
    paused: AtomicBool,
    progress: Mutex<Vec<u64>>,
}
impl Control for State {
    /// Read cancellation shared with the controller
    fn cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }
    /// Read pause state shared with the controller
    fn paused(&self) -> bool {
        self.paused.load(Ordering::Relaxed)
    }
    /// Record aggregate progress for boundedness assertions
    fn progress(&self, received: u64, _: u64) {
        self.progress.lock().unwrap().push(received);
    }
}

/// Serve one deterministic HTTP response and expose the captured request
fn server(response: Vec<u8>) -> (String, thread::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/blob", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut request = Vec::new();
        let mut byte = [0; 1];
        while !request.ends_with(b"\r\n\r\n") {
            socket.read_exact(&mut byte).unwrap();
            request.push(byte[0]);
        }
        let _ = socket.write_all(&response);
        String::from_utf8(request).unwrap()
    });
    (url, worker)
}

/// Describe immutable bytes using the manifest digest
fn chunk(url: String, body: &[u8]) -> Chunk {
    Chunk {
        url,
        digest: format!("{:x}", Sha256::digest(body)),
        size: body.len() as u64,
    }
}

#[test]
fn rejects_wrong_range_without_appending() {
    let body = b"abcdefgh";
    let (url, worker) = server(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 4\r\nContent-Range: bytes 3-6/8\r\nConnection: close\r\n\r\nefgh".to_vec());
    let chunk = chunk(url, body);
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join(&chunk.digest), b"abcd").unwrap();
    let error = download(
        std::slice::from_ref(&chunk),
        dir.path(),
        0,
        0,
        &State::default(),
    )
    .unwrap_err();
    assert!(matches!(
        error.downcast_ref::<Failure>(),
        Some(Failure::Http { retryable: false })
    ));
    assert_eq!(
        std::fs::read(dir.path().join(&chunk.digest)).unwrap(),
        b"abcd"
    );
    assert!(
        worker
            .join()
            .unwrap()
            .to_lowercase()
            .contains("range: bytes=4-")
    );
}

#[test]
fn full_response_replaces_existing_prefix() {
    let body = b"abcdefgh";
    let (url, worker) = server(
        b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\nabcdefgh".to_vec(),
    );
    let chunk = chunk(url, body);
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join(&chunk.digest), b"abcd").unwrap();
    download(
        std::slice::from_ref(&chunk),
        dir.path(),
        0,
        0,
        &State::default(),
    )
    .unwrap();
    assert_eq!(std::fs::read(dir.path().join(&chunk.digest)).unwrap(), body);
    worker.join().unwrap();
}

#[test]
fn resumes_prefix_and_bounds_progress() {
    let body = b"abcdefgh";
    let (url, worker) = server(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 4\r\nContent-Range: bytes 4-7/8\r\nConnection: close\r\n\r\nefgh".to_vec());
    let chunk = chunk(url, body);
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join(&chunk.digest), b"abcd").unwrap();
    let state = State::default();
    download(std::slice::from_ref(&chunk), dir.path(), 7, 0, &state).unwrap();
    assert_eq!(std::fs::read(dir.path().join(&chunk.digest)).unwrap(), body);
    assert!(state.progress.lock().unwrap().iter().all(|n| *n <= 15));
    assert_eq!(*state.progress.lock().unwrap().last().unwrap(), 15);
    worker.join().unwrap();
}

#[test]
fn cancels_during_extremely_slow_throttle() {
    let body = vec![b'x'; 65536];
    let mut response = format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    response.extend_from_slice(&body);
    let (url, worker) = server(response);
    let chunk = chunk(url, &body);
    let dir = tempfile::tempdir().unwrap();
    let state = State::default();
    thread::scope(|scope| {
        let transfer = scope.spawn(|| download(&[chunk], dir.path(), 0, 1, &state));
        thread::sleep(Duration::from_millis(150));
        let start = Instant::now();
        state.cancelled.store(true, Ordering::Relaxed);
        assert!(matches!(
            transfer
                .join()
                .unwrap()
                .unwrap_err()
                .downcast_ref::<Failure>(),
            Some(Failure::Cancelled)
        ));
        assert!(start.elapsed() < Duration::from_secs(1));
    });
    worker.join().unwrap();
}

#[test]
fn pause_prevents_requests_and_cancel_interrupts_pause() {
    let dir = tempfile::tempdir().unwrap();
    let state = State::default();
    state.paused.store(true, Ordering::Relaxed);
    thread::scope(|scope| {
        let transfer = scope.spawn(|| {
            download(
                &[chunk("http://127.0.0.1:1/unused".into(), b"abc")],
                dir.path(),
                0,
                0,
                &state,
            )
        });
        thread::sleep(Duration::from_millis(100));
        assert!(state.progress.lock().unwrap().is_empty());
        state.cancelled.store(true, Ordering::Relaxed);
        assert!(matches!(
            transfer
                .join()
                .unwrap()
                .unwrap_err()
                .downcast_ref::<Failure>(),
            Some(Failure::Cancelled)
        ));
    });
}

#[test]
fn pause_resumes_successfully() {
    let (url, worker) =
        server(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\nabc".to_vec());
    let dir = tempfile::tempdir().unwrap();
    let state = State::default();
    state.paused.store(true, Ordering::Relaxed);
    thread::scope(|scope| {
        let transfer = scope.spawn(|| download(&[chunk(url, b"abc")], dir.path(), 0, 0, &state));
        thread::sleep(Duration::from_millis(100));
        assert!(state.progress.lock().unwrap().is_empty());
        state.paused.store(false, Ordering::Relaxed);
        transfer.join().unwrap().unwrap();
    });
    worker.join().unwrap();
}

#[test]
fn cancels_while_server_never_sends_headers() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/blob", listener.local_addr().unwrap());
    let (accepted, wait_for_accept) = std::sync::mpsc::channel();
    let (release, wait_for_release) = std::sync::mpsc::channel();
    let dir = tempfile::tempdir().unwrap();
    let state = State::default();
    thread::scope(|scope| {
        let server = scope.spawn(move || {
            let (_socket, _) = listener.accept().unwrap();
            accepted.send(()).unwrap();
            let _ = wait_for_release.recv_timeout(Duration::from_secs(2));
        });
        let transfer = scope.spawn(|| download(&[chunk(url, b"abc")], dir.path(), 0, 0, &state));
        wait_for_accept
            .recv_timeout(Duration::from_secs(2))
            .unwrap();
        let start = Instant::now();
        state.cancelled.store(true, Ordering::Relaxed);
        assert!(matches!(
            transfer
                .join()
                .unwrap()
                .unwrap_err()
                .downcast_ref::<Failure>(),
            Some(Failure::Cancelled)
        ));
        assert!(start.elapsed() < Duration::from_secs(1));
        let _ = release.send(());
        server.join().unwrap();
    });
}

#[test]
fn parallel_chunks_share_one_speed_budget() {
    let dir = tempfile::tempdir().unwrap();
    let mut workers = Vec::new();
    let mut chunks = Vec::new();
    for byte in b'a'..=b'c' {
        let body = vec![byte; 8192];
        let mut response =
            b"HTTP/1.1 200 OK\r\nContent-Length: 8192\r\nConnection: close\r\n\r\n".to_vec();
        response.extend_from_slice(&body);
        let (url, worker) = server(response);
        workers.push(worker);
        chunks.push(chunk(url, &body));
    }
    let state = State::default();
    let start = Instant::now();
    download(&chunks, dir.path(), 0, 24576, &state).unwrap();
    assert!(start.elapsed() >= Duration::from_millis(950));
    assert_eq!(*state.progress.lock().unwrap().last().unwrap(), 24576);
    for worker in workers {
        worker.join().unwrap();
    }
}
