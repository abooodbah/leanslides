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

// Plain decimal without a leading zero (except "0" itself when allowZero),
// at most nine digits.
inline bool ParseDeckNumber(std::string_view text, unsigned& value, bool allowZero) {
    if (text.empty() || text.size() > 9) {
        return false;
    }
    if (text.front() == '0' && !(allowZero && text.size() == 1)) {
        return false;
    }
    unsigned parsed = 0;
    for (const char digit : text) {
        if (digit < '0' || digit > '9') {
            return false;
        }
        parsed = parsed * 10 + static_cast<unsigned>(digit - '0');
    }
    if (parsed == 0 && !allowZero) {
        return false;
    }
    value = parsed;
    return true;
}

inline int HexValue(char character) {
    if (character >= '0' && character <= '9') return character - '0';
    if (character >= 'a' && character <= 'f') return character - 'a' + 10;
    if (character >= 'A' && character <= 'F') return character - 'A' + 10;
    return -1;
}

// Decodes %XX escapes. A malformed escape, a NUL, or a '+' (which the reader
// never sends, since it uses encodeURIComponent) fails.
inline std::optional<std::string> PercentDecode(std::string_view text) {
    std::string decoded;
    decoded.reserve(text.size());
    for (std::size_t index = 0; index < text.size(); ++index) {
        const char character = text[index];
        if (character == '%') {
            if (index + 2 >= text.size()) {
                return std::nullopt;
            }
            const int high = HexValue(text[index + 1]);
            const int low = HexValue(text[index + 2]);
            if (high < 0 || low < 0) {
                return std::nullopt;
            }
            const char value = static_cast<char>(high * 16 + low);
            if (value == '\0') {
                return std::nullopt;
            }
            decoded.push_back(value);
            index += 2;
        } else if (character == '+' || character == '\0') {
            return std::nullopt;
        } else {
            decoded.push_back(character);
        }
    }
    return decoded;
}

inline std::optional<DeckRequest> ParseDeckUrl(std::string_view uri) {
    if (uri.size() > 2048 || uri.substr(0, kDeckPrefix.size()) != kDeckPrefix) {
        return std::nullopt;
    }
    std::string_view rest = uri.substr(kDeckPrefix.size());
    if (rest.find('#') != std::string_view::npos) {
        return std::nullopt;
    }
    DeckRequest request;
    const std::size_t first = rest.find('/');
    if (first == std::string_view::npos ||
        !ParseDeckNumber(rest.substr(0, first), request.tab, false)) {
        return std::nullopt;
    }
    rest = rest.substr(first + 1);
    const std::size_t second = rest.find('/');
    if (second == std::string_view::npos ||
        !ParseDeckNumber(rest.substr(0, second), request.generation, false)) {
        return std::nullopt;
    }
    rest = rest.substr(second + 1);

    if (rest == "index.json") {
        request.resource = DeckResource::Index;
        return request;
    }
    if (rest == "details.json") {
        request.resource = DeckResource::Details;
        return request;
    }
    constexpr std::string_view kSlide = "slide/";
    constexpr std::string_view kJson = ".json";
    if (rest.size() > kSlide.size() + kJson.size() && rest.substr(0, kSlide.size()) == kSlide &&
        rest.substr(rest.size() - kJson.size()) == kJson) {
        unsigned slide = 0;
        if (!ParseDeckNumber(
                rest.substr(kSlide.size(), rest.size() - kSlide.size() - kJson.size()), slide,
                true)) {
            return std::nullopt;
        }
        request.resource = DeckResource::Slide;
        request.slide = slide;
        return request;
    }
    constexpr std::string_view kMedia = "media?id=";
    if (rest.size() > kMedia.size() && rest.substr(0, kMedia.size()) == kMedia) {
        const std::string_view encoded = rest.substr(kMedia.size());
        if (encoded.find('&') != std::string_view::npos) {
            return std::nullopt;
        }
        auto decoded = PercentDecode(encoded);
        if (!decoded || decoded->empty() || decoded->size() > 1024) {
            return std::nullopt;
        }
        request.resource = DeckResource::Media;
        request.mediaId = std::move(*decoded);
        return request;
    }
    return std::nullopt;
}

// The host answers a deck address only for the deck it holds, and only
// while that deck's tab is the active one: an address from a closed tab, an
// older generation (the file changed), or a background tab gets 404.
inline bool IsCurrentDeckRequest(const DeckRequest& request, bool haveDeck, unsigned deckTab,
                                 unsigned deckGeneration, unsigned activeTab) {
    return haveDeck && request.tab == deckTab && request.generation == deckGeneration &&
           request.tab == activeTab;
}

// The picture types the reader's <img> may receive. Media() already sniffs
// the bytes; this keeps any other type the core might report off the wire.
inline bool IsServableMediaType(std::string_view type) {
    return type == "image/png" || type == "image/jpeg" || type == "image/gif" ||
           type == "image/bmp";
}

}  // namespace leanslides::windows_host
