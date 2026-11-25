cmake_minimum_required(VERSION 3.22)

file(READ "${CMAKE_CURRENT_SOURCE_DIR}/package.json" LEANSLIDES_PACKAGE_JSON)
string(JSON LEANSLIDES_MANIFEST_VERSION GET "${LEANSLIDES_PACKAGE_JSON}" version)

project(
  LeanSlides
  VERSION "${LEANSLIDES_MANIFEST_VERSION}"
  DESCRIPTION "A small, read-only offline viewer for PowerPoint presentations"
  HOMEPAGE_URL "https://abooodbah.github.io/leanslides/"
  LANGUAGES C CXX)

include(CTest)

# The portable core, leanslides-inspect, and the core tests build on every
# platform. The Windows host is added only on Windows.
add_subdirectory(src/core)
add_subdirectory(tools/inspect)
if(BUILD_TESTING)
  add_subdirectory(tests/core)
endif()

if(WIN32)
  include(cmake/Hosts.cmake)
endif()
