set(_pandd_cubism_sdk_root_default "")
if(DEFINED ENV{PANDD_CUBISM_SDK_ROOT} AND NOT "$ENV{PANDD_CUBISM_SDK_ROOT}" STREQUAL "")
    file(TO_CMAKE_PATH "$ENV{PANDD_CUBISM_SDK_ROOT}" _pandd_cubism_sdk_root_default)
endif()

set(PANDD_CUBISM_SDK_ROOT "${_pandd_cubism_sdk_root_default}" CACHE PATH
    "Path to a Live2D Cubism SDK for Native 5-r.5 download root")

function(pandd_target_platform_define out_var)
    if(WIN32)
        set("${out_var}" "CSM_TARGET_WIN_GL" PARENT_SCOPE)
    elseif(APPLE)
        set("${out_var}" "CSM_TARGET_MAC_GL" PARENT_SCOPE)
    elseif(UNIX)
        set("${out_var}" "CSM_TARGET_LINUX_GL" PARENT_SCOPE)
    else()
        message(FATAL_ERROR "Cubism is only configured for Windows, macOS, and Linux")
    endif()
endfunction()

function(pandd_validate_cubism_sdk)
    if(NOT IS_DIRECTORY "${PANDD_CUBISM_SDK_ROOT}")
        message(FATAL_ERROR
            "PANDD_CUBISM_SDK_ROOT must point to a Cubism SDK root directory "
            "(manual checkout or official download).")
    endif()

    set(_cubism_info_file "${PANDD_CUBISM_SDK_ROOT}/cubism-info.yml")
    if(NOT EXISTS "${_cubism_info_file}")
        message(FATAL_ERROR "Cubism SDK is missing cubism-info.yml at ${_cubism_info_file}")
    endif()

    file(READ "${_cubism_info_file}" _cubism_info)
    string(REGEX MATCH "version:[ \t]*([^ \r\n]+)" _unused "${_cubism_info}")
    set(PANDD_CUBISM_VERSION "${CMAKE_MATCH_1}" CACHE INTERNAL "Resolved Cubism SDK version")
    if(NOT PANDD_CUBISM_VERSION STREQUAL "5-r.5")
        message(FATAL_ERROR
            "Unsupported Cubism SDK version '${PANDD_CUBISM_VERSION}'. Expected 5-r.5.")
    endif()
endfunction()

function(pandd_validate_cubism_toolchain)
    if(WIN32)
        if(NOT MSVC)
            message(FATAL_ERROR "Windows Live2D builds require MSVC 2022 v143 x64. MinGW is not supported.")
        endif()
        if(NOT MSVC_TOOLSET_VERSION EQUAL 143)
            message(FATAL_ERROR
                "Windows Live2D builds require MSVC toolset v143. "
                "Current toolset version is '${MSVC_TOOLSET_VERSION}'.")
        endif()
        if(MSVC_VERSION LESS 1940 OR MSVC_VERSION GREATER_EQUAL 1950)
            message(FATAL_ERROR
                "Windows Live2D builds require an MSVC 19.4x compiler selected from the v143 toolset "
                "(for example vcvarsall -vcvars_ver=14.44). Current MSVC_VERSION is '${MSVC_VERSION}'.")
        endif()
        if(NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
            message(FATAL_ERROR "Windows Live2D builds require x64.")
        endif()
    elseif(APPLE)
        if(NOT CMAKE_SYSTEM_PROCESSOR MATCHES "^(arm64|x86_64)$")
            message(FATAL_ERROR
                "macOS Live2D builds are only configured for arm64 and x86_64. "
                "Current processor is '${CMAKE_SYSTEM_PROCESSOR}'.")
        endif()
    elseif(UNIX)
        if(NOT CMAKE_SYSTEM_PROCESSOR STREQUAL "x86_64")
            message(FATAL_ERROR
                "Linux Live2D builds are only configured for x86_64. "
                "Current processor is '${CMAKE_SYSTEM_PROCESSOR}'.")
        endif()
    endif()
endfunction()

function(pandd_add_cubism_targets)
    pandd_validate_cubism_sdk()
    pandd_validate_cubism_toolchain()
    pandd_target_platform_define(_pandd_cubism_platform_define)

    set(_framework_root "${PANDD_CUBISM_SDK_ROOT}/Framework/src")
    set(_shader_root "${_framework_root}/Rendering/OpenGL/Shaders/Standard")
    set(_live2d_resource_root "${CMAKE_SOURCE_DIR}/apps/launcher/resources/live2d")

    if(NOT IS_DIRECTORY "${_framework_root}")
        message(FATAL_ERROR "Cubism SDK is missing Framework/src at ${_framework_root}")
    endif()
    if(NOT IS_DIRECTORY "${_shader_root}")
        message(FATAL_ERROR "Cubism SDK is missing OpenGL Standard shaders at ${_shader_root}")
    endif()
    if(NOT EXISTS "${_live2d_resource_root}/models.json")
        message(FATAL_ERROR
            "apps/launcher/resources/live2d/models.json must exist. "
            "Do not rely on a generated fallback for production assets.")
    endif()

    add_library(pandd_cubism_core STATIC IMPORTED GLOBAL)
    if(WIN32)
        set_target_properties(pandd_cubism_core PROPERTIES
            IMPORTED_CONFIGURATIONS "DEBUG;RELEASE;RELWITHDEBINFO;MINSIZEREL"
            IMPORTED_LOCATION_DEBUG
                "${PANDD_CUBISM_SDK_ROOT}/Core/lib/windows/x86_64/143/Live2DCubismCore_MDd.lib"
            IMPORTED_LOCATION_RELEASE
                "${PANDD_CUBISM_SDK_ROOT}/Core/lib/windows/x86_64/143/Live2DCubismCore_MD.lib"
            IMPORTED_LOCATION_RELWITHDEBINFO
                "${PANDD_CUBISM_SDK_ROOT}/Core/lib/windows/x86_64/143/Live2DCubismCore_MD.lib"
            IMPORTED_LOCATION_MINSIZEREL
                "${PANDD_CUBISM_SDK_ROOT}/Core/lib/windows/x86_64/143/Live2DCubismCore_MD.lib"
            MAP_IMPORTED_CONFIG_RELWITHDEBINFO RELEASE
            MAP_IMPORTED_CONFIG_MINSIZEREL RELEASE
        )
    elseif(APPLE)
        if(CMAKE_SYSTEM_PROCESSOR STREQUAL "arm64")
            set(_pandd_cubism_core_location
                "${PANDD_CUBISM_SDK_ROOT}/Core/lib/macos/arm64/libLive2DCubismCore.a")
        else()
            set(_pandd_cubism_core_location
                "${PANDD_CUBISM_SDK_ROOT}/Core/lib/macos/x86_64/libLive2DCubismCore.a")
        endif()
        set_target_properties(pandd_cubism_core PROPERTIES
            IMPORTED_LOCATION "${_pandd_cubism_core_location}"
        )
    else()
        set_target_properties(pandd_cubism_core PROPERTIES
            IMPORTED_LOCATION "${PANDD_CUBISM_SDK_ROOT}/Core/lib/linux/x86_64/libLive2DCubismCore.a"
        )
    endif()
    target_include_directories(pandd_cubism_core SYSTEM INTERFACE "${PANDD_CUBISM_SDK_ROOT}/Core/include")
    if(WIN32)
        set(_core_properties IMPORTED_LOCATION_DEBUG IMPORTED_LOCATION_RELEASE)
    else()
        set(_core_properties IMPORTED_LOCATION)
    endif()
    foreach(_property IN LISTS _core_properties)
        get_target_property(_core_file pandd_cubism_core "${_property}")
        if(NOT EXISTS "${_core_file}")
            message(FATAL_ERROR "Cubism Core library is missing: ${_core_file}")
        endif()
    endforeach()

    file(GLOB_RECURSE _framework_common_sources CONFIGURE_DEPENDS "${_framework_root}/*.cpp")
    list(FILTER _framework_common_sources EXCLUDE REGEX "/Rendering/")
    file(GLOB _framework_rendering_sources CONFIGURE_DEPENDS "${_framework_root}/Rendering/*.cpp")
    file(GLOB _framework_opengl_sources CONFIGURE_DEPENDS "${_framework_root}/Rendering/OpenGL/*.cpp")

    add_library(pandd_cubism_framework STATIC
        ${_framework_common_sources}
        ${_framework_rendering_sources}
        ${_framework_opengl_sources}
    )
    target_include_directories(pandd_cubism_framework
        SYSTEM PUBLIC
            "${_framework_root}"
            "${PANDD_CUBISM_SDK_ROOT}/Core/include"
    )
    target_link_libraries(pandd_cubism_framework
        PUBLIC
            pandd_cubism_core
            GLEW::GLEW
            OpenGL::GL
    )
    target_compile_definitions(pandd_cubism_framework PUBLIC "${_pandd_cubism_platform_define}")
    set_target_properties(pandd_cubism_framework PROPERTIES
        AUTOMOC OFF
        AUTORCC OFF
        AUTOUIC OFF
    )
    set_property(TARGET pandd_cubism_framework PROPERTY CXX_CLANG_TIDY "")

endfunction()

function(pandd_add_live2d_resources target)
    set(_shader_root "${PANDD_CUBISM_SDK_ROOT}/Framework/src/Rendering/OpenGL/Shaders/Standard")
    set(_asset_root "${CMAKE_SOURCE_DIR}/apps/launcher/resources/live2d")
    file(GLOB_RECURSE _shader_files CONFIGURE_DEPENDS "${_shader_root}/*")
    file(GLOB_RECURSE _asset_files CONFIGURE_DEPENDS "${_asset_root}/*")
    qt_add_resources(${target} pandd_live2d_shaders
        PREFIX "/live2d/FrameworkShaders" BASE "${_shader_root}" FILES ${_shader_files})
    qt_add_resources(${target} pandd_live2d_assets
        PREFIX "/live2d" BASE "${_asset_root}" FILES ${_asset_files})
endfunction()
