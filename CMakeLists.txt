cmake_minimum_required(VERSION 3.20)

set(CMAKE_AUTOMOC_COMPILER_PREDEFS OFF)
project(GameLauncher)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)
set(CMAKE_INCLUDE_CURRENT_DIR ON)

# Note: Adjust CMAKE_PREFIX_PATH to your Qt installation if needed
# set(CMAKE_PREFIX_PATH "D:/ProgramFiles/Qt/6.10.2/mingw_64")

find_package(Qt6 COMPONENTS
        Core
        Gui
        Widgets
        Network
        Test
        Xml
        REQUIRED)

enable_testing()

set(SOURCES
        src/main.cpp
        src/domain/repositories/ISettingsRepository.h
        src/domain/repositories/IGameRunner.h
        src/domain/repositories/IDownloadRepository.h
        src/domain/entities/DownloadTask.h
        src/infrastructure/storage/QtSettingsRepository.h
        src/infrastructure/storage/QtSettingsRepository.cpp
        src/infrastructure/system/QtGameRunner.h
        src/infrastructure/system/QtGameRunner.cpp
        src/infrastructure/network/QtDownloadRepository.h
        src/infrastructure/network/QtDownloadRepository.cpp
        src/presentation/di/AppContainer.h
        src/presentation/di/AppContainer.cpp
        src/presentation/views/LauncherWindow.h
        src/presentation/views/LauncherWindow.cpp
        src/presentation/views/GameDetailsWidget.h
        src/presentation/views/GameDetailsWidget.cpp
        src/presentation/views/GameStoreWidget.h
        src/presentation/views/GameStoreWidget.cpp
        src/presentation/views/GameListFactory.h
        src/presentation/views/GameListFactory.cpp
        src/presentation/views/GameListItemWidget.h
        src/presentation/views/GameListItemWidget.cpp
        src/presentation/views/OptionOverlay.h
        src/presentation/views/OptionOverlay.cpp
        src/presentation/views/SettingsPageFactory.h
        src/presentation/views/SettingsPageFactory.cpp
        src/application/dto/DownloadProgressDto.h
        src/application/usecases/DownloadGameUseCase.h
        src/application/usecases/DownloadGameUseCase.cpp
        src/resources/resources.qrc
        src/domain/entities/GameManifest.h
        src/domain/entities/GameFile.h
        src/domain/repositories/IManifestRepository.h
        src/application/dto/GameManifestDto.h
        src/application/usecases/FetchManifestUseCase.h
        src/application/usecases/FetchManifestUseCase.cpp
        src/infrastructure/network/QtManifestRepository.h
        src/infrastructure/network/QtManifestRepository.cpp
        src/domain/entities/LauncherSettings.h
        src/application/dto/LauncherSettingsDto.h
        src/application/usecases/LoadSettingsUseCase.h
        src/application/usecases/LoadSettingsUseCase.cpp
        src/application/usecases/SaveSettingsUseCase.cpp
        src/application/usecases/SaveSettingsUseCase.h
        src/infrastructure/storage/JsonSettingsRepository.cpp
        src/infrastructure/storage/JsonSettingsRepository.h
        src/domain/repositories/IStartupRepository.h
        src/application/usecases/EnableStartupUseCase.cpp
        src/application/usecases/EnableStartupUseCase.h
        src/application/usecases/DisableStartupUseCase.cpp
        src/application/usecases/DisableStartupUseCase.h
        src/infrastructure/system/WindowsStartupRepository.cpp
        src/infrastructure/system/WindowsStartupRepository.h
        src/infrastructure/system/MacStartupRepository.cpp
        src/infrastructure/system/MacStartupRepository.h
        src/infrastructure/system/LinuxStartupRepository.cpp
        src/infrastructure/system/LinuxStartupRepository.h
        src/domain/repositories/ILanguageRepository.h
        src/application/usecases/ChangeLanguageUseCase.cpp
        src/application/usecases/ChangeLanguageUseCase.h
        src/infrastructure/locale/QtLanguageRepository.cpp
        src/infrastructure/locale/QtLanguageRepository.h
        src/domain/entities/CloseAction.h
        src/domain/repositories/IApplicationRepository.h
        src/application/usecases/CloseApplicationUseCase.cpp
        src/application/usecases/CloseApplicationUseCase.h
        src/infrastructure/system/QtApplicationRepository.cpp
        src/infrastructure/system/QtApplicationRepository.h
        src/domain/entities/LauncherUpdateInfo.h
        src/domain/repositories/ILauncherUpdateRepository.h
        src/application/usecases/CheckLauncherUpdateUseCase.cpp
        src/application/usecases/CheckLauncherUpdateUseCase.h
        src/application/dto/UpdateCheckResultDto.h
        src/application/dto/UpdateProgressDto.h
        src/application/usecases/ApplyLauncherUpdateUseCase.cpp
        src/application/usecases/ApplyLauncherUpdateUseCase.h
        src/infrastructure/network/QtLauncherUpdateRepository.cpp
        src/infrastructure/network/QtLauncherUpdateRepository.h
)

add_executable(GameLauncher ${SOURCES})
target_include_directories(GameLauncher PRIVATE src)

target_link_libraries(GameLauncher
        Qt::Core
        Qt::Gui
        Qt::Widgets
        Qt::Network
        Qt::Xml
)

# --- Tests ---
add_executable(mock_maintenancetool src/tests/mock_maintenancetool.cpp)

add_executable(QtLauncherUpdateRepositoryTest 
    src/tests/QtLauncherUpdateRepositoryTest.cpp
    src/infrastructure/network/QtLauncherUpdateRepository.cpp
)
target_include_directories(QtLauncherUpdateRepositoryTest PRIVATE src)
target_link_libraries(QtLauncherUpdateRepositoryTest 
    Qt::Core 
    Qt::Network 
    Qt::Test
    Qt::Xml
)
add_test(NAME QtLauncherUpdateRepositoryTest COMMAND QtLauncherUpdateRepositoryTest)

add_executable(JsonSettingsRepositoryTest 
    src/tests/JsonSettingsRepositoryTest.cpp
    src/infrastructure/storage/JsonSettingsRepository.cpp
)
target_include_directories(JsonSettingsRepositoryTest PRIVATE src)
target_link_libraries(JsonSettingsRepositoryTest 
    Qt::Core 
    Qt::Test
)
add_test(NAME JsonSettingsRepositoryTest COMMAND JsonSettingsRepositoryTest)

add_executable(CheckLauncherUpdateUseCaseTest 
    src/tests/CheckLauncherUpdateUseCaseTest.cpp
    src/application/usecases/CheckLauncherUpdateUseCase.cpp
    src/infrastructure/network/QtLauncherUpdateRepository.cpp
    src/infrastructure/storage/JsonSettingsRepository.cpp
)
target_include_directories(CheckLauncherUpdateUseCaseTest PRIVATE src)
target_link_libraries(CheckLauncherUpdateUseCaseTest 
    Qt::Core 
    Qt::Network
    Qt::Test
    Qt::Xml
)
add_test(NAME CheckLauncherUpdateUseCaseTest COMMAND CheckLauncherUpdateUseCaseTest)

add_executable(QtDownloadRepositoryTest 
    src/tests/QtDownloadRepositoryTest.cpp
    src/infrastructure/network/QtDownloadRepository.cpp
)
target_include_directories(QtDownloadRepositoryTest PRIVATE src)
target_link_libraries(QtDownloadRepositoryTest 
    Qt::Core 
    Qt::Network 
    Qt::Test
)
add_test(NAME QtDownloadRepositoryTest COMMAND QtDownloadRepositoryTest)

add_executable(QtManifestRepositoryTest 
    src/tests/QtManifestRepositoryTest.cpp
    src/infrastructure/network/QtManifestRepository.cpp
)
target_include_directories(QtManifestRepositoryTest PRIVATE src)
target_link_libraries(QtManifestRepositoryTest 
    Qt::Core 
    Qt::Network 
    Qt::Test
)
add_test(NAME QtManifestRepositoryTest COMMAND QtManifestRepositoryTest)
# --- End Tests ---

# Deployment logic for Windows
if (WIN32)
    get_target_property(_qmake_executable Qt6::qmake IMPORTED_LOCATION)
    get_filename_component(_qt_bin_dir "${_qmake_executable}" DIRECTORY)
    find_program(WINDEPLOYQT_EXECUTABLE windeployqt HINTS "${_qt_bin_dir}")

    if (WINDEPLOYQT_EXECUTABLE)
        add_custom_command(TARGET GameLauncher POST_BUILD
                COMMAND "${WINDEPLOYQT_EXECUTABLE}"
                --verbose 1
                --no-compiler-runtime
                --dir "$<TARGET_FILE_DIR:GameLauncher>"
                "$<TARGET_FILE:GameLauncher>"
                COMMENT "Running windeployqt..."
        )
    endif ()
endif ()
