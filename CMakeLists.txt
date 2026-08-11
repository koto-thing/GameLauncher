cmake_minimum_required(VERSION 3.24)

project(PandDGameLauncher VERSION 1.0.1 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)

option(PANDD_ENABLE_CLANG_TIDY "Run clang-tidy while compiling" OFF)
set(PANDD_DISTRIBUTION_ENV "staging" CACHE STRING "Static content environment")
set(PANDD_DISTRIBUTION_BASE_URL "https://downloads.koto-thing.com/" CACHE STRING
    "Static distribution base URL")
set(PANDD_BUILD_NUMBER "local" CACHE STRING "Reproducible CI build identifier")
set_property(CACHE PANDD_DISTRIBUTION_ENV PROPERTY STRINGS staging production)
set(PANDD_MANIFEST_PUBLIC_KEY_BASE64 "" CACHE STRING "Pinned Ed25519 manifest public key")

if(NOT PANDD_DISTRIBUTION_ENV MATCHES "^(staging|production)$")
    message(FATAL_ERROR "PANDD_DISTRIBUTION_ENV must be staging or production")
endif()

if(NOT PANDD_DISTRIBUTION_BASE_URL MATCHES "/$")
    message(FATAL_ERROR "PANDD_DISTRIBUTION_BASE_URL must end with a slash")
endif()

if(PANDD_DISTRIBUTION_ENV STREQUAL "production" AND
   NOT PANDD_DISTRIBUTION_BASE_URL MATCHES "^https://")
    message(FATAL_ERROR "Production distribution URL must use HTTPS")
endif()

if(PANDD_DISTRIBUTION_ENV STREQUAL "staging" AND PANDD_MANIFEST_PUBLIC_KEY_BASE64 STREQUAL "")
    # RFC 8032 test key: safe for fixtures only and intentionally distinct from production.
    set(PANDD_MANIFEST_PUBLIC_KEY_BASE64 "11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=")
elseif(PANDD_DISTRIBUTION_ENV STREQUAL "production" AND PANDD_MANIFEST_PUBLIC_KEY_BASE64 STREQUAL "")
    message(FATAL_ERROR "Production builds require PANDD_MANIFEST_PUBLIC_KEY_BASE64")
endif()

include(CTest)
find_package(Qt6 6.5 REQUIRED COMPONENTS Core Gui Widgets Network Concurrent Svg)
if(BUILD_TESTING)
    find_package(Qt6 6.5 REQUIRED COMPONENTS Test)
endif()
find_package(OpenSSL 1.1.1 REQUIRED COMPONENTS Crypto)
qt_standard_project_setup(REQUIRES 6.5)

# Public artifacts must not silently fall back to the end-of-life OpenSSL 1.1 line.
if(PANDD_DISTRIBUTION_ENV STREQUAL "production" AND OPENSSL_VERSION VERSION_LESS 3.0)
    message(FATAL_ERROR "Production builds require OpenSSL 3.0 or newer")
endif()

# Capture configured dependency identities once so SBOM generation cannot guess them later.
set(PANDD_BUILD_METADATA_FILE "${CMAKE_BINARY_DIR}/pandd-build-metadata.json")
file(CONFIGURE OUTPUT "${PANDD_BUILD_METADATA_FILE}" CONTENT [=[
{
  "qtVersion": "@Qt6_VERSION@",
  "qtModules": ["Core", "Gui", "Widgets", "Network", "Concurrent", "Svg"],
  "opensslVersion": "@OPENSSL_VERSION@",
  "compilerId": "@CMAKE_CXX_COMPILER_ID@",
  "compilerVersion": "@CMAKE_CXX_COMPILER_VERSION@",
  "systemName": "@CMAKE_SYSTEM_NAME@",
  "systemProcessor": "@CMAKE_SYSTEM_PROCESSOR@"
}
]=] @ONLY)

if(PANDD_ENABLE_CLANG_TIDY)
    find_program(CLANG_TIDY_EXECUTABLE NAMES clang-tidy REQUIRED)
    set(CMAKE_CXX_CLANG_TIDY "${CLANG_TIDY_EXECUTABLE}")
endif()

add_library(launcher_core STATIC
    client/src/domain/Models.cpp
    client/src/domain/Models.h
    client/src/domain/ManifestValidator.cpp
    client/src/domain/ManifestValidator.h
    client/src/application/Ports.h
    client/src/application/LauncherService.cpp
    client/src/application/LauncherService.h
    client/src/infrastructure/JsonCodec.cpp
    client/src/infrastructure/JsonCodec.h
    client/src/infrastructure/QtRepositories.cpp
    client/src/infrastructure/QtRepositories.h
    client/src/infrastructure/GameInstallationService.cpp
    client/src/infrastructure/GameInstallationService.h
    client/src/infrastructure/PlatformServices.cpp
    client/src/infrastructure/PlatformServices.h
    client/src/infrastructure/FileLogger.cpp
    client/src/infrastructure/FileLogger.h
)
target_include_directories(launcher_core PUBLIC client/src)
target_link_libraries(launcher_core PUBLIC Qt6::Core Qt6::Network Qt6::Concurrent OpenSSL::Crypto)
target_compile_definitions(launcher_core PUBLIC
    PANDD_LAUNCHER_VERSION="${PROJECT_VERSION}"
    PANDD_DISTRIBUTION_ENV="${PANDD_DISTRIBUTION_ENV}"
    PANDD_DISTRIBUTION_BASE_URL="${PANDD_DISTRIBUTION_BASE_URL}"
    PANDD_BUILD_NUMBER="${PANDD_BUILD_NUMBER}"
    PANDD_MANIFEST_PUBLIC_KEY_BASE64="${PANDD_MANIFEST_PUBLIC_KEY_BASE64}"
)
if(MSVC)
    target_compile_options(launcher_core PRIVATE /W4 /permissive-)
else()
    target_compile_options(launcher_core PRIVATE -Wall -Wextra -Wpedantic)
endif()

qt_add_executable(GameLauncher WIN32 MACOSX_BUNDLE
    client/src/main.cpp
    client/src/bootstrap/AppContainer.cpp
    client/src/bootstrap/AppContainer.h
    client/src/presentation/LauncherViewModel.cpp
    client/src/presentation/LauncherViewModel.h
    client/src/presentation/EnglishTranslator.cpp
    client/src/presentation/EnglishTranslator.h
    client/src/presentation/LauncherWindow.cpp
    client/src/presentation/LauncherWindow.h
    client/resources/resources.qrc
)
target_link_libraries(GameLauncher PRIVATE launcher_core Qt6::Gui Qt6::Widgets Qt6::Concurrent)
set_target_properties(GameLauncher PROPERTIES
    OUTPUT_NAME "PandD Game Launcher"
    MACOSX_BUNDLE_GUI_IDENTIFIER "org.pandd.launcher"
    MACOSX_BUNDLE_BUNDLE_VERSION "${PROJECT_VERSION}"
    MACOSX_BUNDLE_SHORT_VERSION_STRING "${PROJECT_VERSION}"
)

install(TARGETS GameLauncher
    BUNDLE DESTINATION .
    RUNTIME DESTINATION bin
)
install(FILES THIRD_PARTY_NOTICES.md docs/PRIVACY_POLICY.md docs/TERMS_OF_USE.md
              docs/QT_LGPL_COMPLIANCE.md
        DESTINATION docs)
install(FILES "${PANDD_BUILD_METADATA_FILE}" DESTINATION docs)

if(WIN32)
    # windeployqt deploys Qt itself but intentionally does not copy non-Qt crypto runtimes.
    get_filename_component(OPENSSL_LIBRARY_DIRECTORY "${OPENSSL_CRYPTO_LIBRARY}" DIRECTORY)
    get_filename_component(OPENSSL_PREFIX_DIRECTORY "${OPENSSL_LIBRARY_DIRECTORY}" DIRECTORY)
    if(OPENSSL_VERSION VERSION_LESS 3.0)
        set(OPENSSL_RUNTIME_NAMES libcrypto-1_1-x64.dll libcrypto-1_1.dll)
    else()
        set(OPENSSL_RUNTIME_NAMES libcrypto-3-x64.dll libcrypto-3.dll)
    endif()
    find_file(OPENSSL_CRYPTO_RUNTIME
        NAMES ${OPENSSL_RUNTIME_NAMES}
        HINTS "${OPENSSL_ROOT_DIR}/bin" "${OPENSSL_PREFIX_DIRECTORY}/bin"
        NO_DEFAULT_PATH
        NO_CACHE
    )
    if(NOT OPENSSL_CRYPTO_RUNTIME)
        message(FATAL_ERROR "OpenSSL Crypto runtime is required for Windows packaging")
    endif()
    install(FILES "${OPENSSL_CRYPTO_RUNTIME}" DESTINATION bin)

    # Make the Debug/Release target runnable directly from CLion as well as from
    # the install tree. windeployqt supplies Qt and MinGW runtime DLLs; OpenSSL
    # is deployed separately because windeployqt does not own that dependency.
    find_program(QT_WINDEPLOYQT_EXECUTABLE
        NAMES windeployqt.exe
        HINTS
            "${CMAKE_PREFIX_PATH}/bin"
            "${Qt6_DIR}/../../../bin"
        NO_DEFAULT_PATH
        REQUIRED
    )
    add_custom_command(TARGET GameLauncher POST_BUILD
        COMMAND "${QT_WINDEPLOYQT_EXECUTABLE}"
            --no-translations
            --no-system-d3d-compiler
            "$<TARGET_FILE:GameLauncher>"
        COMMAND "${CMAKE_COMMAND}" -E copy_if_different
            "${OPENSSL_CRYPTO_RUNTIME}"
            "$<TARGET_FILE_DIR:GameLauncher>"
        VERBATIM
        COMMENT "Deploying Qt, MinGW, and OpenSSL runtime DLLs"
    )
endif()

# Qt's deployment API keeps packaging portable and avoids developer-specific tool paths.
qt_generate_deploy_app_script(
    TARGET GameLauncher
    OUTPUT_SCRIPT deploy_script
    NO_UNSUPPORTED_PLATFORM_ERROR
)
install(SCRIPT "${deploy_script}")

if(BUILD_TESTING)
    qt_add_executable(LauncherDomainTests
        client/tests/LauncherDomainTests.cpp
    )
    target_link_libraries(LauncherDomainTests PRIVATE launcher_core Qt6::Test)
    add_test(NAME LauncherDomainTests COMMAND LauncherDomainTests -o -,txt)

    qt_add_executable(LauncherIntegrationTests
        client/tests/LauncherIntegrationTests.cpp
    )
    target_link_libraries(LauncherIntegrationTests PRIVATE launcher_core Qt6::Test Qt6::Network)
    add_executable(GameProcessFixture client/tests/GameProcessFixture.cpp)
    add_dependencies(LauncherIntegrationTests GameProcessFixture)
    target_compile_definitions(LauncherIntegrationTests PRIVATE
        PANDD_PROCESS_FIXTURE_PATH="$<TARGET_FILE:GameProcessFixture>"
    )
    # Explicit groups avoid QtTest auto-discovery shutdown stalls on Windows CI.
    add_test(NAME LauncherIntegrationStateTests COMMAND LauncherIntegrationTests
        verifiesEd25519Signature rejectsLookalikeLocalhost persistsState
        validatesSettingsBeforePersistence reportsInstallStateTransitions
        checksAndAppliesLauncherUpdate resolvesMaintenanceToolFromInstalledLayout
        parsesLauncherChangelogContract rejectsNonContractJson -o -,txt)
    add_test(NAME LauncherIntegrationDownloadTests COMMAND LauncherIntegrationTests
        resumesAndActivatesRelease reusesContentAddressedChunkAcrossReleases
        redownloadsOnlyCorruptChunkAfterCacheCleanup importsVerifiedExistingGame
        retriesTransientServerFailure resumesAfterMidstreamDisconnect
        fallsBackWhenRangeIsUnsupported stopsOnClientError rejectsHashMismatch
        rejectsOversizedServerResponse cancelsDownloadWithoutActivation
        rejectsInsufficientDiskSpace rejectsUnwritableLayout rejectsLinkedManagementDirectory
        honorsDownloadSpeedLimit -o -,txt)
    add_test(NAME LauncherIntegrationProcessTests COMMAND LauncherIntegrationTests
        launchesEngineFixturesAndReportsCrash -o -,txt)
    set_tests_properties(
        LauncherDomainTests LauncherIntegrationStateTests LauncherIntegrationDownloadTests
        LauncherIntegrationProcessTests PROPERTIES
        WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    )

    # Ensure Windows can discover the Qt runtime before the test process starts.
    if(WIN32)
        get_target_property(QT_QMAKE_EXECUTABLE Qt6::qmake IMPORTED_LOCATION)
        get_filename_component(QT_BINARY_DIRECTORY "${QT_QMAKE_EXECUTABLE}" DIRECTORY)
        set(TEST_PATH_MODIFICATIONS "PATH=path_list_prepend:${QT_BINARY_DIRECTORY}")
        if(OPENSSL_ROOT_DIR AND EXISTS "${OPENSSL_ROOT_DIR}/bin")
            list(APPEND TEST_PATH_MODIFICATIONS "PATH=path_list_prepend:${OPENSSL_ROOT_DIR}/bin")
        endif()
        set_tests_properties(
            LauncherDomainTests LauncherIntegrationStateTests LauncherIntegrationDownloadTests
            LauncherIntegrationProcessTests PROPERTIES
            ENVIRONMENT_MODIFICATION "${TEST_PATH_MODIFICATIONS}"
        )
    endif()
endif()

find_package(Doxygen QUIET)
if(Doxygen_FOUND)
    set(DOXYGEN_EXTRACT_ALL YES)
    set(DOXYGEN_WARN_IF_UNDOCUMENTED YES)
    set(DOXYGEN_WARN_AS_ERROR FAIL_ON_WARNINGS)
    doxygen_add_docs(docs-check client/src COMMENT "Checking API documentation")
endif()
