#include "core/Color.h"

#include <cmath>
#include <cstdio>

namespace leanslides::core::detail {

// Stub until the deck model lands.

std::string HexOf(const Rgba& color) {
    const auto channel = [](double value) {
        return static_cast<int>(std::lround(std::fmin(1.0, std::fmax(0.0, value)) * 255.0));
    };
    char text[8];
    std::snprintf(text, sizeof(text), "#%02x%02x%02x", channel(color.r), channel(color.g), channel(color.b));
    return text;
}

std::optional<Rgba> ResolveColorIn(pugi::xml_node, const ColorContext&, const std::optional<Rgba>&) {
    return std::nullopt;
}

std::optional<Rgba> ResolveColorElement(pugi::xml_node, const ColorContext&, const std::optional<Rgba>&) {
    return std::nullopt;
}

Rgba ApplyLumModOff(const Rgba& color, double, double) { return color; }
Rgba ApplyTint(const Rgba& color, double) { return color; }
Rgba ApplyShade(const Rgba& color, double) { return color; }

}  // namespace leanslides::core::detail
