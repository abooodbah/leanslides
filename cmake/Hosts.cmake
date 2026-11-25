# LeanSlides' Windows host (Win32 + WebView2) and its tests. The root
# CMakeLists.txt includes this file on Windows after the portable core, so
# leanslides_core already exists.

option(LEANSLIDES_BUILD_HOSTS "Build the Windows host" ON)
if(NOT LEANSLIDES_BUILD_HOSTS)
  return()
endif()

set(LEANSLIDES_ROOT "${CMAKE_CURRENT_LIST_DIR}/..")
cmake_path(NORMAL_PATH LEANSLIDES_ROOT)
string(REGEX REPLACE "/$" "" LEANSLIDES_ROOT "${LEANSLIDES_ROOT}")
set(LEANSLIDES_GENERATED_DIR "${CMAKE_BINARY_DIR}/generated")

configure_file(
  "${LEANSLIDES_ROOT}/cmake/leanslides-version.h.in"
  "${LEANSLIDES_GENERATED_DIR}/leanslides-version.h"
  @ONLY)

set(LEANSLIDES_SMOKE_FIXTURE "${LEANSLIDES_ROOT}/tests/hosts/fixtures/smoke.pptx")
set(LEANSLIDES_FALLBACK_FIXTURE "${LEANSLIDES_ROOT}/tests/hosts/fixtures/fallback.odp")

if(BUILD_TESTING)
  # Editor order, link rules, and message parsing are plain C++.
  add_executable(leanslides_host_logic_tests "${LEANSLIDES_ROOT}/tests/hosts/HostLogicTests.cpp")
  target_compile_features(leanslides_host_logic_tests PRIVATE cxx_std_17)
  target_include_directories(leanslides_host_logic_tests PRIVATE "${LEANSLIDES_ROOT}/src")
  target_link_libraries(leanslides_host_logic_tests PRIVATE leanslides_core)
  target_compile_options(leanslides_host_logic_tests PRIVATE /W4 /permissive- /utf-8)
  add_test(NAME leanslides-host-logic COMMAND leanslides_host_logic_tests)
  option(LEANSLIDES_ENABLE_GUI_TESTS "Run the real WebView2 smoke tests" OFF)
endif()

set(LEANSLIDES_WEBVIEW2_VERSION "1.0.4078.44")
set(LEANSLIDES_WEBVIEW2_SDK
  "${LEANSLIDES_ROOT}/obj/webview2/${LEANSLIDES_WEBVIEW2_VERSION}"
  CACHE PATH "Extracted Microsoft.Web.WebView2 NuGet package")
if(NOT EXISTS "${LEANSLIDES_WEBVIEW2_SDK}/build/native/include/WebView2.h")
  message(FATAL_ERROR
    "The WebView2 SDK ${LEANSLIDES_WEBVIEW2_VERSION} is missing at ${LEANSLIDES_WEBVIEW2_SDK}. "
    "Run scripts/Get-WebView2Sdk.ps1 first.")
endif()
set(LEANSLIDES_WEBVIEW2_NATIVE "${LEANSLIDES_WEBVIEW2_SDK}/build/native/x64")

configure_file(
  "${LEANSLIDES_ROOT}/src/windows/LeanSlides.manifest.in"
  "${LEANSLIDES_GENERATED_DIR}/LeanSlides.manifest"
  @ONLY)

add_executable(LeanSlides WIN32
  "${LEANSLIDES_ROOT}/src/windows/main.cpp"
  "${LEANSLIDES_ROOT}/src/windows/App.cpp"
  "${LEANSLIDES_ROOT}/src/windows/Editor.cpp"
  "${LEANSLIDES_ROOT}/src/windows/Platform.cpp"
  "${LEANSLIDES_ROOT}/src/windows/LeanSlides.rc"
  "${LEANSLIDES_GENERATED_DIR}/LeanSlides.manifest")
target_compile_features(LeanSlides PRIVATE cxx_std_17)
target_include_directories(LeanSlides PRIVATE
  "${LEANSLIDES_ROOT}/src"
  "${LEANSLIDES_ROOT}/src/windows"
  "${LEANSLIDES_GENERATED_DIR}"
  "${LEANSLIDES_WEBVIEW2_SDK}/build/native/include")
target_compile_definitions(LeanSlides PRIVATE
  UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN _WIN32_WINNT=0x0A00)
target_compile_options(LeanSlides PRIVATE $<$<COMPILE_LANGUAGE:CXX>:/W4 /permissive- /utf-8 /sdl>)
target_link_libraries(LeanSlides PRIVATE
  leanslides_core
  "${LEANSLIDES_WEBVIEW2_NATIVE}/WebView2Loader.dll.lib"
  user32 gdi32 shell32 ole32 shlwapi dwmapi advapi32)

# The loader DLL ships beside LeanSlides.exe, and the reader assets (plain
# files, no build step) sit in assets/ so the build tree runs as it is.
file(GLOB LEANSLIDES_ASSET_FILES CONFIGURE_DEPENDS "${LEANSLIDES_ROOT}/assets/*")
add_custom_command(TARGET LeanSlides POST_BUILD
  COMMAND "${CMAKE_COMMAND}" -E copy_if_different
          "${LEANSLIDES_WEBVIEW2_NATIVE}/WebView2Loader.dll"
          "$<TARGET_FILE_DIR:LeanSlides>/WebView2Loader.dll"
  COMMAND "${CMAKE_COMMAND}" -E remove_directory "$<TARGET_FILE_DIR:LeanSlides>/assets"
  COMMAND "${CMAKE_COMMAND}" -E copy_directory
          "${LEANSLIDES_ROOT}/assets" "$<TARGET_FILE_DIR:LeanSlides>/assets"
  VERBATIM)
set_property(TARGET LeanSlides APPEND PROPERTY LINK_DEPENDS ${LEANSLIDES_ASSET_FILES})

if(BUILD_TESTING AND LEANSLIDES_ENABLE_GUI_TESTS)
  add_test(NAME leanslides-windows-host
    COMMAND LeanSlides --smoke-test "${LEANSLIDES_SMOKE_FIXTURE}")
  add_test(NAME leanslides-windows-fallback
    COMMAND LeanSlides --smoke-test "${LEANSLIDES_FALLBACK_FIXTURE}")
  set_tests_properties(leanslides-windows-host leanslides-windows-fallback PROPERTIES
    TIMEOUT 30
    ENVIRONMENT "LEANSLIDES_ASSETS_DIR=${LEANSLIDES_ROOT}/assets")
  # A file that cannot be shown must make the smoke test fail for that
  # reason, not pass and not time out.
  set_tests_properties(leanslides-windows-fallback PROPERTIES
    PASS_REGULAR_EXPRESSION "smoke: FAIL: the smoke fixture is not a presentation LeanSlides shows")
endif()
