# Development

日本語の公開手順:

- [ゲーム作品をランチャーへデプロイする手順](GAME_DEPLOYMENT_JA.md)
- [PandD Game Launcherを更新する手順](LAUNCHER_UPDATE_JA.md)
- [Live2D背景の開発・登録](LIVE2D_BACKGROUNDS_JA.md)

Install Qt 6.10, CMake, Ninja, Python 3.13 or newer, and vcpkg. Configure Qt through
`CMAKE_PREFIX_PATH` or `Qt6_DIR`; no developer path is stored in the project.
Windows builds use MSVC v143 x64 and matching MSVC Qt binaries. Provide the reviewed
Cubism Native SDK 5-r.5 through `PANDD_CUBISM_SDK_ROOT` (environment or CMake cache).

The pinned vcpkg baseline resolves OpenSSL 3.6.3. Production configuration rejects
OpenSSL versions older than 3.0; an older system copy may only be used for local
staging-mode development.

```text
cmake --preset dev -DCMAKE_TOOLCHAIN_FILE=<vcpkg>/scripts/buildsystems/vcpkg.cmake
cmake --build --preset dev
ctest --preset dev
python -m pip install --requirement services/deployment_publisher/requirements.txt
python -m unittest discover -s services/deployment_publisher -p "test_*.py" -v
python -m unittest discover -s packages/contracts -p "test_*.py" -v
python -m unittest discover -s apps/launcher/installer -p "test_*.py" -v
python -m unittest discover -s scripts/tests -p "test_*.py" -v
python -m compileall -q services/deployment_publisher packages/contracts apps/launcher/installer scripts
```

## CLion on this Windows machine

`CMakeUserPresets.json` contains the machine-local `clion-windows` configure, build,
and test presets. It selects the Visual Studio Community instance that has MSVC v143
14.44 installed; the default Visual Studio 2026 toolchain otherwise selects v145 and
is rejected by the reviewed Live2D binary contract.

In CLion, reload the CMake project and enable `CLion Windows Debug (MSVC v143)`.
Use the generated `GameLauncher` target to run the launcher and the `clion-windows`
test preset to run CTest. `CMakeUserPresets.json` is intentionally local and ignored
because the Visual Studio, Qt, Cubism SDK, and vcpkg locations are machine-specific.

Staging builds show a permanent `STAGING` badge and trust only the staging host and
staging public key. The `release` preset targets `https://downloads.koto-thing.com/`,
but production configure still fails unless `PANDD_MANIFEST_PUBLIC_KEY_BASE64` is
explicitly supplied.

For a local static distribution server, configure a staging build with a trailing-slash
localhost URL and the public key matching the local Publisher signing key:

```text
cmake --preset dev \
  -DPANDD_DISTRIBUTION_BASE_URL=http://127.0.0.1:8000/ \
  -DPANDD_MANIFEST_PUBLIC_KEY_BASE64=<local-public-key-base64>
```

To build Qt IFW artifacts, first install the CMake deployment tree and then run:

```text
cmake --install build/release --prefix <absolute-staging-path>
python apps/launcher/installer/build.py --ifw-root <QtIFW> --install-tree <staging> \
  --output <artifacts> --version <major.minor.patch> \
  --repository-url https://downloads.koto-thing.com/v1/launcher/ifw/windows/x86_64
```

Use an absolute install prefix because Qt's deployment script writes `qt.conf` through
the resolved installation root.

## Windows R2 staging release

The manually dispatched `Publish Windows staging` workflow builds an unsigned Windows
launcher and online installer for `pandd-launcher-staging`, verifies SHA-256 sidecars,
and publishes launcher metadata and IFW content to the configured `r2.dev` URL. Its
GitHub `staging` environment requires `MANIFEST_PUBLIC_KEY_BASE64`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_ENDPOINT`. Keep credentials out of
the repository and workflow inputs.

Game releases are prepared separately with `publisher.py publish-game`. Upload the
resulting local public tree with the same bucket-scoped R2 credentials before testing
the remote catalog; reruns preserve matching immutable objects.

`--ifw-root` may be omitted when `binarycreator` and `repogen` are already on `PATH`.
The build script writes release-specific metadata into a temporary work tree, so the
checked-in production configuration is never modified by a staging build.

To exercise the complete installer without a public server, use a disposable local
`file://` repository. The command installs into a temporary root, smoke-starts the
deployed launcher, purges it through Maintenance Tool, and confirms game/save data
outside the launcher installation survives:

```text
python -m apps.launcher.installer.e2e --ifw-root <QtIFW> --install-tree <staging> \
  --output <e2e-artifacts> --version <major.minor.patch>
```
