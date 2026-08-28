cmake_minimum_required(VERSION 3.24)

if(CMAKE_HOST_WIN32)
    list(APPEND VCPKG_OVERLAY_TRIPLETS "${CMAKE_CURRENT_SOURCE_DIR}/cmake/triplets")
endif()

project(PandDGameLauncher VERSION 1.0.5 LANGUAGES CXX)

option(PANDD_DOCS_ONLY "Configure only the Launcher Doxygen target" OFF)

function(pandd_add_doxygen_target required)
    if(required)
        find_package(Doxygen REQUIRED)
    else()
        find_package(Doxygen QUIET)
    endif()
    if(NOT Doxygen_FOUND)
        return()
    endif()

    set(PANDD_DOXYGEN_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/docs/doxygen" CACHE PATH
        "Directory for generated Launcher API documentation")
    set(DOXYGEN_EXTRACT_ALL YES)
    set(DOXYGEN_EXTRACT_PRIVATE NO)
    set(DOXYGEN_EXTRACT_STATIC NO)
    set(DOXYGEN_GENERATE_HTML YES)
    set(DOXYGEN_GENERATE_LATEX NO)
    set(DOXYGEN_HTML_OUTPUT html)
    set(DOXYGEN_OUTPUT_DIRECTORY "${PANDD_DOXYGEN_OUTPUT_DIRECTORY}")
    set(DOXYGEN_PROJECT_NAME "PandD Game Launcher")
    set(DOXYGEN_PROJECT_NUMBER "${PROJECT_VERSION}")
    set(DOXYGEN_RECURSIVE YES)
    set(DOXYGEN_WARN_IF_UNDOCUMENTED YES)
    set(DOXYGEN_WARN_AS_ERROR FAIL_ON_WARNINGS)
    doxygen_add_docs(docs-check apps/launcher/src COMMENT "Checking API documentation")
endfunction()

if(PANDD_DOCS_ONLY)
    pandd_add_doxygen_target(TRUE)
    return()
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)

if(MSVC)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>DLL")
    add_compile_options(/utf-8)
endif()

option(PANDD_ENABLE_CLANG_TIDY "Run clang-tidy while compiling" OFF)
set(PANDD_DISTRIBUTION_ENV "staging" CACHE STRING "Static content environment")
set(PANDD_DISTRIBUTION_BASE_URL "https://pub-1ada658d7c4f46b1bf109646a4a68bcb.r2.dev/" CACHE STRING
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

if(PANDD_DISTRIBUTION_ENV STREQUAL "production" AND
   PANDD_DISTRIBUTION_BASE_URL STREQUAL "https://pub-1ada658d7c4f46b1bf109646a4a68bcb.r2.dev/")
    message(FATAL_ERROR "Production builds must specify the production distribution URL")
endif()

if(PANDD_DISTRIBUTION_ENV STREQUAL "staging" AND PANDD_MANIFEST_PUBLIC_KEY_BASE64 STREQUAL "")
    set(PANDD_MANIFEST_PUBLIC_KEY_BASE64 "FUXer28uujGgqGMFSerw4rusZ6xa6X3wogspiYSwQs0=")
elseif(PANDD_DISTRIBUTION_ENV STREQUAL "production" AND PANDD_MANIFEST_PUBLIC_KEY_BASE64 STREQUAL "")
    message(FATAL_ERROR "Production builds require PANDD_MANIFEST_PUBLIC_KEY_BASE64")
endif()

list(APPEND CMAKE_MODULE_PATH "${CMAKE_SOURCE_DIR}/cmake")

include(CTest)
include(Cubism)

find_package(Qt6 6.10.2 REQUIRED COMPONENTS
    Core Gui Widgets Network Concurrent Svg OpenGL OpenGLWidgets LinguistTools
)
if(BUILD_TESTING)
    find_package(Qt6 6.10.2 REQUIRED COMPONENTS Test)
endif()
find_package(OpenGL REQUIRED)
find_package(GLEW REQUIRED)
find_package(OpenSSL 1.1.1 REQUIRED COMPONENTS Crypto)
qt_standard_project_setup(REQUIRES 6.10.2)

if(PANDD_DISTRIBUTION_ENV STREQUAL "production" AND OPENSSL_VERSION VERSION_LESS 3.0)
    message(FATAL_ERROR "Production builds require OpenSSL 3.0 or newer")
endif()

if(GLEW_VERSION)
    set(PANDD_GLEW_VERSION "${GLEW_VERSION}")
elseif(GLEW_VERSION_STRING)
    set(PANDD_GLEW_VERSION "${GLEW_VERSION_STRING}")
elseif(glew_VERSION)
    set(PANDD_GLEW_VERSION "${glew_VERSION}")
else()
    # The vcpkg config exports targets but no version. Read the metadata from
    # that same installation, not the SDK sample's unrelated GLEW dependency.
    get_target_property(_glew_include_dirs GLEW::GLEW INTERFACE_INCLUDE_DIRECTORIES)
    foreach(_include_dir IN LISTS _glew_include_dirs)
        get_filename_component(_glew_prefix "${_include_dir}" DIRECTORY)
        if(EXISTS "${_glew_prefix}/lib/pkgconfig/glew.pc")
            file(STRINGS "${_glew_prefix}/lib/pkgconfig/glew.pc" _glew_version_line REGEX "^Version: ")
            string(REGEX REPLACE "^Version: +" "" PANDD_GLEW_VERSION "${_glew_version_line}")
            break()
        endif()
    endforeach()
endif()
if(NOT PANDD_GLEW_VERSION MATCHES "^[0-9]+\\.[0-9]+\\.[0-9]+$")
    message(FATAL_ERROR "GLEW version could not be determined from the resolved package metadata")
endif()

pandd_add_cubism_targets()

set(PANDD_BUILD_METADATA_FILE "${CMAKE_BINARY_DIR}/pandd-build-metadata.json")
file(CONFIGURE OUTPUT "${PANDD_BUILD_METADATA_FILE}" CONTENT [=[
{
  "qtVersion": "@Qt6_VERSION@",
  "qtModules": ["Core", "Gui", "Widgets", "Network", "Concurrent", "Svg", "OpenGL", "OpenGLWidgets"],
  "opensslVersion": "@OPENSSL_VERSION@",
  "cubismVersion": "@PANDD_CUBISM_VERSION@",
  "glewVersion": "@PANDD_GLEW_VERSION@",
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

function(pandd_target_platform_compile_options target_name)
    if(MSVC)
        target_compile_options("${target_name}" PRIVATE /W4 /permissive-)
    else()
        target_compile_options("${target_name}" PRIVATE -Wall -Wextra -Wpedantic)
    endif()
endfunction()

function(pandd_find_windows_openssl_crypto_runtime out_var config_name)
    get_target_property(_library OpenSSL::Crypto "IMPORTED_LOCATION_${config_name}")
    if(NOT _library)
        get_target_property(_library OpenSSL::Crypto IMPORTED_LOCATION)
    endif()
    get_filename_component(_library_dir "${_library}" DIRECTORY)
    find_file(_openssl_crypto_runtime
        NAMES libcrypto-3-x64.dll libcrypto-3.dll libcrypto-1_1-x64.dll libcrypto-1_1.dll
        PATHS "${_library_dir}/../bin"
        NO_DEFAULT_PATH NO_CACHE REQUIRED
    )
    set("${out_var}" "${_openssl_crypto_runtime}" PARENT_SCOPE)
endfunction()

function(pandd_add_windows_runtime_copy target_name openssl_debug_runtime openssl_release_runtime)
    add_custom_command(TARGET "${target_name}" POST_BUILD
        COMMAND "${QT_WINDEPLOYQT_EXECUTABLE}"
            --no-translations
            --no-system-d3d-compiler
            "$<TARGET_FILE:${target_name}>"
        COMMAND "${CMAKE_COMMAND}" -E copy_if_different
            $<TARGET_RUNTIME_DLLS:${target_name}>
            "$<TARGET_FILE_DIR:${target_name}>"
        COMMAND "${CMAKE_COMMAND}" -E copy_if_different
            "$<$<CONFIG:Debug>:${openssl_debug_runtime}>$<$<NOT:$<CONFIG:Debug>>:${openssl_release_runtime}>"
            "$<TARGET_FILE_DIR:${target_name}>"
        COMMAND_EXPAND_LISTS
        VERBATIM
        COMMENT "Deploying Qt, GLEW, and OpenSSL runtime DLLs for ${target_name}"
    )
endfunction()

add_library(launcher_core STATIC
    apps/launcher/src/domain/Models.cpp
    apps/launcher/src/domain/Models.h
    apps/launcher/src/domain/ManifestValidator.cpp
    apps/launcher/src/domain/ManifestValidator.h
    apps/launcher/src/application/Ports.h
    apps/launcher/src/application/Localization.cpp
    apps/launcher/src/application/Localization.h
    apps/launcher/src/application/LauncherService.cpp
    apps/launcher/src/application/LauncherService.h
    apps/launcher/src/infrastructure/JsonCodec.cpp
    apps/launcher/src/infrastructure/JsonCodec.h
    apps/launcher/src/infrastructure/QtRepositories.cpp
    apps/launcher/src/infrastructure/QtRepositories.h
    apps/launcher/src/infrastructure/GameInstallationService.cpp
    apps/launcher/src/infrastructure/GameInstallationService.h
    apps/launcher/src/infrastructure/PlatformServices.cpp
    apps/launcher/src/infrastructure/PlatformServices.h
    apps/launcher/src/infrastructure/FileLogger.cpp
    apps/launcher/src/infrastructure/FileLogger.h
)
target_include_directories(launcher_core PUBLIC apps/launcher/src)
target_link_libraries(launcher_core PUBLIC Qt6::Core Qt6::Network Qt6::Concurrent OpenSSL::Crypto)
target_compile_definitions(launcher_core PUBLIC
    PANDD_LAUNCHER_VERSION="${PROJECT_VERSION}"
    PANDD_DISTRIBUTION_ENV="${PANDD_DISTRIBUTION_ENV}"
    PANDD_DISTRIBUTION_BASE_URL="${PANDD_DISTRIBUTION_BASE_URL}"
    PANDD_BUILD_NUMBER="${PANDD_BUILD_NUMBER}"
    PANDD_MANIFEST_PUBLIC_KEY_BASE64="${PANDD_MANIFEST_PUBLIC_KEY_BASE64}"
)
pandd_target_platform_compile_options(launcher_core)

add_library(launcher_live2d OBJECT
    apps/launcher/src/presentation/live2d/CubismRuntime.cpp
    apps/launcher/src/presentation/live2d/CubismRuntime.h
    apps/launcher/src/presentation/live2d/Live2DModel.cpp
    apps/launcher/src/presentation/live2d/Live2DModel.h
    apps/launcher/src/presentation/live2d/Live2DModelData.cpp
    apps/launcher/src/presentation/live2d/Live2DModelData.h
    apps/launcher/src/presentation/live2d/Live2DAssetCatalog.cpp
    apps/launcher/src/presentation/live2d/Live2DAssetCatalog.h
    apps/launcher/src/presentation/GameDetailPage.cpp
    apps/launcher/src/presentation/GameDetailPage.h
    apps/launcher/src/presentation/Live2DBackgroundWidget.cpp
    apps/launcher/src/presentation/Live2DBackgroundWidget.h
)
target_include_directories(launcher_live2d PUBLIC apps/launcher/src)
target_link_libraries(launcher_live2d
    PUBLIC
        pandd_cubism_framework
        Qt6::Core
        Qt6::Gui
        Qt6::Widgets
        Qt6::OpenGL
        Qt6::OpenGLWidgets
        Qt6::Concurrent
)
pandd_target_platform_compile_options(launcher_live2d)
pandd_add_live2d_resources(launcher_live2d)

qt_add_executable(GameLauncher WIN32 MACOSX_BUNDLE
    apps/launcher/src/main.cpp
    apps/launcher/src/bootstrap/AppContainer.cpp
    apps/launcher/src/bootstrap/AppContainer.h
    apps/launcher/src/presentation/LauncherViewModel.cpp
    apps/launcher/src/presentation/LauncherViewModel.h
    apps/launcher/src/presentation/LocalizationManager.cpp
    apps/launcher/src/presentation/LocalizationManager.h
    apps/launcher/src/presentation/LauncherWindow.cpp
    apps/launcher/src/presentation/LauncherWindow.h
    apps/launcher/resources/resources.qrc
    apps/launcher/resources/windows/GameLauncher.rc
)
target_link_libraries(GameLauncher PRIVATE launcher_core launcher_live2d Qt6::Gui Qt6::Widgets Qt6::Concurrent)
qt_add_translations(GameLauncher
    TS_FILES apps/launcher/translations/launcher_en-US.ts
    RESOURCE_PREFIX "/i18n"
)
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
    pandd_find_windows_openssl_crypto_runtime(OPENSSL_CRYPTO_RUNTIME_DEBUG DEBUG)
    pandd_find_windows_openssl_crypto_runtime(OPENSSL_CRYPTO_RUNTIME_RELEASE RELEASE)

    add_executable(PandDUninstaller WIN32
        apps/launcher/src/uninstaller/UninstallerMain.cpp
        apps/launcher/resources/windows/PandDUninstaller.rc
    )
    set_target_properties(PandDUninstaller PROPERTIES
        AUTOMOC OFF
        AUTORCC OFF
        AUTOUIC OFF
        OUTPUT_NAME "Uninstall PandD Game Launcher"
    )
    target_compile_definitions(PandDUninstaller PRIVATE UNICODE _UNICODE)
    install(TARGETS PandDUninstaller RUNTIME DESTINATION .)

    install(IMPORTED_RUNTIME_ARTIFACTS GLEW::GLEW DESTINATION bin)
    install(FILES "${OPENSSL_CRYPTO_RUNTIME_DEBUG}" DESTINATION bin CONFIGURATIONS Debug)
    install(FILES "${OPENSSL_CRYPTO_RUNTIME_RELEASE}" DESTINATION bin
        CONFIGURATIONS Release RelWithDebInfo MinSizeRel)

    find_program(QT_WINDEPLOYQT_EXECUTABLE
        NAMES windeployqt.exe
        HINTS
            "${CMAKE_PREFIX_PATH}/bin"
            "${Qt6_DIR}/../../../bin"
        NO_DEFAULT_PATH
        REQUIRED
    )
    pandd_add_windows_runtime_copy(GameLauncher
        "${OPENSSL_CRYPTO_RUNTIME_DEBUG}" "${OPENSSL_CRYPTO_RUNTIME_RELEASE}")
endif()

qt_generate_deploy_app_script(
    TARGET GameLauncher
    OUTPUT_SCRIPT deploy_script
    NO_UNSUPPORTED_PLATFORM_ERROR
)
install(SCRIPT "${deploy_script}")

if(BUILD_TESTING)
    qt_add_executable(LauncherDomainTests
        apps/launcher/tests/LauncherDomainTests.cpp
    )
    target_link_libraries(LauncherDomainTests PRIVATE launcher_core Qt6::Test)
    add_test(NAME LauncherDomainTests COMMAND LauncherDomainTests -o -,txt)

    qt_add_executable(LauncherIntegrationTests
        apps/launcher/tests/LauncherIntegrationTests.cpp
    )
    target_link_libraries(LauncherIntegrationTests PRIVATE launcher_core Qt6::Test Qt6::Network)
    add_executable(GameProcessFixture apps/launcher/tests/GameProcessFixture.cpp)
    add_dependencies(LauncherIntegrationTests GameProcessFixture GameLauncher)
    target_compile_definitions(LauncherIntegrationTests PRIVATE
        PANDD_PROCESS_FIXTURE_PATH="$<TARGET_FILE:GameProcessFixture>"
    )
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

    qt_add_executable(Live2DPreview
        apps/launcher/tests/Live2DPreview.cpp
    )
    target_link_libraries(Live2DPreview PRIVATE launcher_live2d Qt6::Widgets Qt6::OpenGL Qt6::OpenGLWidgets Qt6::Test)
    if(WIN32)
        add_dependencies(Live2DPreview GameLauncher)
        pandd_add_windows_runtime_copy(Live2DPreview
            "${OPENSSL_CRYPTO_RUNTIME_DEBUG}" "${OPENSSL_CRYPTO_RUNTIME_RELEASE}")
    endif()

    qt_add_executable(Live2DTests
        apps/launcher/tests/Live2DTests.cpp
    )
    target_link_libraries(Live2DTests PRIVATE launcher_live2d Qt6::Test Qt6::Widgets)
    add_test(NAME Live2DTests COMMAND Live2DTests -o -,txt)
    set_target_properties(LauncherDomainTests LauncherIntegrationTests Live2DTests Live2DPreview
        PROPERTIES WIN32_EXECUTABLE OFF MACOSX_BUNDLE OFF)

    if(WIN32)
        foreach(_runtime_target
                LauncherDomainTests
                LauncherIntegrationTests
                GameProcessFixture
                Live2DPreview
                Live2DTests)
            set_target_properties("${_runtime_target}" PROPERTIES
                RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/runtime/${_runtime_target}"
            )
        endforeach()
    endif()

    set_tests_properties(
        LauncherDomainTests LauncherIntegrationStateTests LauncherIntegrationDownloadTests
        LauncherIntegrationProcessTests Live2DTests PROPERTIES
        WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
        TIMEOUT 30
        ENVIRONMENT "QT_QPA_PLATFORM=offscreen"
    )

    if(WIN32)
        get_target_property(QT_QMAKE_EXECUTABLE Qt6::qmake IMPORTED_LOCATION)
        get_filename_component(QT_BINARY_DIRECTORY "${QT_QMAKE_EXECUTABLE}" DIRECTORY)
        set(TEST_PATH_MODIFICATIONS
            "PATH=path_list_prepend:${QT_BINARY_DIRECTORY}"
            "PATH=path_list_prepend:$<TARGET_FILE_DIR:GameLauncher>"
        )
        set_tests_properties(
            LauncherDomainTests LauncherIntegrationStateTests LauncherIntegrationDownloadTests
            LauncherIntegrationProcessTests Live2DTests PROPERTIES
            ENVIRONMENT_MODIFICATION "${TEST_PATH_MODIFICATIONS}"
        )
    endif()
endif()

pandd_add_doxygen_target(FALSE)
