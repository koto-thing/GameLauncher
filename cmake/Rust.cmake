# Build the Rust/CXX boundary for the same target and CRT as the Qt executable
find_program(PANDD_CARGO_EXECUTABLE cargo
    HINTS "$ENV{USERPROFILE}/.cargo/bin" "$ENV{HOME}/.cargo/bin" REQUIRED)

set(_pandd_rust_arch "${CMAKE_SYSTEM_PROCESSOR}")
if(CMAKE_GENERATOR_PLATFORM)
    set(_pandd_rust_arch "${CMAKE_GENERATOR_PLATFORM}")
elseif(APPLE AND CMAKE_OSX_ARCHITECTURES)
    set(_pandd_rust_arch "${CMAKE_OSX_ARCHITECTURES}")
endif()
string(TOLOWER "${_pandd_rust_arch}" _pandd_rust_arch)
if(_pandd_rust_arch MATCHES "^(amd64|x64|x86_64)$")
    set(_pandd_rust_arch x86_64)
elseif(_pandd_rust_arch MATCHES "^(arm64|aarch64)$")
    set(_pandd_rust_arch aarch64)
else()
    message(FATAL_ERROR "Unsupported Rust launcher architecture: ${_pandd_rust_arch}")
endif()

if(WIN32 AND MSVC)
    set(_pandd_rust_target "${_pandd_rust_arch}-pc-windows-msvc")
    set(_pandd_rust_filename pandd_launcher_rust.lib)
    set(_pandd_rust_cxxflags "$<IF:$<CONFIG:Debug>,/MDd,/MD>")
elseif(APPLE)
    set(_pandd_rust_target "${_pandd_rust_arch}-apple-darwin")
    set(_pandd_rust_filename libpandd_launcher_rust.a)
    set(_pandd_rust_cxxflags "-fPIC")
elseif(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    set(_pandd_rust_target "${_pandd_rust_arch}-unknown-linux-gnu")
    set(_pandd_rust_filename libpandd_launcher_rust.a)
    set(_pandd_rust_cxxflags "-fPIC")
else()
    message(FATAL_ERROR "Rust launcher requires MSVC Windows, macOS, or GNU/Linux")
endif()

# Separate configurations so generated C++ objects never mix Windows CRT modes
set(_pandd_rust_directory "${CMAKE_BINARY_DIR}/rust/$<CONFIG>")
set(_pandd_rust_library "${_pandd_rust_directory}/${_pandd_rust_target}/release/${_pandd_rust_filename}")
file(GLOB_RECURSE _pandd_rust_sources CONFIGURE_DEPENDS
    "${CMAKE_SOURCE_DIR}/apps/launcher/rust/*.rs"
    "${CMAKE_SOURCE_DIR}/apps/launcher/rust/include/*.h"
    "${CMAKE_SOURCE_DIR}/packages/transfer/src/*.rs"
    "${CMAKE_SOURCE_DIR}/packages/file-integrity/src/*.rs"
    "${CMAKE_SOURCE_DIR}/packages/local-storage/src/*.rs"
    "${CMAKE_SOURCE_DIR}/packages/distribution-contracts/src/*.rs"
    "${CMAKE_SOURCE_DIR}/packages/contracts/schemas/*.json")

add_custom_command(
    OUTPUT "${_pandd_rust_library}"
    BYPRODUCTS "${_pandd_rust_directory}/cxxbridge/pandd-launcher-rust/src/lib.rs.h"
        "${_pandd_rust_directory}/cxxbridge/rust/cxx.h"
    COMMAND "${CMAKE_COMMAND}" -E env
        "CXX=${CMAKE_CXX_COMPILER}"
        "CXXFLAGS=${_pandd_rust_cxxflags}"
        "CFLAGS=${_pandd_rust_cxxflags}"
        "${PANDD_CARGO_EXECUTABLE}" build --locked --release
        --manifest-path "${CMAKE_SOURCE_DIR}/apps/launcher/rust/Cargo.toml"
        --target "${_pandd_rust_target}" --target-dir "${_pandd_rust_directory}"
    DEPENDS ${_pandd_rust_sources}
        "${CMAKE_SOURCE_DIR}/Cargo.toml" "${CMAKE_SOURCE_DIR}/Cargo.lock"
        "${CMAKE_SOURCE_DIR}/rust-toolchain.toml"
        "${CMAKE_SOURCE_DIR}/apps/launcher/rust/Cargo.toml"
        "${CMAKE_SOURCE_DIR}/packages/distribution-contracts/Cargo.toml"
        "${CMAKE_SOURCE_DIR}/packages/transfer/Cargo.toml"
        "${CMAKE_SOURCE_DIR}/packages/file-integrity/Cargo.toml"
        "${CMAKE_SOURCE_DIR}/packages/local-storage/Cargo.toml"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "Building shared Rust manifest validation and CXX bridge"
    VERBATIM
)
add_custom_target(pandd_launcher_rust_build DEPENDS "${_pandd_rust_library}")
add_library(pandd_launcher_rust INTERFACE)
add_dependencies(pandd_launcher_rust pandd_launcher_rust_build)
target_include_directories(pandd_launcher_rust SYSTEM INTERFACE "${_pandd_rust_directory}/cxxbridge"
    "${CMAKE_SOURCE_DIR}/apps/launcher/rust/include")
target_link_libraries(pandd_launcher_rust INTERFACE "${_pandd_rust_library}")

if(WIN32)
    target_link_libraries(pandd_launcher_rust INTERFACE userenv ws2_32 bcrypt ntdll advapi32)
elseif(APPLE)
    target_link_libraries(pandd_launcher_rust INTERFACE iconv)
else()
    find_package(Threads REQUIRED)
    target_link_libraries(pandd_launcher_rust INTERFACE Threads::Threads ${CMAKE_DL_LIBS} m)
endif()
