add_executable(leanslides_core_tests CoreTests.cpp TestZip.cpp)
target_compile_features(leanslides_core_tests PRIVATE cxx_std_17)
target_compile_options(leanslides_core_tests PRIVATE ${LEANSLIDES_CORE_WARNINGS})
target_link_libraries(leanslides_core_tests PRIVATE leanslides_core leanslides_vendor_config)
add_test(NAME leanslides-core
  COMMAND leanslides_core_tests "${PROJECT_SOURCE_DIR}/tests/corpus/cache")
