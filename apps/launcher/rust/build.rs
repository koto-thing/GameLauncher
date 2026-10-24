/// Generate and compile the CXX boundary with the same compiler and CRT as the launcher
fn main() {
    let mut build = cxx_build::bridge("src/lib.rs");
    build.std("c++20").include("include");
    build.compile("pandd-launcher-bridge");
    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=include/FileIoControl.h");
    println!("cargo:rerun-if-changed=include/DownloadControl.h");
}
