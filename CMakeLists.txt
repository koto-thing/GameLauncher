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
set(CMAKE_PREFIX_PATH "C:/Qt/6.11.0/mingw_64")
set(CUBISM_SDK_ROOT "D:/ProgramFiles/CubismSdkForNative-5-r.4.1" CACHE PATH "Cubism SDK root")
set(CUBISM_CORE      "${CUBISM_SDK_ROOT}/Core")
set(CUBISM_FRAMEWORK "${CUBISM_SDK_ROOT}/Framework/src")

file(GLOB_RECURSE CUBISM_SDK_SOURCES
    "${CUBISM_FRAMEWORK}/*.cpp"
    "${CUBISM_FRAMEWORK}/*.cc"
)

find_package(Qt6 COMPONENTS
        Core
        Gui
        Widgets
        Network
        Test
        Xml
        OpenGLWidgets
        REQUIRED)

enable_testing()

set(SOURCES
        src/main.cpp
        src/resources.qrc
        src/infrastructure/provider/QtApplicationProvider.cpp
        src/infrastructure/provider/QtApplicationProvider.h
        src/infrastructure/provider/QtApplicationProvider.h
        src/AppConfig.h
        src/view/MainWindow.cpp
        src/view/MainWindow.h
        src/presenter/MainWindowPresenter.cpp
        src/presenter/MainWindowPresenter.h
)

add_executable(GameLauncher ${SOURCES})
target_include_directories(GameLauncher PRIVATE
        "${CUBISM_CORE}/include"
        "${CUBISM_FRAMEWORK}"
        src)

target_link_libraries(GameLauncher
        "${CUBISM_CORE}/dll/windows/x86_64/Live2DCubismCore.dll"
        Qt::Core
        Qt::Gui
        Qt::Widgets
        Qt::Network
        Qt::Xml
        Qt::OpenGLWidgets
)

target_sources(GameLauncher PRIVATE
        ${CUBISM_FRAMEWORK_SOURCES}
)

target_compile_definitions(GameLauncher PRIVATE
        CSM_TARGET_WIN_GL
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
