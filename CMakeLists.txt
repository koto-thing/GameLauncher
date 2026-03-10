cmake_minimum_required(VERSION 3.20)
project(GameLauncher)

set(CMAKE_CXX_STANDARD 26)
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
        REQUIRED)

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
)

add_executable(GameLauncher ${SOURCES})

target_link_libraries(GameLauncher
        Qt::Core
        Qt::Gui
        Qt::Widgets
        Qt::Network
)

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
