# Build the offline viewer from the locked dependency graph
function(pandd_add_vrm_resources target)
    find_program(PANDD_NODE_EXECUTABLE NAMES node REQUIRED)
    find_program(PANDD_NPM_EXECUTABLE NAMES npm.cmd npm REQUIRED)
    set(_viewer "${CMAKE_SOURCE_DIR}/apps/launcher/vrm-viewer")
    set(_output "${CMAKE_CURRENT_BINARY_DIR}/vrm-viewer/viewer.js")
    add_custom_command(OUTPUT "${_output}"
        COMMAND "${PANDD_NPM_EXECUTABLE}" ci --ignore-scripts --no-audit --no-fund
        COMMAND "${PANDD_NODE_EXECUTABLE}" node_modules/esbuild/bin/esbuild src/viewer.js
            --bundle --minify --format=iife --target=chrome130 "--outfile=${_output}"
        WORKING_DIRECTORY "${_viewer}"
        DEPENDS "${_viewer}/package.json" "${_viewer}/package-lock.json"
                "${_viewer}/src/viewer.js" "${_viewer}/src/glb.js"
        VERBATIM
    )
    set_source_files_properties("${_output}" PROPERTIES GENERATED TRUE QT_RESOURCE_ALIAS "viewer.js")
    qt_add_resources(${target} pandd_vrm_viewer PREFIX "/vrm-viewer"
        BASE "${_viewer}" FILES "${_viewer}/index.html" "${_output}")

    # Package every registered VRM with the application, without runtime downloads
    set(_assets "${CMAKE_SOURCE_DIR}/apps/launcher/resources/vrm")
    file(GLOB_RECURSE _files CONFIGURE_DEPENDS "${_assets}/*")
    qt_add_resources(${target} pandd_vrm_assets PREFIX "/vrm" BASE "${_assets}" FILES ${_files})
endfunction()
