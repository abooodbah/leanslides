#pragma once

// Internal to the core: DrawingML colour resolution. Scheme colours go through
// the slide's colour map to the theme; transforms (lumMod, tint, shade, alpha,
// ...) are applied in document order, as PowerPoint does.

#include <array>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>

#include "pugixml.hpp"

namespace leanslides::core::detail {

struct Rgba {
    double r = 0;  // 0..1, sRGB
    double g = 0;
    double b = 0;
    double a = 1;
};

std::string HexOf(const Rgba& color);

struct ColorContext {
    // Theme colours by name: dk1, lt1, dk2, lt2, accent1..accent6, hlink, folHlink.
    std::unordered_map<std::string, Rgba> theme;
    // The effective colour map: bg1, tx1, bg2, tx2 (and any other alias) to a
    // theme colour name.
    std::unordered_map<std::string, std::string> map;
};

// Resolves the first colour element inside `parent` (srgbClr, schemeClr,
// sysClr, prstClr, hslClr, scrgbClr). `placeholder` replaces phClr inside
// theme style matrices.
std::optional<Rgba> ResolveColorIn(
    pugi::xml_node parent,
    const ColorContext& context,
    const std::optional<Rgba>& placeholder = std::nullopt);

// Resolves one colour element itself.
std::optional<Rgba> ResolveColorElement(
    pugi::xml_node element,
    const ColorContext& context,
    const std::optional<Rgba>& placeholder = std::nullopt);

// Exposed for the tests.
Rgba ApplyLumModOff(const Rgba& color, double modulate, double offset);
Rgba ApplyTint(const Rgba& color, double tint);
Rgba ApplyShade(const Rgba& color, double shade);

}  // namespace leanslides::core::detail
