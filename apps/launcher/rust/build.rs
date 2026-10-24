/// ランチャーと同じコンパイラと CRT で CXX 境界のコードを生成してビルドする
///
/// # 戻り値
///
/// 戻り値なし
fn main() {
    let mut build = cxx_build::bridge("src/lib.rs");
    build.std("c++20").include("include");
    build.compile("pandd-launcher-bridge");

    // ブリッジの定義とヘッダーの変更時に再ビルドする
    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=include/FileIoControl.h");
    println!("cargo:rerun-if-changed=include/DownloadControl.h");
}
