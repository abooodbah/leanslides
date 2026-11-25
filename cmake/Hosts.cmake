# LeanSlides' Windows host logic tests. The root
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

if(BUILD_TESTING)
  # Editor order, link rules, and message parsing are plain C++.
  add_executable(leanslides_host_logic_tests "${LEANSLIDES_ROOT}/tests/hosts/HostLogicTests.cpp")
  target_compile_features(leanslides_host_logic_tests PRIVATE cxx_std_17)
  target_include_directories(leanslides_host_logic_tests PRIVATE "${LEANSLIDES_ROOT}/src")
  target_link_libraries(leanslides_host_logic_tests PRIVATE leanslides_core)
  target_compile_options(leanslides_host_logic_tests PRIVATE /W4 /permissive- /utf-8)
  add_test(NAME leanslides-host-logic COMMAND leanslides_host_logic_tests)
endif()

