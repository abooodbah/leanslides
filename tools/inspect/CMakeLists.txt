add_executable(leanslides-inspect main.cpp)
target_compile_features(leanslides-inspect PRIVATE cxx_std_17)
target_compile_options(leanslides-inspect PRIVATE ${LEANSLIDES_CORE_WARNINGS})
target_link_libraries(leanslides-inspect PRIVATE leanslides_core)
