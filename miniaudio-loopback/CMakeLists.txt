cmake_minimum_required(VERSION 3.20)

project(miniaudio-loopback LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(miniaudio-loopback src/main.cpp)

target_include_directories(miniaudio-loopback PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(miniaudio-loopback PRIVATE ole32 uuid)

enable_testing()
add_executable(capture-timeline-test src/timeline.test.cpp)
add_test(NAME capture-timeline COMMAND capture-timeline-test)

set_target_properties(miniaudio-loopback PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/bin
    RUNTIME_OUTPUT_DIRECTORY_DEBUG ${CMAKE_CURRENT_SOURCE_DIR}/bin
    RUNTIME_OUTPUT_DIRECTORY_RELEASE ${CMAKE_CURRENT_SOURCE_DIR}/bin
    RUNTIME_OUTPUT_DIRECTORY_RELWITHDEBINFO ${CMAKE_CURRENT_SOURCE_DIR}/bin
    RUNTIME_OUTPUT_DIRECTORY_MINSIZEREL ${CMAKE_CURRENT_SOURCE_DIR}/bin
)
