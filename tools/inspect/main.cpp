// leanslides-inspect: prints the core's view of a presentation. It reads files
// and writes only to standard output, or to the one file --media-out names.

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include "core/SlideCore.h"

namespace {

namespace core = leanslides::core;
namespace fs = std::filesystem;

constexpr int kUsageError = 2;

void PrintUsage() {
    std::fputs(
        "Usage:\n"
        "  leanslides-inspect [--time] FILE              deck index (JSON)\n"
        "  leanslides-inspect --slide N FILE             slide N's model (1-based)\n"
        "  leanslides-inspect --all-slides [--time] FILE every slide model, one per line\n"
        "  leanslides-inspect --media ID --media-out OUT FILE\n"
        "\n"
        "--time adds the open time (and the slide build time) in milliseconds.\n",
        stderr);
}

void Write(const std::string& text) {
    std::fwrite(text.data(), 1, text.size(), stdout);
    std::fputc('\n', stdout);
}

double Since(std::chrono::steady_clock::time_point start) {
    return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start)
        .count();
}

std::string WithMs(const std::string& json, double milliseconds) {
    char text[48];
    std::snprintf(text, sizeof(text), "{\"ms\":%.1f,", milliseconds);
    return json.size() > 1 ? text + json.substr(1) : json;
}

}  // namespace

int main(int argc, char** argv) {
    bool timed = false;
    bool allSlides = false;
    long slide = 0;
    std::string mediaId;
    std::string mediaOut;
    std::vector<std::string> files;
    for (int index = 1; index < argc; ++index) {
        const std::string argument = argv[index];
        if (argument == "--time") {
            timed = true;
        } else if (argument == "--all-slides") {
            allSlides = true;
        } else if (argument == "--slide" && index + 1 < argc) {
            slide = std::strtol(argv[++index], nullptr, 10);
        } else if (argument == "--media" && index + 1 < argc) {
            mediaId = argv[++index];
        } else if (argument == "--media-out" && index + 1 < argc) {
            mediaOut = argv[++index];
        } else if (!argument.empty() && argument[0] == '-') {
            PrintUsage();
            return kUsageError;
        } else {
            files.push_back(argument);
        }
    }
    if (files.size() != 1 || (!mediaId.empty() && mediaOut.empty())) {
        PrintUsage();
        return kUsageError;
    }

    const auto start = std::chrono::steady_clock::now();
    const core::OpenResult result = core::OpenPresentationFile(fs::u8path(files[0]));
    const double openMs = Since(start);
    if (!result.ok || !result.presentation) {
        Write(timed ? WithMs(core::FailureJson(result), openMs) : core::FailureJson(result));
        return result.ok ? 0 : 1;
    }
    core::Presentation& deck = *result.presentation;

    if (!mediaId.empty()) {
        // A picture is served only after a slide that names it was built.
        std::string json;
        std::string code;
        for (std::size_t index = 0; index < deck.SlideCount(); ++index) {
            deck.SlideJson(index, json, code);
        }
        std::string bytes;
        std::string type;
        if (!deck.Media(mediaId, bytes, type)) {
            std::fputs("media not found\n", stderr);
            return 1;
        }
        std::ofstream output(fs::u8path(mediaOut), std::ios::binary);
        output.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
        Write(type);
        return output ? 0 : 1;
    }

    if (slide > 0 || allSlides) {
        const std::size_t first = allSlides ? 0 : static_cast<std::size_t>(slide - 1);
        const std::size_t last = allSlides ? deck.SlideCount() : first + 1;
        int status = 0;
        for (std::size_t index = first; index < last; ++index) {
            std::string json;
            std::string code;
            const auto slideStart = std::chrono::steady_clock::now();
            if (index >= deck.SlideCount() || !deck.SlideJson(index, json, code)) {
                std::fprintf(stderr, "slide %zu failed: %s\n", index + 1,
                             code.empty() ? "out-of-range" : code.c_str());
                status = 1;
                continue;
            }
            Write(timed ? WithMs(json, Since(slideStart)) : json);
        }
        return status;
    }

    Write(timed ? WithMs(deck.IndexJson(), openMs) : deck.IndexJson());
    return 0;
}
