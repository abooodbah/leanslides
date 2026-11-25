#pragma once

// Internal to the core: the parsed theme, masters, and layouts a deck keeps,
// and the slide builder that turns one slide into the model in docs/MODEL.md.

#include <array>
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <unordered_map>
#include <vector>

#include "core/Color.h"
#include "core/Failure.h"
#include "core/Opc.h"
#include "core/SlideCore.h"
#include "core/Xml.h"
#include "core/XmlUtil.h"
#include "core/Zip.h"

namespace leanslides::core::detail {

struct LoadedPart {
    std::string name;
    XmlPart xml;
    Relationships rels;
    pugi::xml_node root;
};

struct Theme {
    const LoadedPart* part = nullptr;
    std::unordered_map<std::string, Rgba> colors;
    std::string majorLatin, majorEa, majorCs;
    std::string minorLatin, minorEa, minorCs;
    std::vector<pugi::xml_node> fills;    // fillStyleLst children, idx 1..
    std::vector<pugi::xml_node> bgFills;  // bgFillStyleLst children, idx 1001..
    std::vector<pugi::xml_node> lines;    // lnStyleLst children, idx 1..
};

struct Placeholder {
    std::string type;  // "title", "body", ... ("obj" when the file gives none)
    long long idx = -1;
    pugi::xml_node shape;  // p:sp
};

struct Master {
    const LoadedPart* part = nullptr;
    const Theme* theme = nullptr;
    std::unordered_map<std::string, std::string> clrMap;
    pugi::xml_node titleStyle, bodyStyle, otherStyle;
    std::vector<Placeholder> placeholders;
};

struct Layout {
    const LoadedPart* part = nullptr;
    const Master* master = nullptr;
    pugi::xml_node clrMapOverride;  // p:clrMapOvr/a:overrideClrMapping, may be empty
    bool showMasterShapes = true;
    std::vector<Placeholder> placeholders;
};

struct SlideEntry {
    std::string partName;
};

// Counts of features met while building slides (the details pass).
using FeatureCounter = std::map<Feature, std::uint32_t>;

// What the slide builder needs from the deck.
struct DeckContext {
    ZipReader* zip = nullptr;
    const ContentTypes* types = nullptr;
    const Limits* limits = nullptr;
    pugi::xml_node defaultTextStyle;  // presentation.xml p:defaultTextStyle
    pugi::xml_node tableStyles;       // tableStyles.xml root, may be empty
    long long slideWidth = 9144000;
    long long slideHeight = 6858000;
    long long firstSlideNumber = 1;
    std::set<std::string>* servableMedia = nullptr;
    FeatureCounter* features = nullptr;
};

// Builds one slide's JSON. Returns false with failure set when the slide
// part cannot be read or is over a limit.
bool BuildSlideJson(
    const DeckContext& deck,
    const LoadedPart& slide,
    const Layout& layout,
    std::size_t slideIndex,
    std::string& json,
    Failure& failure);

// Plain text of a text body: paragraphs joined by "\n", fields as saved.
std::string TextOfBody(pugi::xml_node txBody);

// Placeholder type of a p:sp / p:pic / p:graphicFrame, "" when it is not one.
bool PlaceholderOf(pugi::xml_node shape, std::string& type, long long& idx);

}  // namespace leanslides::core::detail
