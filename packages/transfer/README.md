# Shared transfer control

`pandd-transfer` owns launcher chunk downloads and Publisher provider-process
control. The launcher enables the `http` feature; Publisher does not link the HTTP
runtime. The CXX adapter borrows atomic pause/cancel flags and calls progress on
the original installation worker thread, never from an extra Rust thread.

- At most three concurrent HTTP requests, with one shared bytes/second budget
- Three total attempts; transport failures, HTTP 408/429/5xx and digest mismatch
  retry after 200/400 ms. Other HTTP errors and malformed ranges fail immediately
- Thirty-second connect/read timeouts; pause/cancel polling every 25 ms also
  applies to pending requests, throttling and retry waits
- Partial cache files survive disconnects/cancellation. Their prefix is hashed
  once per attempt; incoming bytes are hashed as they are written, eliminating
  a separate post-download verification read
- HTTP 206 must exactly match the requested prefix and manifest length. HTTP 200
  replaces the prefix. Redirects and encoded bodies are rejected, and an oversized
  or corrupt complete response is truncated before another attempt
- Progress tracks each chunk position once; retransmitted bytes affect network
  speed, not completed bytes. A restart after corruption can decrease progress
- Cache paths use `pandd-local-storage` to reject links and traversal. The caller
  supplies authenticated manifest URLs, deduplicates hashes, checks existing
  complete chunks and serializes access to the cache root

The speed limit controls application body consumption across the entire batch;
TCP/TLS/HTTP buffers can receive a bounded amount ahead of it. Pause likewise stops
application reads/writes rather than suspending the OS socket. A long pause can
expire an in-flight read timeout, which resumes through the normal retry path.

Publisher keeps AWS CLI's credential chain, S3 multipart implementation and
standard retry classification. Both consumers use the same three-attempt limit
and cancellation polling interval. The shared process runner captures stdout and
stderr in temporary files and kills/reaps the provider process on cancellation.
Publisher does not add a second retry loop around AWS CLI or a launcher-style
download speed setting. Cancelling an upload does not undo a remote write that
the provider has already accepted; the existing verified publication order and
subsequent reconciliation still apply.

Run `cargo test -p pandd-transfer --features http --locked` and the launcher's
`LauncherIntegrationDownloadTests` for the HTTP and CXX boundaries. Publisher's
Python integration suite additionally runs the actual AWS CLI against local S3.
