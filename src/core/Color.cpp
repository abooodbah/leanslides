#include "core/Color.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

#include "core/XmlUtil.h"

namespace leanslides::core::detail {
namespace {

double Clamp01(double value) {
    return std::min(1.0, std::max(0.0, value));
}

int HexDigit(char digit) {
    if (digit >= '0' && digit <= '9') return digit - '0';
    if (digit >= 'a' && digit <= 'f') return digit - 'a' + 10;
    if (digit >= 'A' && digit <= 'F') return digit - 'A' + 10;
    return -1;
}

std::optional<Rgba> ParseHex(std::string_view text) {
    if (text.size() != 6) {
        return std::nullopt;
    }
    int values[6];
    for (int index = 0; index < 6; ++index) {
        values[index] = HexDigit(text[static_cast<std::size_t>(index)]);
        if (values[index] < 0) {
            return std::nullopt;
        }
    }
    Rgba color;
    color.r = (values[0] * 16 + values[1]) / 255.0;
    color.g = (values[2] * 16 + values[3]) / 255.0;
    color.b = (values[4] * 16 + values[5]) / 255.0;
    return color;
}

double ToLinear(double value) {
    return value <= 0.04045 ? value / 12.92 : std::pow((value + 0.055) / 1.055, 2.4);
}

double ToSrgb(double value) {
    value = Clamp01(value);
    return value <= 0.0031308 ? value * 12.92 : 1.055 * std::pow(value, 1.0 / 2.4) - 0.055;
}

struct Hsl {
    double h = 0;  // 0..360
    double s = 0;
    double l = 0;
};

Hsl ToHsl(const Rgba& color) {
    const double maximum = std::max({color.r, color.g, color.b});
    const double minimum = std::min({color.r, color.g, color.b});
    Hsl hsl;
    hsl.l = (maximum + minimum) / 2;
    const double delta = maximum - minimum;
    if (delta <= 1e-12) {
        return hsl;
    }
    hsl.s = hsl.l > 0.5 ? delta / (2 - maximum - minimum) : delta / (maximum + minimum);
    if (maximum == color.r) {
        hsl.h = std::fmod((color.g - color.b) / delta + 6, 6.0);
    } else if (maximum == color.g) {
        hsl.h = (color.b - color.r) / delta + 2;
    } else {
        hsl.h = (color.r - color.g) / delta + 4;
    }
    hsl.h *= 60;
    return hsl;
}

double HueToChannel(double p, double q, double t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1.0 / 6) return p + (q - p) * 6 * t;
    if (t < 0.5) return q;
    if (t < 2.0 / 3) return p + (q - p) * (2.0 / 3 - t) * 6;
    return p;
}

Rgba FromHsl(const Hsl& hsl, double alpha) {
    Rgba color;
    color.a = alpha;
    const double s = Clamp01(hsl.s);
    const double l = Clamp01(hsl.l);
    if (s <= 1e-12) {
        color.r = color.g = color.b = l;
        return color;
    }
    const double q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const double p = 2 * l - q;
    const double h = std::fmod(std::fmod(hsl.h, 360.0) + 360.0, 360.0) / 360.0;
    color.r = HueToChannel(p, q, h + 1.0 / 3);
    color.g = HueToChannel(p, q, h);
    color.b = HueToChannel(p, q, h - 1.0 / 3);
    return color;
}

struct NamedColor {
    const char* name;
    unsigned value;
};

// The preset colours that appear in real files; the rest of the 140 names
// fall back to black.
constexpr NamedColor kPresetColors[] = {
    {"black", 0x000000},     {"white", 0xFFFFFF},      {"red", 0xFF0000},
    {"green", 0x008000},     {"lime", 0x00FF00},       {"blue", 0x0000FF},
    {"yellow", 0xFFFF00},    {"cyan", 0x00FFFF},       {"aqua", 0x00FFFF},
    {"magenta", 0xFF00FF},   {"fuchsia", 0xFF00FF},    {"gray", 0x808080},
    {"grey", 0x808080},      {"silver", 0xC0C0C0},     {"maroon", 0x800000},
    {"olive", 0x808000},     {"navy", 0x000080},       {"purple", 0x800080},
    {"teal", 0x008080},      {"orange", 0xFFA500},     {"darkGray", 0xA9A9A9},
    {"dkGray", 0xA9A9A9},    {"lightGray", 0xD3D3D3},  {"ltGray", 0xD3D3D3},
    {"darkBlue", 0x00008B},  {"dkBlue", 0x00008B},     {"darkRed", 0x8B0000},
    {"dkRed", 0x8B0000},     {"darkGreen", 0x006400},  {"dkGreen", 0x006400},
    {"lightBlue", 0xADD8E6}, {"ltBlue", 0xADD8E6},     {"brown", 0xA52A2A},
    {"gold", 0xFFD700},      {"pink", 0xFFC0CB},       {"violet", 0xEE82EE},
    {"indigo", 0x4B0082},    {"tan", 0xD2B48C},        {"beige", 0xF5F5DC},
    {"coral", 0xFF7F50},     {"crimson", 0xDC143C},    {"darkOrange", 0xFF8C00},
    {"dkOrange", 0xFF8C00},  {"lightYellow", 0xFFFFE0}, {"ltYellow", 0xFFFFE0},
    {"lightGreen", 0x90EE90}, {"ltGreen", 0x90EE90},   {"skyBlue", 0x87CEEB},
    {"steelBlue", 0x4682B4}, {"tomato", 0xFF6347},     {"wheat", 0xF5DEB3},
};

Rgba FromValue(unsigned value) {
    Rgba color;
    color.r = ((value >> 16) & 0xFF) / 255.0;
    color.g = ((value >> 8) & 0xFF) / 255.0;
    color.b = (value & 0xFF) / 255.0;
    return color;
}

std::optional<Rgba> BaseColor(
    pugi::xml_node element,
    const ColorContext& context,
    const std::optional<Rgba>& placeholder) {
    if (Is(element, "srgbClr")) {
        return ParseHex(AttrText(element, "val"));
    }
    if (Is(element, "schemeClr")) {
        std::string name(AttrText(element, "val"));
        if (name == "phClr") {
            return placeholder ? placeholder : std::optional<Rgba>(Rgba{});
        }
        const auto mapped = context.map.find(name);
        if (mapped != context.map.end()) {
            name = mapped->second;
        } else if (name == "bg1") {
            name = "lt1";
        } else if (name == "tx1") {
            name = "dk1";
        } else if (name == "bg2") {
            name = "lt2";
        } else if (name == "tx2") {
            name = "dk2";
        }
        const auto found = context.theme.find(name);
        return found == context.theme.end() ? std::optional<Rgba>(Rgba{}) : found->second;
    }
    if (Is(element, "sysClr")) {
        if (auto last = ParseHex(AttrText(element, "lastClr"))) {
            return last;
        }
        const std::string_view value = AttrText(element, "val");
        return value == "window" ? FromValue(0xFFFFFF) : FromValue(0x000000);
    }
    if (Is(element, "prstClr")) {
        const std::string_view value = AttrText(element, "val");
        for (const NamedColor& named : kPresetColors) {
            if (value == named.name) {
                return FromValue(named.value);
            }
        }
        return FromValue(0x000000);
    }
    if (Is(element, "scrgbClr")) {
        Rgba color;
        color.r = ToSrgb(AttrPercent(element, "r", 0));
        color.g = ToSrgb(AttrPercent(element, "g", 0));
        color.b = ToSrgb(AttrPercent(element, "b", 0));
        return color;
    }
    if (Is(element, "hslClr")) {
        Hsl hsl;
        hsl.h = static_cast<double>(AttrInt(element, "hue", 0)) / 60000.0;
        hsl.s = AttrPercent(element, "sat", 0);
        hsl.l = AttrPercent(element, "lum", 0);
        return FromHsl(hsl, 1);
    }
    return std::nullopt;
}

bool IsColorElement(pugi::xml_node node) {
    return Is(node, "srgbClr") || Is(node, "schemeClr") || Is(node, "sysClr") ||
           Is(node, "prstClr") || Is(node, "scrgbClr") || Is(node, "hslClr");
}

}  // namespace

std::string HexOf(const Rgba& color) {
    char text[8];
    const auto channel = [](double value) {
        return static_cast<int>(std::lround(Clamp01(value) * 255));
    };
    std::snprintf(text, sizeof(text), "#%02x%02x%02x", channel(color.r), channel(color.g),
                  channel(color.b));
    return text;
}

Rgba ApplyLumModOff(const Rgba& color, double modulate, double offset) {
    Hsl hsl = ToHsl(color);
    hsl.l = Clamp01(hsl.l * modulate + offset);
    return FromHsl(hsl, color.a);
}

Rgba ApplyTint(const Rgba& color, double tint) {
    Rgba result = color;
    const auto apply = [tint](double channel) {
        return ToSrgb(1 - (1 - ToLinear(channel)) * tint);
    };
    result.r = apply(color.r);
    result.g = apply(color.g);
    result.b = apply(color.b);
    return result;
}

Rgba ApplyShade(const Rgba& color, double shade) {
    Rgba result = color;
    const auto apply = [shade](double channel) { return ToSrgb(ToLinear(channel) * shade); };
    result.r = apply(color.r);
    result.g = apply(color.g);
    result.b = apply(color.b);
    return result;
}

std::optional<Rgba> ResolveColorElement(
    pugi::xml_node element,
    const ColorContext& context,
    const std::optional<Rgba>& placeholder) {
    std::optional<Rgba> base = BaseColor(element, context, placeholder);
    if (!base) {
        return std::nullopt;
    }
    Rgba color = *base;
    for (pugi::xml_node transform = element.first_child(); transform;
         transform = transform.next_sibling()) {
        if (transform.type() != pugi::node_element) {
            continue;
        }
        const double value = AttrPercent(transform, "val", 0);
        if (Is(transform, "lumMod")) {
            const pugi::xml_node next = transform.next_sibling();
            double offset = 0;
            // lumMod and lumOff pairs are one HSL step in PowerPoint.
            if (next && Is(next, "lumOff")) {
                offset = AttrPercent(next, "val", 0);
                transform = next;
            }
            color = ApplyLumModOff(color, value, offset);
        } else if (Is(transform, "lumOff")) {
            color = ApplyLumModOff(color, 1, value);
        } else if (Is(transform, "lum")) {
            Hsl hsl = ToHsl(color);
            hsl.l = Clamp01(value);
            color = FromHsl(hsl, color.a);
        } else if (Is(transform, "satMod") || Is(transform, "satOff") || Is(transform, "sat")) {
            Hsl hsl = ToHsl(color);
            hsl.s = Is(transform, "satMod") ? hsl.s * value
                    : Is(transform, "satOff") ? hsl.s + value
                                              : value;
            color = FromHsl(hsl, color.a);
        } else if (Is(transform, "hueMod") || Is(transform, "hueOff") || Is(transform, "hue")) {
            Hsl hsl = ToHsl(color);
            const double angle = static_cast<double>(AttrInt(transform, "val", 0)) / 60000.0;
            hsl.h = Is(transform, "hueMod") ? hsl.h * value
                    : Is(transform, "hueOff") ? hsl.h + angle
                                              : angle;
            color = FromHsl(hsl, color.a);
        } else if (Is(transform, "tint")) {
            color = ApplyTint(color, value);
        } else if (Is(transform, "shade")) {
            color = ApplyShade(color, value);
        } else if (Is(transform, "alpha")) {
            color.a = Clamp01(value);
        } else if (Is(transform, "alphaMod")) {
            color.a = Clamp01(color.a * value);
        } else if (Is(transform, "alphaOff")) {
            color.a = Clamp01(color.a + value);
        } else if (Is(transform, "comp")) {
            Hsl hsl = ToHsl(color);
            hsl.h += 180;
            color = FromHsl(hsl, color.a);
        } else if (Is(transform, "inv")) {
            color.r = 1 - color.r;
            color.g = 1 - color.g;
            color.b = 1 - color.b;
        } else if (Is(transform, "gray")) {
            const double gray = 0.3 * color.r + 0.59 * color.g + 0.11 * color.b;
            color.r = color.g = color.b = gray;
        }
    }
    return color;
}

std::optional<Rgba> ResolveColorIn(
    pugi::xml_node parent,
    const ColorContext& context,
    const std::optional<Rgba>& placeholder) {
    for (pugi::xml_node child = parent.first_child(); child; child = child.next_sibling()) {
        if (IsColorElement(child)) {
            return ResolveColorElement(child, context, placeholder);
        }
    }
    return std::nullopt;
}

}  // namespace leanslides::core::detail
