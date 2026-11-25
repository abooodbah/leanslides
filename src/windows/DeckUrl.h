#pragma once

// The addresses the reader asks the host for, below
// https://app.leanslides.invalid/deck/<tab>/<generation>/:
//
//   index.json          the deck index (also sent inline with "document")
//   details.json        every slide's text and notes, for find and copy
//   slide/<n>.json      slide n's model, n counted from 0
//   media?id=<id>       a picture a built slide names, id percent-encoded
//
// Free of Windows headers so tests/hosts/HostLogicTests.cpp checks the
// parsing exactly as the host compiles it.

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>

namespace leanslides::windows_host {

constexpr std::string_view kDeckPrefix = "https://app.leanslides.invalid/deck/";

enum class DeckResource { Index, Details, Slide, Media };

struct DeckRequest {
    unsigned tab = 0;
    unsigned generation = 0;
    DeckResource resource = DeckResource::Index;
    std::size_t slide = 0;
    std::string mediaId;  // decoded
};

// Not written yet: every address is refused.
inline std::optional<DeckRequest> ParseDeckUrl(std::string_view) { return std::nullopt; }

inline bool IsCurrentDeckRequest(const DeckRequest&, bool, unsigned, unsigned, unsigned) {
    return false;
}

inline bool IsServableMediaType(std::string_view) { return false; }

}  // namespace leanslides::windows_host
