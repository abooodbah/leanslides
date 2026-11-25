# LeanSlides' portable core: leanslides_core, with miniz and pugixml compiled in.

set(LEANSLIDES_THIRD_PARTY "${PROJECT_SOURCE_DIR}/third_party")

option(LEANSLIDES_WARNINGS_AS_ERRORS
  "Treat warnings in LeanSlides' own core sources as errors" ON)

# Shared configuration for every target that includes miniz or pugixml, so
# the headers always see the same macros as the compiled sources.
add_library(leanslides_vendor_config INTERFACE)
target_include_directories(leanslides_vendor_config SYSTEM INTERFACE
  "${LEANSLIDES_THIRD_PARTY}/miniz"
  "${LEANSLIDES_THIRD_PARTY}/pugixml")
target_compile_definitions(leanslides_vendor_config INTERFACE
  MINIZ_NO_STDIO
  MINIZ_NO_TIME
  MINIZ_NO_ARCHIVE_WRITING_APIS
  MINIZ_NO_ZLIB_COMPATIBLE_NAMES
  PUGIXML_NO_EXCEPTIONS
  PUGIXML_NO_XPATH)

set(LEANSLIDES_CORE_SOURCES
  Cfb.cpp
  Color.cpp
  Deck.cpp
  Links.cpp
  Opc.cpp
  SlideBuilder.cpp
  SlideCore.cpp
  Xml.cpp
  XmlUtil.cpp
  Zip.cpp)
set(LEANSLIDES_VENDOR_SOURCES
  "${LEANSLIDES_THIRD_PARTY}/miniz/miniz.c"
  "${LEANSLIDES_THIRD_PARTY}/pugixml/pugixml.cpp")

add_library(leanslides_core STATIC ${LEANSLIDES_CORE_SOURCES} ${LEANSLIDES_VENDOR_SOURCES})
target_compile_features(leanslides_core PUBLIC cxx_std_17)
target_include_directories(leanslides_core PUBLIC "${PROJECT_SOURCE_DIR}/src")
target_link_libraries(leanslides_core PRIVATE leanslides_vendor_config)

if(MSVC)
  set(LEANSLIDES_CORE_WARNINGS /W4 /permissive- /utf-8)
  set(LEANSLIDES_VENDOR_WARNINGS /w /utf-8)
  set(LEANSLIDES_WERROR /WX)
else()
  set(LEANSLIDES_CORE_WARNINGS -Wall -Wextra -Wpedantic)
  set(LEANSLIDES_VENDOR_WARNINGS -w)
  set(LEANSLIDES_WERROR -Werror)
endif()
if(LEANSLIDES_WARNINGS_AS_ERRORS)
  list(APPEND LEANSLIDES_CORE_WARNINGS ${LEANSLIDES_WERROR})
endif()
set_source_files_properties(${LEANSLIDES_CORE_SOURCES}
  PROPERTIES COMPILE_OPTIONS "${LEANSLIDES_CORE_WARNINGS}")
set_source_files_properties(${LEANSLIDES_VENDOR_SOURCES}
  PROPERTIES COMPILE_OPTIONS "${LEANSLIDES_VENDOR_WARNINGS}")

set(LEANSLIDES_CORE_WARNINGS "${LEANSLIDES_CORE_WARNINGS}" PARENT_SCOPE)
