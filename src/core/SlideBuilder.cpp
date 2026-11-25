// Builds one slide's model (docs/MODEL.md): every shape with its inherited
// geometry, fill, line, and text resolved against the layout, the master, and
// the theme.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <functional>

#include "core/DeckTypes.h"

namespace leanslides::core::detail {
namespace {

constexpr long long kEmuPerPoint = 12700;

// ---------------------------------------------------------------- JSON output

void Quoted(std::string& out, std::string_view value) {
    out += '"';
    AppendJsonString(out, value);
    out += '"';
}

void Key(std::string& out, const char* key) {
    if (!out.empty() && out.back() != '{' && out.back() != '[') {
        out += ',';
    }
    out += '"';
    out += key;
    out += "\":";
}

void Number(std::string& out, double value) {
    if (!std::isfinite(value)) {
        value = 0;
    }
    char text[40];
    if (std::fabs(value - std::round(value)) < 1e-9 && std::fabs(value) < 9e15) {
        std::snprintf(text, sizeof(text), "%lld", static_cast<long long>(std::llround(value)));
    } else {
        std::snprintf(text, sizeof(text), "%.4f", value);
        std::size_t length = std::strlen(text);
        while (length > 0 && text[length - 1] == '0') {
            text[--length] = '\0';
        }
        if (length > 0 && text[length - 1] == '.') {
            text[--length] = '\0';
        }
    }
    out += text;
}

void KeyNumber(std::string& out, const char* key, double value) {
    Key(out, key);
    Number(out, value);
}

void KeyString(std::string& out, const char* key, std::string_view value) {
    Key(out, key);
    Quoted(out, value);
}

void KeyBool(std::string& out, const char* key, bool value) {
    Key(out, key);
    out += value ? "true" : "false";
}

void Separator(std::string& out) {
    if (!out.empty() && out.back() != '[' && out.back() != '{') {
        out += ',';
    }
}

// ------------------------------------------------------------- text styles

struct Spacing {
    bool percent = true;
    double value = 0;  // fraction for percent, points otherwise
};

struct RunStyle {
    std::optional<double> size;  // points
    std::optional<bool> bold, italic;
    std::optional<std::string> underline, strike, cap;
    std::optional<std::string> latin, ea, cs;
    std::optional<Rgba> color;
    std::optional<Rgba> highlight;
    std::optional<double> baseline;  // percent
    std::optional<double> spacing;   // points
};

struct ParaStyle {
    std::optional<std::string> align;
    std::optional<long long> marL, indent;
    std::optional<Spacing> lineSpacing, spaceBefore, spaceAfter;
    std::optional<bool> rtl;
    std::optional<std::string> bulletType;  // none, char, num, pic
    std::optional<std::string> bulletChar, bulletScheme, bulletMedia, bulletFont;
    std::optional<long long> bulletStart;
    std::optional<bool> bulletFontFollowsText;
    std::optional<Rgba> bulletColor;
    std::optional<bool> bulletColorFollowsText;
    std::optional<double> bulletSizePercent, bulletSizePoints;
    RunStyle run;
};

std::optional<Rgba> FirstFillColor(pugi::xml_node node, const ColorContext& colors,
                                   const std::optional<Rgba>& placeholder = std::nullopt) {
    if (const pugi::xml_node solid = Child(node, "solidFill")) {
        return ResolveColorIn(solid, colors, placeholder);
    }
    if (const pugi::xml_node gradient = Child(node, "gradFill")) {
        if (const pugi::xml_node stops = Child(gradient, "gsLst")) {
            if (const pugi::xml_node stop = Child(stops, "gs")) {
                return ResolveColorIn(stop, colors, placeholder);
            }
        }
    }
    if (Child(node, "noFill")) {
        Rgba transparent;
        transparent.a = 0;
        return transparent;
    }
    return std::nullopt;
}

void ApplyRunProperties(RunStyle& style, pugi::xml_node rPr, const ColorContext& colors) {
    if (!rPr) {
        return;
    }
    if (HasAttr(rPr, "sz")) style.size = static_cast<double>(AttrInt(rPr, "sz", 1800)) / 100.0;
    if (HasAttr(rPr, "b")) style.bold = AttrBool(rPr, "b", false);
    if (HasAttr(rPr, "i")) style.italic = AttrBool(rPr, "i", false);
    if (HasAttr(rPr, "u")) style.underline = std::string(AttrText(rPr, "u"));
    if (HasAttr(rPr, "strike")) style.strike = std::string(AttrText(rPr, "strike"));
    if (HasAttr(rPr, "cap")) style.cap = std::string(AttrText(rPr, "cap"));
    if (HasAttr(rPr, "baseline")) style.baseline = AttrPercent(rPr, "baseline", 0) * 100.0;
    if (HasAttr(rPr, "spc")) style.spacing = static_cast<double>(AttrInt(rPr, "spc", 0)) / 100.0;
    if (const pugi::xml_node latin = Child(rPr, "latin")) style.latin = std::string(AttrText(latin, "typeface"));
    if (const pugi::xml_node ea = Child(rPr, "ea")) style.ea = std::string(AttrText(ea, "typeface"));
    if (const pugi::xml_node cs = Child(rPr, "cs")) style.cs = std::string(AttrText(cs, "typeface"));
    if (auto color = FirstFillColor(rPr, colors)) style.color = color;
    if (const pugi::xml_node highlight = Child(rPr, "highlight")) {
        if (auto color = ResolveColorIn(highlight, colors)) style.highlight = color;
    }
}

std::optional<Spacing> ReadSpacing(pugi::xml_node node) {
    if (!node) {
        return std::nullopt;
    }
    Spacing spacing;
    if (const pugi::xml_node percent = Child(node, "spcPct")) {
        spacing.percent = true;
        spacing.value = AttrPercent(percent, "val", 1.0);
        return spacing;
    }
    if (const pugi::xml_node points = Child(node, "spcPts")) {
        spacing.percent = false;
        spacing.value = static_cast<double>(AttrInt(points, "val", 0)) / 100.0;
        return spacing;
    }
    return std::nullopt;
}

void ApplyParagraphProperties(ParaStyle& style, pugi::xml_node pPr, const ColorContext& colors) {
    if (!pPr) {
        return;
    }
    if (HasAttr(pPr, "algn")) style.align = std::string(AttrText(pPr, "algn"));
    if (HasAttr(pPr, "marL")) style.marL = AttrInt(pPr, "marL", 0);
    if (HasAttr(pPr, "indent")) style.indent = AttrInt(pPr, "indent", 0);
    if (HasAttr(pPr, "rtl")) style.rtl = AttrBool(pPr, "rtl", false);
    if (auto spacing = ReadSpacing(Child(pPr, "lnSpc"))) style.lineSpacing = spacing;
    if (auto spacing = ReadSpacing(Child(pPr, "spcBef"))) style.spaceBefore = spacing;
    if (auto spacing = ReadSpacing(Child(pPr, "spcAft"))) style.spaceAfter = spacing;
    for (pugi::xml_node child = pPr.first_child(); child; child = child.next_sibling()) {
        if (Is(child, "buNone")) {
            style.bulletType = std::string("none");
        } else if (Is(child, "buChar")) {
            style.bulletType = std::string("char");
            style.bulletChar = std::string(AttrText(child, "char"));
        } else if (Is(child, "buAutoNum")) {
            style.bulletType = std::string("num");
            style.bulletScheme = std::string(AttrText(child, "type"));
            style.bulletStart = AttrInt(child, "startAt", 1);
        } else if (Is(child, "buBlip")) {
            style.bulletType = std::string("pic");
            if (const pugi::xml_node blip = Child(child, "blip")) {
                style.bulletMedia = std::string(RelAttr(blip, "embed"));
            }
        } else if (Is(child, "buFontTx")) {
            style.bulletFontFollowsText = true;
        } else if (Is(child, "buFont")) {
            style.bulletFontFollowsText = false;
            style.bulletFont = std::string(AttrText(child, "typeface"));
        } else if (Is(child, "buClrTx")) {
            style.bulletColorFollowsText = true;
        } else if (Is(child, "buClr")) {
            style.bulletColorFollowsText = false;
            style.bulletColor = ResolveColorIn(child, colors);
        } else if (Is(child, "buSzTx")) {
            style.bulletSizePercent.reset();
            style.bulletSizePoints.reset();
        } else if (Is(child, "buSzPct")) {
            style.bulletSizePercent = AttrPercent(child, "val", 1.0);
            style.bulletSizePoints.reset();
        } else if (Is(child, "buSzPts")) {
            style.bulletSizePoints = static_cast<double>(AttrInt(child, "val", 1800)) / 100.0;
            style.bulletSizePercent.reset();
        }
    }
    ApplyRunProperties(style.run, Child(pPr, "defRPr"), colors);
}

// One link in the chain of text styles a text body inherits.
struct StyleSource {
    pugi::xml_node list;      // a list style (lstStyle, txStyles child, defaultTextStyle)
    pugi::xml_node fontRef;   // or a p:style fontRef
    pugi::xml_node textStyle; // or a table style tcTxStyle
};

// --------------------------------------------------------------- geometry

struct Box {
    double x = 0, y = 0, w = 0, h = 0;
    double rot = 0;
    bool flipH = false, flipV = false;
};

// Maps a group's child coordinates to the slide.
struct Transform {
    double ox = 0, oy = 0;     // group offset on the slide
    double cx = 0, cy = 0;     // child offset
    double sx = 1, sy = 1;     // ext / chExt

    // The child's centre moves with the group; its size scales along its own
    // axes, so a child turned near 90 or 270 degrees takes the group's
    // vertical scale on its width (as PowerPoint places it).
    Box Apply(const Box& local) const {
        Box box = local;
        double turn = std::fmod(local.rot, 180.0);
        if (turn < 0) turn += 180.0;
        const bool swapped = turn >= 45.0 && turn < 135.0;
        box.w = local.w * (swapped ? sy : sx);
        box.h = local.h * (swapped ? sx : sy);
        const double centerX = ox + (local.x + local.w / 2 - cx) * sx;
        const double centerY = oy + (local.y + local.h / 2 - cy) * sy;
        box.x = centerX - box.w / 2;
        box.y = centerY - box.h / 2;
        return box;
    }
};

bool ReadXfrm(pugi::xml_node xfrm, Box& box) {
    if (!xfrm) {
        return false;
    }
    const pugi::xml_node off = Child(xfrm, "off");
    const pugi::xml_node ext = Child(xfrm, "ext");
    if (!off && !ext) {
        return false;
    }
    box.x = static_cast<double>(AttrInt(off, "x", 0));
    box.y = static_cast<double>(AttrInt(off, "y", 0));
    box.w = static_cast<double>(AttrInt(ext, "cx", 0));
    box.h = static_cast<double>(AttrInt(ext, "cy", 0));
    box.rot = static_cast<double>(AttrInt(xfrm, "rot", 0)) / 60000.0;
    box.flipH = AttrBool(xfrm, "flipH", false);
    box.flipV = AttrBool(xfrm, "flipV", false);
    return true;
}

void EmitBox(std::string& out, const Box& box) {
    KeyNumber(out, "x", std::round(box.x));
    KeyNumber(out, "y", std::round(box.y));
    KeyNumber(out, "w", std::round(box.w));
    KeyNumber(out, "h", std::round(box.h));
    if (box.rot != 0) KeyNumber(out, "rot", box.rot);
    if (box.flipH) KeyBool(out, "flipH", true);
    if (box.flipV) KeyBool(out, "flipV", true);
}

std::string_view MasterTypeFor(std::string_view type) {
    if (type == "title" || type == "ctrTitle") return "title";
    if (type == "dt" || type == "ftr" || type == "sldNum" || type == "hdr") return type;
    return "body";
}

bool SameFamily(std::string_view left, std::string_view right) {
    const auto title = [](std::string_view type) { return type == "title" || type == "ctrTitle"; };
    if (title(left) || title(right)) {
        return title(left) && title(right);
    }
    const auto body = [](std::string_view type) {
        return type == "body" || type == "obj" || type == "subTitle";
    };
    if (body(left) && body(right)) {
        return left == right || left == "obj" || right == "obj";
    }
    return left == right;
}

const Placeholder* FindPlaceholder(
    const std::vector<Placeholder>& list, std::string_view type, long long idx, bool byIndex) {
    const Placeholder* byType = nullptr;
    for (const Placeholder& placeholder : list) {
        if (placeholder.type == type) {
            byType = &placeholder;
            break;
        }
    }
    if (byIndex && idx >= 0) {
        for (const Placeholder& placeholder : list) {
            if (placeholder.idx != idx) continue;
            // An untyped placeholder takes whatever its idx names; a typed one
            // keeps to its own family when the layout has one of its type.
            if (type == "obj" || SameFamily(placeholder.type, type) || byType == nullptr) {
                return &placeholder;
            }
            break;
        }
    }
    if (byType != nullptr) {
        return byType;
    }
    for (const Placeholder& placeholder : list) {
        if (SameFamily(placeholder.type, type)) {
            return &placeholder;
        }
    }
    return nullptr;
}

std::string MediaStatus(const ContentTypes& types, const std::string& partName) {
    const std::string type = LowercaseAscii(types.TypeOf(partName));
    const std::string extension = Extension(partName);
    if (type == "image/png" || type == "image/jpeg" || type == "image/jpg" ||
        type == "image/gif" || type == "image/bmp" || type == "image/x-png" ||
        extension == "png" || extension == "jpg" || extension == "jpeg" || extension == "gif" ||
        extension == "bmp" || extension == "jfif") {
        return "";
    }
    if (type == "image/x-emf" || type == "image/emf" || type == "image/x-wmf" ||
        type == "image/wmf" || extension == "emf" || extension == "wmf" || extension == "emz" ||
        extension == "wmz") {
        return "metafile";
    }
    return "unsupported-image";
}

// ---------------------------------------------------------------- builder

class SlideBuilder {
public:
    SlideBuilder(const DeckContext& deck, const LoadedPart& slide, const Layout& layout,
                 std::size_t index, Failure& failure)
        : deck_(deck), slide_(slide), layout_(layout), master_(*layout.master),
          theme_(*layout.master->theme), index_(index), failure_(failure) {
        colors_.theme = theme_.colors;
        colors_.map = master_.clrMap;
        ApplyOverride(Child(layout_.part->root, "clrMapOvr"));
        ApplyOverride(Child(slide_.root, "clrMapOvr"));
    }

    bool Run(std::string& json) {
        json.clear();
        json.reserve(16 * 1024);
        json += '{';
        KeyNumber(json, "index", static_cast<double>(index_));
        KeyNumber(json, "w", static_cast<double>(deck_.slideWidth));
        KeyNumber(json, "h", static_cast<double>(deck_.slideHeight));
        if (AttrText(slide_.root, "show") == "0") {
            KeyBool(json, "hidden", true);
        }
        Key(json, "background");
        EmitBackground(json);
        Key(json, "shapes");
        json += '[';
        const bool slideShowsMaster = AttrBool(slide_.root, "showMasterSp", true);
        if (slideShowsMaster && layout_.showMasterShapes) {
            layer_ = "master";
            EmitTree(json, *master_.part, SpTree(master_.part->root), Transform{}, true);
        }
        if (slideShowsMaster) {
            layer_ = "layout";
            EmitTree(json, *layout_.part, SpTree(layout_.part->root), Transform{}, true);
        }
        layer_ = nullptr;
        EmitTree(json, slide_, SpTree(slide_.root), Transform{}, false);
        // ActiveX controls live beside the shape tree, drawn above it.
        EmitNode(json, slide_, Child(Child(slide_.root, "cSld"), "controls"), Transform{}, false);
        json += "]}";
        return !failure_.Failed();
    }

private:
    static pugi::xml_node SpTree(pugi::xml_node root) {
        return Child(Child(root, "cSld"), "spTree");
    }

    void ApplyOverride(pugi::xml_node clrMapOvr) {
        const pugi::xml_node mapping = Child(clrMapOvr, "overrideClrMapping");
        if (!mapping) {
            return;
        }
        for (pugi::xml_attribute attribute = mapping.first_attribute(); attribute;
             attribute = attribute.next_attribute()) {
            colors_.map[LocalName(attribute.name())] = attribute.value();
        }
    }

    void Count(Feature feature) {
        if (deck_.features) {
            ++(*deck_.features)[feature];
        }
    }

    // ------------------------------------------------------------ fills

    // Emits a Fill for the fill element among `parent`'s children, if any.
    bool EmitFillIn(std::string& out, pugi::xml_node parent, const LoadedPart& owner,
                    const std::optional<Rgba>& placeholder = std::nullopt) {
        for (pugi::xml_node child = parent.first_child(); child; child = child.next_sibling()) {
            if (EmitFillElement(out, child, owner, placeholder)) {
                return true;
            }
        }
        return false;
    }

    static bool IsFillElement(pugi::xml_node node) {
        return Is(node, "noFill") || Is(node, "solidFill") || Is(node, "gradFill") ||
               Is(node, "blipFill") || Is(node, "pattFill") || Is(node, "grpFill");
    }

    bool EmitFillElement(std::string& out, pugi::xml_node fill, const LoadedPart& owner,
                         const std::optional<Rgba>& placeholder) {
        if (Is(fill, "noFill")) {
            out += "{\"type\":\"none\"}";
            return true;
        }
        if (Is(fill, "solidFill")) {
            const std::optional<Rgba> color = ResolveColorIn(fill, colors_, placeholder);
            EmitSolid(out, color.value_or(Rgba{}));
            return true;
        }
        if (Is(fill, "grpFill")) {
            if (!groupFill_.empty()) {
                out += groupFill_;
            } else {
                out += "{\"type\":\"none\"}";
            }
            return true;
        }
        if (Is(fill, "gradFill")) {
            out += "{\"type\":\"gradient\"";
            const pugi::xml_node path = Child(fill, "path");
            if (path) {
                KeyString(out, "path", AttrText(path, "path").empty() ? "circle" : AttrText(path, "path"));
            } else {
                KeyString(out, "path", "linear");
                const pugi::xml_node linear = Child(fill, "lin");
                KeyNumber(out, "angle", static_cast<double>(AttrInt(linear, "ang", 0)) / 60000.0);
            }
            Key(out, "stops");
            out += '[';
            std::vector<std::pair<double, Rgba>> stops;
            for (pugi::xml_node stop = Child(Child(fill, "gsLst"), "gs"); stop;
                 stop = stop.next_sibling()) {
                if (!Is(stop, "gs")) continue;
                stops.emplace_back(AttrPercent(stop, "pos", 0),
                                   ResolveColorIn(stop, colors_, placeholder).value_or(Rgba{}));
            }
            std::stable_sort(stops.begin(), stops.end(),
                             [](const auto& a, const auto& b) { return a.first < b.first; });
            for (const auto& stop : stops) {
                Separator(out);
                out += '{';
                KeyNumber(out, "pos", stop.first);
                KeyString(out, "color", HexOf(stop.second));
                if (stop.second.a < 1) KeyNumber(out, "alpha", stop.second.a);
                out += '}';
            }
            out += "]}";
            return true;
        }
        if (Is(fill, "pattFill")) {
            const std::optional<Rgba> foreground = ResolveColorIn(Child(fill, "fgClr"), colors_, placeholder);
            const std::optional<Rgba> background = ResolveColorIn(Child(fill, "bgClr"), colors_, placeholder);
            out += "{\"type\":\"pattern\"";
            KeyString(out, "pattern", AttrText(fill, "prst"));
            KeyString(out, "color", HexOf(foreground.value_or(Rgba{})));
            Rgba white;
            white.r = white.g = white.b = 1;
            KeyString(out, "background", HexOf(background.value_or(white)));
            out += '}';
            return true;
        }
        if (Is(fill, "blipFill")) {
            out += "{\"type\":\"picture\"";
            EmitBlip(out, fill, owner);
            out += '}';
            return true;
        }
        return false;
    }

    static void EmitSolid(std::string& out, const Rgba& color) {
        out += "{\"type\":\"solid\"";
        KeyString(out, "color", HexOf(color));
        if (color.a < 1) KeyNumber(out, "alpha", color.a);
        out += '}';
    }

    // The picture of a blipFill: "media" or "missing", "crop", "tile".
    void EmitBlip(std::string& out, pugi::xml_node blipFill, const LoadedPart& owner) {
        const pugi::xml_node blip = Child(blipFill, "blip");
        EmitMediaReference(out, blip, owner);
        const pugi::xml_node source = Child(blipFill, "srcRect");
        if (source) {
            Key(out, "crop");
            out += '[';
            Number(out, AttrPercent(source, "l", 0));
            out += ',';
            Number(out, AttrPercent(source, "t", 0));
            out += ',';
            Number(out, AttrPercent(source, "r", 0));
            out += ',';
            Number(out, AttrPercent(source, "b", 0));
            out += ']';
        }
        if (Child(blipFill, "tile")) {
            KeyBool(out, "tile", true);
        }
        double alpha = 1;
        for (pugi::xml_node effect = blip.first_child(); effect; effect = effect.next_sibling()) {
            if (Is(effect, "alphaModFix")) alpha = AttrPercent(effect, "amt", 1.0);
        }
        if (alpha < 1) KeyNumber(out, "alpha", alpha);
    }

    // "media" for a picture the reader can show, otherwise "missing".
    bool EmitMediaReference(std::string& out, pugi::xml_node blip, const LoadedPart& owner) {
        const std::string_view embed = RelAttr(blip, "embed");
        const std::string_view link = RelAttr(blip, "link");
        if (embed.empty()) {
            if (!link.empty()) {
                Count(Feature::LinkedMedia);
                KeyString(out, "missing", "linked");
            } else {
                KeyString(out, "missing", "absent");
            }
            return false;
        }
        const Relationship* relationship = owner.rels.ById(embed);
        if (relationship == nullptr || relationship->partName.empty()) {
            if (relationship != nullptr && relationship->external) {
                Count(Feature::LinkedMedia);
                KeyString(out, "missing", "linked");
            } else {
                KeyString(out, "missing", "absent");
            }
            return false;
        }
        const std::string status = MediaStatus(*deck_.types, relationship->partName);
        if (!status.empty()) {
            Count(status == "metafile" ? Feature::Metafile : Feature::UnsupportedImage);
            KeyString(out, "missing", status);
            return false;
        }
        if (deck_.servableMedia) deck_.servableMedia->insert(relationship->partName);
        KeyString(out, "media", relationship->partName);
        return true;
    }

    // Fill from a p:style reference: fillRef idx into the theme's style matrix.
    bool EmitStyleFill(std::string& out, pugi::xml_node style, const LoadedPart& owner) {
        const pugi::xml_node reference = Child(style, "fillRef");
        if (!reference) {
            return false;
        }
        const long long index = AttrInt(reference, "idx", 0);
        const std::optional<Rgba> color = ResolveColorIn(reference, colors_);
        pugi::xml_node fill;
        if (index >= 1 && index <= static_cast<long long>(theme_.fills.size())) {
            fill = theme_.fills[static_cast<std::size_t>(index - 1)];
        } else if (index >= 1001 && index - 1001 < static_cast<long long>(theme_.bgFills.size())) {
            fill = theme_.bgFills[static_cast<std::size_t>(index - 1001)];
        }
        if (!fill) {
            if (index == 0) {
                out += "{\"type\":\"none\"}";
                return true;
            }
            if (color) {
                EmitSolid(out, *color);
                return true;
            }
            return false;
        }
        return EmitFillElement(out, fill, owner, color);
    }

    // ------------------------------------------------------------- lines

    struct LineStyle {
        std::optional<long long> width;
        std::optional<std::string> fillKind;  // "none", "solid"
        std::optional<Rgba> color;
        std::optional<std::string> dash, cap;
        pugi::xml_node head, tail;
    };

    void MergeLine(LineStyle& style, pugi::xml_node ln, const std::optional<Rgba>& placeholder) {
        if (!ln) return;
        if (HasAttr(ln, "w")) style.width = AttrInt(ln, "w", 9525);
        if (HasAttr(ln, "cap")) style.cap = std::string(AttrText(ln, "cap"));
        if (Child(ln, "noFill")) {
            style.fillKind = std::string("none");
        } else if (auto color = FirstFillColor(ln, colors_, placeholder)) {
            style.fillKind = std::string("solid");
            style.color = color;
        }
        if (const pugi::xml_node dash = Child(ln, "prstDash")) style.dash = std::string(AttrText(dash, "val"));
        if (Child(ln, "custDash")) style.dash = std::string("dash");
        if (const pugi::xml_node head = Child(ln, "headEnd")) style.head = head;
        if (const pugi::xml_node tail = Child(ln, "tailEnd")) style.tail = tail;
    }

    static void EmitLineEnd(std::string& out, const char* key, pugi::xml_node end) {
        Key(out, key);
        const std::string_view type = AttrText(end, "type");
        if (!end || type.empty() || type == "none") {
            out += "null";
            return;
        }
        out += '{';
        KeyString(out, "type", type);
        KeyString(out, "w", AttrText(end, "w").empty() ? "med" : AttrText(end, "w"));
        KeyString(out, "len", AttrText(end, "len").empty() ? "med" : AttrText(end, "len"));
        out += '}';
    }

    static void EmitLine(std::string& out, const LineStyle& style) {
        if (!style.fillKind || *style.fillKind == "none" || !style.color || style.color->a <= 0) {
            out += "null";
            return;
        }
        out += '{';
        KeyNumber(out, "w", static_cast<double>(style.width.value_or(9525)));
        KeyString(out, "color", HexOf(*style.color));
        if (style.color->a < 1) KeyNumber(out, "alpha", style.color->a);
        KeyString(out, "dash", style.dash.value_or("solid"));
        KeyString(out, "cap", style.cap.value_or("flat"));
        EmitLineEnd(out, "head", style.head);
        EmitLineEnd(out, "tail", style.tail);
        out += '}';
    }

    LineStyle StyleLine(pugi::xml_node style) {
        LineStyle line;
        const pugi::xml_node reference = Child(style, "lnRef");
        if (!reference) return line;
        const long long index = AttrInt(reference, "idx", 0);
        if (index >= 1 && index <= static_cast<long long>(theme_.lines.size())) {
            MergeLine(line, theme_.lines[static_cast<std::size_t>(index - 1)],
                      ResolveColorIn(reference, colors_));
        }
        return line;
    }

    // ------------------------------------------------------------- shapes

    struct Inherited {
        const Placeholder* layout = nullptr;
        const Placeholder* master = nullptr;
        std::string type;  // effective placeholder type, "" for none
    };

    Inherited ResolvePlaceholder(pugi::xml_node shape) {
        Inherited inherited;
        std::string type;
        long long idx = -1;
        if (!PlaceholderOf(shape, type, idx)) {
            return inherited;
        }
        inherited.type = type;
        inherited.layout = FindPlaceholder(layout_.placeholders, type, idx, true);
        const std::string_view masterType =
            MasterTypeFor(inherited.layout ? inherited.layout->type : type);
        inherited.master = FindPlaceholder(master_.placeholders, masterType, -1, false);
        if (inherited.type == "obj" && inherited.layout) {
            inherited.type = inherited.layout->type;
        }
        return inherited;
    }

    static pugi::xml_node SpPr(pugi::xml_node shape) {
        pugi::xml_node node = Child(shape, "spPr");
        return node ? node : Child(shape, "grpSpPr");
    }

    void EmitTree(std::string& out, const LoadedPart& owner, pugi::xml_node tree,
                  const Transform& transform, bool skipPlaceholders) {
        ForEachChild(tree, [&](pugi::xml_node child) {
            if (failure_.Failed()) return;
            EmitNode(out, owner, child, transform, skipPlaceholders);
        });
    }

    bool CountShape() {
        if (++shapeCount_ > deck_.limits->maximumShapesPerSlide) {
            failure_.Set("too-many-shapes", "This slide has more shapes than LeanSlides draws.");
            return false;
        }
        return true;
    }

    void EmitNode(std::string& out, const LoadedPart& owner, pugi::xml_node node,
                  const Transform& transform, bool skipPlaceholders) {
        const bool isShape = Is(node, "sp") || Is(node, "cxnSp");
        const bool isPicture = Is(node, "pic");
        const bool isGroup = Is(node, "grpSp");
        const bool isFrame = Is(node, "graphicFrame");
        if (Is(node, "controls")) {
            // ActiveX controls never run; each shows the picture the file stores for it.
            ForEachChild(node, [&](pugi::xml_node control) {
                const pugi::xml_node picture = Child(control, "pic");
                if (!Is(control, "control") || !picture || !CountShape()) return;
                Count(Feature::ActiveX);
                Box local;
                ReadXfrm(Child(SpPr(picture), "xfrm"), local);
                EmitObject(out, Child(Child(picture, "nvPicPr"), "cNvPr"), transform.Apply(local),
                           FeatureCode(Feature::ActiveX), LabelFor(Feature::ActiveX).singular,
                           Child(Child(picture, "blipFill"), "blip"), &owner);
            });
            return;
        }
        if (Is(node, "contentPart")) {
            Count(Feature::Ink);
            return;
        }
        if (!isShape && !isPicture && !isGroup && !isFrame) {
            return;
        }
        std::string type;
        long long idx = -1;
        if (skipPlaceholders && PlaceholderOf(node, type, idx)) {
            return;
        }
        const pugi::xml_node nonVisual = Child(Child(node, isShape ? (Is(node, "sp") ? "nvSpPr" : "nvCxnSpPr")
                                                           : isPicture ? "nvPicPr"
                                                           : isGroup   ? "nvGrpSpPr"
                                                                       : "nvGraphicFramePr"),
                                               "cNvPr");
        if (AttrBool(nonVisual, "hidden", false)) {
            return;
        }
        if (!CountShape()) return;
        if (isGroup) {
            EmitGroup(out, owner, node, nonVisual, transform, skipPlaceholders);
        } else if (isPicture) {
            EmitPicture(out, owner, node, nonVisual, transform);
        } else if (isFrame) {
            EmitFrame(out, owner, node, nonVisual, transform);
        } else {
            EmitShape(out, owner, node, nonVisual, transform);
        }
    }

    void BeginShape(std::string& out, const char* kind, pugi::xml_node nonVisual, const Box& box) {
        Separator(out);
        out += '{';
        KeyString(out, "kind", kind);
        KeyNumber(out, "id", static_cast<double>(AttrInt(nonVisual, "id", 0)));
        KeyString(out, "name", AttrText(nonVisual, "name"));
        if (layer_ != nullptr) KeyString(out, "layer", layer_);
        EmitBox(out, box);
    }

    // The shape's box, from its own xfrm or its placeholder's.
    Box ShapeBox(pugi::xml_node shape, const Inherited& inherited, const Transform& transform) {
        Box box;
        if (!ReadXfrm(Child(SpPr(shape), "xfrm"), box) && !ReadXfrm(Child(shape, "xfrm"), box)) {
            if (!(inherited.layout && ReadXfrm(Child(SpPr(inherited.layout->shape), "xfrm"), box))) {
                if (inherited.master) ReadXfrm(Child(SpPr(inherited.master->shape), "xfrm"), box);
            }
        }
        return transform.Apply(box);
    }

    void EmitGeometry(std::string& out, pugi::xml_node spPr, const Inherited& inherited) {
        pugi::xml_node geometry;
        for (pugi::xml_node source : {spPr,
                                      inherited.layout ? SpPr(inherited.layout->shape) : pugi::xml_node(),
                                      inherited.master ? SpPr(inherited.master->shape) : pugi::xml_node()}) {
            if (!source) continue;
            if (pugi::xml_node preset = Child(source, "prstGeom")) { geometry = preset; break; }
            if (pugi::xml_node custom = Child(source, "custGeom")) { geometry = custom; break; }
        }
        Key(out, "geom");
        if (!geometry) {
            out += "{\"preset\":\"rect\"}";
            return;
        }
        if (Is(geometry, "prstGeom")) {
            out += '{';
            KeyString(out, "preset", AttrText(geometry, "prst"));
            const pugi::xml_node adjust = Child(geometry, "avLst");
            bool any = false;
            for (pugi::xml_node guide = Child(adjust, "gd"); guide; guide = guide.next_sibling()) {
                if (!Is(guide, "gd")) continue;
                const std::string_view formula = AttrText(guide, "fmla");
                if (formula.substr(0, 4) != "val ") continue;
                if (!any) {
                    Key(out, "adj");
                    out += '{';
                    any = true;
                }
                KeyNumber(out, std::string(AttrText(guide, "name")).c_str(),
                          std::strtod(std::string(formula.substr(4)).c_str(), nullptr));
            }
            if (any) out += '}';
            out += '}';
            return;
        }
        EmitCustomGeometry(out, geometry);
    }

    static void EmitPoint(std::string& out, pugi::xml_node point) {
        out += ',';
        Number(out, std::strtod(std::string(AttrText(point, "x")).c_str(), nullptr));
        out += ',';
        Number(out, std::strtod(std::string(AttrText(point, "y")).c_str(), nullptr));
    }

    void EmitCustomGeometry(std::string& out, pugi::xml_node custom) {
        out += "{\"paths\":[";
        for (pugi::xml_node path = Child(Child(custom, "pathLst"), "path"); path;
             path = path.next_sibling()) {
            if (!Is(path, "path")) continue;
            Separator(out);
            out += '{';
            KeyNumber(out, "w", static_cast<double>(AttrInt(path, "w", 0)));
            KeyNumber(out, "h", static_cast<double>(AttrInt(path, "h", 0)));
            KeyBool(out, "fill", AttrText(path, "fill") != "none");
            KeyBool(out, "stroke", AttrBool(path, "stroke", true));
            Key(out, "d");
            out += '[';
            for (pugi::xml_node command = path.first_child(); command; command = command.next_sibling()) {
                if (command.type() != pugi::node_element) continue;
                Separator(out);
                if (Is(command, "moveTo") || Is(command, "lnTo")) {
                    out += Is(command, "moveTo") ? "[\"M\"" : "[\"L\"";
                    EmitPoint(out, Child(command, "pt"));
                    out += ']';
                } else if (Is(command, "cubicBezTo") || Is(command, "quadBezTo")) {
                    out += Is(command, "cubicBezTo") ? "[\"C\"" : "[\"Q\"";
                    for (pugi::xml_node point = Child(command, "pt"); point; point = point.next_sibling()) {
                        if (Is(point, "pt")) EmitPoint(out, point);
                    }
                    out += ']';
                } else if (Is(command, "arcTo")) {
                    out += "[\"A\"";
                    for (const char* name : {"wR", "hR", "stAng", "swAng"}) {
                        out += ',';
                        double value = std::strtod(std::string(AttrText(command, name)).c_str(), nullptr);
                        if (std::strcmp(name, "stAng") == 0 || std::strcmp(name, "swAng") == 0) value /= 60000.0;
                        Number(out, value);
                    }
                    out += ']';
                } else if (Is(command, "close")) {
                    out += "[\"Z\"]";
                } else {
                    out += "[\"Z\"]";
                }
            }
            out += "]}";
        }
        out += "]}";
    }

    void EmitShapeFillAndLine(std::string& out, const LoadedPart& owner, pugi::xml_node shape,
                              const Inherited& inherited) {
        const pugi::xml_node spPr = SpPr(shape);
        const pugi::xml_node style = Child(shape, "style");
        Key(out, "fill");
        bool filled = EmitFillIn(out, spPr, owner);
        if (!filled && inherited.layout) filled = EmitFillIn(out, SpPr(inherited.layout->shape), *layout_.part);
        if (!filled && inherited.master) filled = EmitFillIn(out, SpPr(inherited.master->shape), *master_.part);
        if (!filled) filled = EmitStyleFill(out, style, owner);
        if (!filled && inherited.layout) filled = EmitStyleFill(out, Child(inherited.layout->shape, "style"), owner);
        if (!filled) out += "{\"type\":\"none\"}";

        LineStyle line = StyleLine(style);
        if (inherited.master) MergeLine(line, Child(SpPr(inherited.master->shape), "ln"), std::nullopt);
        if (inherited.layout) MergeLine(line, Child(SpPr(inherited.layout->shape), "ln"), std::nullopt);
        MergeLine(line, Child(spPr, "ln"), std::nullopt);
        Key(out, "line");
        EmitLine(out, line);
    }

    void EmitShape(std::string& out, const LoadedPart& owner, pugi::xml_node shape,
                   pugi::xml_node nonVisual, const Transform& transform) {
        const Inherited inherited = ResolvePlaceholder(shape);
        const Box box = ShapeBox(shape, inherited, transform);
        BeginShape(out, "shape", nonVisual, box);
        if (!inherited.type.empty()) KeyString(out, "ph", inherited.type);
        EmitGeometry(out, SpPr(shape), inherited);
        EmitShapeFillAndLine(out, owner, shape, inherited);
        const pugi::xml_node body = Child(shape, "txBody");
        if (body) {
            Key(out, "text");
            EmitTextBody(out, owner, body, inherited, Child(shape, "style"), {});
        }
        out += '}';
    }

    void EmitGroup(std::string& out, const LoadedPart& owner, pugi::xml_node group,
                   pugi::xml_node nonVisual, const Transform& transform, bool skipPlaceholders) {
        const pugi::xml_node grpSpPr = Child(group, "grpSpPr");
        const pugi::xml_node xfrm = Child(grpSpPr, "xfrm");
        Box local;
        ReadXfrm(xfrm, local);
        const Box box = transform.Apply(local);
        Transform inner;
        inner.ox = box.x;
        inner.oy = box.y;
        const pugi::xml_node childOffset = Child(xfrm, "chOff");
        const pugi::xml_node childExtent = Child(xfrm, "chExt");
        inner.cx = static_cast<double>(AttrInt(childOffset, "x", 0));
        inner.cy = static_cast<double>(AttrInt(childOffset, "y", 0));
        const double childWidth = static_cast<double>(AttrInt(childExtent, "cx", 0));
        const double childHeight = static_cast<double>(AttrInt(childExtent, "cy", 0));
        inner.sx = childWidth > 0 ? box.w / childWidth : transform.sx;
        inner.sy = childHeight > 0 ? box.h / childHeight : transform.sy;
        BeginShape(out, "group", nonVisual, box);
        const std::string savedGroupFill = groupFill_;
        std::string fill;
        if (EmitFillIn(fill, grpSpPr, owner)) groupFill_ = fill;
        Key(out, "children");
        out += '[';
        EmitTree(out, owner, group, inner, skipPlaceholders);
        out += "]}";
        groupFill_ = savedGroupFill;
    }

    void EmitPicture(std::string& out, const LoadedPart& owner, pugi::xml_node picture,
                     pugi::xml_node nonVisual, const Transform& transform) {
        const Inherited inherited = ResolvePlaceholder(picture);
        const Box box = ShapeBox(picture, inherited, transform);
        const pugi::xml_node nvPr = Child(Child(picture, "nvPicPr"), "nvPr");
        const char* media = nullptr;
        if (Child(nvPr, "videoFile") || Child(nvPr, "quickTimeFile")) media = "video";
        if (Child(nvPr, "audioFile") || Child(nvPr, "wavAudioFile") || Child(nvPr, "audioCd")) media = "audio";
        if (!media) {
            for (pugi::xml_node extension = Child(Child(nvPr, "extLst"), "ext"); extension;
                 extension = extension.next_sibling()) {
                if (Child(extension, "media")) {
                    media = "video";
                    for (const Relationship& relationship : owner.rels.items) {
                        if (relationship.tail == "audio") media = "audio";
                    }
                }
            }
        }
        const pugi::xml_node blipFill = Child(picture, "blipFill");
        if (media) {
            Count(std::strcmp(media, "audio") == 0 ? Feature::Audio : Feature::Video);
            BeginShape(out, "object", nonVisual, box);
            KeyString(out, "feature", media);
            KeyString(out, "label", std::strcmp(media, "audio") == 0 ? "Sound" : "Video");
            EmitMediaReference(out, Child(blipFill, "blip"), owner);
            out += '}';
            return;
        }
        BeginShape(out, "picture", nonVisual, box);
        if (!inherited.type.empty()) KeyString(out, "ph", inherited.type);
        EmitBlip(out, blipFill, owner);
        EmitGeometry(out, SpPr(picture), inherited);
        EmitShapeFillAndLine(out, owner, picture, inherited);
        out += '}';
    }

    // ------------------------------------------------------- graphic frames

    void EmitFrame(std::string& out, const LoadedPart& owner, pugi::xml_node frame,
                   pugi::xml_node nonVisual, const Transform& transform) {
        Box local;
        ReadXfrm(Child(frame, "xfrm"), local);
        const Box box = transform.Apply(local);
        const pugi::xml_node data = Child(Child(frame, "graphic"), "graphicData");
        const std::string_view uri = AttrText(data, "uri");
        if (const pugi::xml_node table = Child(data, "tbl")) {
            EmitTable(out, owner, table, nonVisual, box);
            return;
        }
        if (uri.find("/diagram") != std::string_view::npos) {
            if (EmitDiagramDrawing(out, owner, data, nonVisual, box)) return;
            Count(Feature::SmartArt);
            EmitObject(out, nonVisual, box, "smartart", "SmartArt", {});
            return;
        }
        if (uri.find("/chart") != std::string_view::npos) {
            Count(Feature::Chart);
            EmitObject(out, nonVisual, box, "chart", "Chart", {});
            return;
        }
        if (uri.find("/ole") != std::string_view::npos) {
            Count(Feature::OleObject);
            pugi::xml_node object = Child(data, "oleObj");
            pugi::xml_node blip = Child(Child(Child(object, "pic"), "blipFill"), "blip");
            if (AttrBool(object, "showAsIcon", false) || AttrText(object, "progId").empty()) {
                // keep the stored picture either way
            }
            EmitObject(out, nonVisual, box, "ole-object", "Embedded object", blip, &owner);
            return;
        }
        if (uri.find("model3d") != std::string_view::npos) {
            Count(Feature::Model3D);
            EmitObject(out, nonVisual, box, "model-3d", "3D model", {});
            return;
        }
        EmitObject(out, nonVisual, box, "ole-object", "Object", {});
    }

    void EmitObject(std::string& out, pugi::xml_node nonVisual, const Box& box, const char* feature,
                    const char* label, pugi::xml_node blip, const LoadedPart* owner = nullptr) {
        BeginShape(out, "object", nonVisual, box);
        KeyString(out, "feature", feature);
        KeyString(out, "label", label);
        if (blip && owner) {
            EmitMediaReference(out, blip, *owner);
        }
        out += '}';
    }

    // SmartArt whose file stores its drawing: the stored shapes, as a group.
    bool EmitDiagramDrawing(std::string& out, const LoadedPart& owner, pugi::xml_node data,
                            pugi::xml_node nonVisual, const Box& box) {
        const pugi::xml_node ids = Child(data, "relIds");
        const Relationship* model = owner.rels.ById(RelAttr(ids, "dm"));
        if (model == nullptr || model->partName.empty()) return false;
        LoadedPart modelPart;
        if (!LoadPart(model->partName, modelPart, false)) return false;
        std::string drawingId;
        FindDrawingId(modelPart.root, drawingId);
        const Relationship* drawing = drawingId.empty() ? nullptr : owner.rels.ById(drawingId);
        if (drawing == nullptr || drawing->partName.empty()) {
            // Some files name the drawing only by relationship type.
            for (const Relationship& relationship : owner.rels.items) {
                if (relationship.tail == "diagramdrawing" && !relationship.partName.empty() &&
                    owner.rels.items.size() > 0 && drawing == nullptr) {
                    drawing = &relationship;
                }
            }
        }
        if (drawing == nullptr) return false;
        auto drawingPart = std::make_unique<LoadedPart>();
        if (!LoadPart(drawing->partName, *drawingPart, true)) return false;
        const pugi::xml_node tree = Child(drawingPart->root, "spTree");
        if (!tree) return false;
        BeginShape(out, "group", nonVisual, box);
        KeyBool(out, "diagram", true);
        Key(out, "children");
        out += '[';
        Transform inner;
        inner.ox = box.x;
        inner.oy = box.y;
        EmitTree(out, *drawingPart, tree, inner, false);
        out += "]}";
        keptParts_.push_back(std::move(drawingPart));
        return true;
    }

    static void FindDrawingId(pugi::xml_node node, std::string& id) {
        for (pugi::xml_node child = node.first_child(); child && id.empty(); child = child.next_sibling()) {
            if (child.type() != pugi::node_element) continue;
            if (Is(child, "dataModelExt")) {
                id = std::string(AttrText(child, "relId"));
                return;
            }
            FindDrawingId(child, id);
        }
    }

    bool LoadPart(const std::string& name, LoadedPart& part, bool withRelationships) {
        const ZipEntry* entry = deck_.zip->Find(name);
        if (entry == nullptr) return false;
        Failure local;
        if (!ReadXml(*deck_.zip, *entry, *deck_.limits, part.xml, local)) return false;
        part.name = name;
        part.root = part.xml.document.document_element();
        if (withRelationships && !ReadRelationships(*deck_.zip, *deck_.limits, name, part.rels, local)) {
            return false;
        }
        return true;
    }

    // ------------------------------------------------------------ tables

    struct CellStyle {
        std::string fill;             // JSON fill, empty for none set
        pugi::xml_node borders[4];    // l, r, t, b: a:ln nodes
        pugi::xml_node textStyle;     // tcTxStyle
    };

    pugi::xml_node FindTableStyle(pugi::xml_node table) {
        const pugi::xml_node properties = Child(table, "tblPr");
        std::string id;
        if (const pugi::xml_node styleId = Child(properties, "tableStyleId")) id = styleId.child_value();
        if (id.empty()) id = std::string(AttrText(deck_.tableStyles, "def"));
        for (pugi::xml_node style = Child(deck_.tableStyles, "tblStyle"); style; style = style.next_sibling()) {
            if (Is(style, "tblStyle") && AttrText(style, "styleId") == id) return style;
        }
        return {};
    }

    void ApplyTableStylePart(CellStyle& cell, pugi::xml_node part, bool left, bool right, bool top,
                             bool bottom, const LoadedPart& owner) {
        if (!part) return;
        const pugi::xml_node cellStyle = Child(part, "tcStyle");
        if (const pugi::xml_node fill = Child(cellStyle, "fill")) {
            std::string json;
            if (EmitFillIn(json, fill, owner)) cell.fill = json;
        } else if (const pugi::xml_node reference = Child(cellStyle, "fillRef")) {
            pugi::xml_node style = cellStyle;
            std::string json;
            (void)style;
            const std::optional<Rgba> color = ResolveColorIn(reference, colors_);
            if (color) {
                EmitSolid(json, *color);
                cell.fill = json;
            }
        }
        const pugi::xml_node borders = Child(cellStyle, "tcBdr");
        const auto line = [&](const char* name) { return Child(Child(borders, name), "ln"); };
        if (pugi::xml_node node = line("left"); node && left) cell.borders[0] = node;
        if (pugi::xml_node node = line("right"); node && right) cell.borders[1] = node;
        if (pugi::xml_node node = line("top"); node && top) cell.borders[2] = node;
        if (pugi::xml_node node = line("bottom"); node && bottom) cell.borders[3] = node;
        if (pugi::xml_node node = line("insideV")) {
            if (!left) cell.borders[0] = node;
            if (!right) cell.borders[1] = node;
        }
        if (pugi::xml_node node = line("insideH")) {
            if (!top) cell.borders[2] = node;
            if (!bottom) cell.borders[3] = node;
        }
        if (const pugi::xml_node text = Child(part, "tcTxStyle")) cell.textStyle = text;
    }

    void EmitTable(std::string& out, const LoadedPart& owner, pugi::xml_node table,
                   pugi::xml_node nonVisual, const Box& frame) {
        std::vector<pugi::xml_node> rows;
        double rowsHeight = 0;
        for (pugi::xml_node row = Child(table, "tr"); row; row = row.next_sibling()) {
            if (!Is(row, "tr")) continue;
            rows.push_back(row);
            rowsHeight += static_cast<double>(std::max<long long>(0, AttrInt(row, "h", 0)));
        }
        // PowerPoint sizes a table by its rows, not by the saved frame.
        Box box = frame;
        if (rowsHeight > 0) box.h = rowsHeight;
        BeginShape(out, "table", nonVisual, box);
        const pugi::xml_node properties = Child(table, "tblPr");
        const bool firstRow = AttrBool(properties, "firstRow", false);
        const bool lastRow = AttrBool(properties, "lastRow", false);
        const bool firstCol = AttrBool(properties, "firstCol", false);
        const bool lastCol = AttrBool(properties, "lastCol", false);
        const bool bandRow = AttrBool(properties, "bandRow", false);
        const bool bandCol = AttrBool(properties, "bandCol", false);
        const pugi::xml_node style = FindTableStyle(table);

        std::vector<double> widths;
        Key(out, "cols");
        out += '[';
        for (pugi::xml_node column = Child(Child(table, "tblGrid"), "gridCol"); column;
             column = column.next_sibling()) {
            if (!Is(column, "gridCol")) continue;
            Separator(out);
            widths.push_back(static_cast<double>(AttrInt(column, "w", 0)));
            Number(out, widths.back());
        }
        out += ']';
        Key(out, "rows");
        out += '[';
        for (std::size_t r = 0; r < rows.size(); ++r) {
            Separator(out);
            out += '{';
            KeyNumber(out, "h", static_cast<double>(AttrInt(rows[r], "h", 0)));
            Key(out, "cells");
            out += '[';
            std::size_t c = 0;
            for (pugi::xml_node cell = Child(rows[r], "tc"); cell; cell = cell.next_sibling()) {
                if (!Is(cell, "tc")) continue;
                Separator(out);
                if (AttrBool(cell, "hMerge", false) || AttrBool(cell, "vMerge", false)) {
                    out += "{\"merged\":true}";
                    ++c;
                    continue;
                }
                const long long span = std::max<long long>(1, AttrInt(cell, "gridSpan", 1));
                const long long rowSpan = std::max<long long>(1, AttrInt(cell, "rowSpan", 1));
                const bool isFirstRow = r == 0, isLastRow = r + static_cast<std::size_t>(rowSpan) >= rows.size();
                const bool isFirstCol = c == 0;
                const bool isLastCol = c + static_cast<std::size_t>(span) >= widths.size();
                CellStyle cellStyle;
                if (style) {
                    ApplyTableStylePart(cellStyle, Child(style, "wholeTbl"), isFirstCol, isLastCol, isFirstRow, isLastRow, owner);
                    const std::size_t bandIndex = r - (firstRow ? 1 : 0);
                    if (bandRow && !(firstRow && isFirstRow) && !(lastRow && isLastRow) && r >= (firstRow ? 1u : 0u)) {
                        ApplyTableStylePart(cellStyle, Child(style, bandIndex % 2 == 0 ? "band1H" : "band2H"),
                                            isFirstCol, isLastCol, false, false, owner);
                    }
                    if (bandCol) {
                        const std::size_t colBand = c - (firstCol ? 1 : 0);
                        if (!(firstCol && isFirstCol)) {
                            ApplyTableStylePart(cellStyle, Child(style, colBand % 2 == 0 ? "band1V" : "band2V"),
                                                false, false, isFirstRow, isLastRow, owner);
                        }
                    }
                    if (lastCol && isLastCol) ApplyTableStylePart(cellStyle, Child(style, "lastCol"), false, true, isFirstRow, isLastRow, owner);
                    if (firstCol && isFirstCol) ApplyTableStylePart(cellStyle, Child(style, "firstCol"), true, false, isFirstRow, isLastRow, owner);
                    if (lastRow && isLastRow) ApplyTableStylePart(cellStyle, Child(style, "lastRow"), isFirstCol, isLastCol, false, true, owner);
                    if (firstRow && isFirstRow) ApplyTableStylePart(cellStyle, Child(style, "firstRow"), isFirstCol, isLastCol, true, false, owner);
                }
                EmitCell(out, owner, cell, cellStyle, span, rowSpan);
                c += static_cast<std::size_t>(span);
            }
            out += "]}";
        }
        out += "]}";
    }

    void EmitCell(std::string& out, const LoadedPart& owner, pugi::xml_node cell,
                  const CellStyle& style, long long span, long long rowSpan) {
        const pugi::xml_node properties = Child(cell, "tcPr");
        out += '{';
        if (span > 1) KeyNumber(out, "span", static_cast<double>(span));
        if (rowSpan > 1) KeyNumber(out, "rowSpan", static_cast<double>(rowSpan));
        Key(out, "fill");
        std::string fill;
        if (EmitFillIn(fill, properties, owner)) {
            out += fill;
        } else if (!style.fill.empty()) {
            out += style.fill;
        } else {
            out += "{\"type\":\"none\"}";
        }
        Key(out, "borders");
        out += '{';
        const char* names[4] = {"l", "r", "t", "b"};
        const char* own[4] = {"lnL", "lnR", "lnT", "lnB"};
        for (int side = 0; side < 4; ++side) {
            LineStyle line;
            MergeLine(line, style.borders[side], std::nullopt);
            MergeLine(line, Child(properties, own[side]), std::nullopt);
            Key(out, names[side]);
            EmitLine(out, line);
        }
        out += '}';
        Key(out, "margins");
        out += '[';
        Number(out, static_cast<double>(AttrInt(properties, "marL", 91440)));
        out += ',';
        Number(out, static_cast<double>(AttrInt(properties, "marT", 45720)));
        out += ',';
        Number(out, static_cast<double>(AttrInt(properties, "marR", 91440)));
        out += ',';
        Number(out, static_cast<double>(AttrInt(properties, "marB", 45720)));
        out += ']';
        KeyString(out, "anchor", AttrText(properties, "anchor").empty() ? "t" : AttrText(properties, "anchor"));
        const pugi::xml_node body = Child(cell, "txBody");
        Key(out, "text");
        EmitTextBody(out, owner, body, Inherited{}, {}, style.textStyle, true);
        out += '}';
    }

    // -------------------------------------------------------------- text

    pugi::xml_node MasterTextStyle(const std::string& type) {
        if (type.empty()) return {};
        const std::string_view family = MasterTypeFor(type);
        if (family == "title") return master_.titleStyle;
        if (family == "body") return master_.bodyStyle;
        return master_.otherStyle;
    }

    std::string ResolveFont(const std::string& face, char script) const {
        if (face.size() < 4 || face[0] != '+') return face;
        const bool major = face.compare(1, 2, "mj") == 0;
        const std::string tail = face.substr(4);
        const auto pick = [&](const std::string& latin, const std::string& ea, const std::string& cs) {
            if (tail == "ea") return ea;
            if (tail == "cs") return cs;
            return latin;
        };
        (void)script;
        return major ? pick(theme_.majorLatin, theme_.majorEa, theme_.majorCs)
                     : pick(theme_.minorLatin, theme_.minorEa, theme_.minorCs);
    }

    ParaStyle LevelStyle(const std::vector<StyleSource>& chain, int level) {
        ParaStyle style;
        char name[16];
        std::snprintf(name, sizeof(name), "lvl%dpPr", level + 1);
        for (const StyleSource& source : chain) {
            if (source.list) {
                ApplyParagraphProperties(style, Child(source.list, "defPPr"), colors_);
                ApplyParagraphProperties(style, Child(source.list, name), colors_);
            } else if (source.fontRef) {
                const std::string_view index = AttrText(source.fontRef, "idx");
                if (index == "major") style.run.latin = std::string("+mj-lt");
                if (index == "minor") style.run.latin = std::string("+mn-lt");
                if (auto color = ResolveColorIn(source.fontRef, colors_)) style.run.color = color;
            } else if (source.textStyle) {
                if (HasAttr(source.textStyle, "b")) style.run.bold = AttrText(source.textStyle, "b") == "on";
                if (HasAttr(source.textStyle, "i")) style.run.italic = AttrText(source.textStyle, "i") == "on";
                if (auto color = ResolveColorIn(source.textStyle, colors_)) style.run.color = color;
                if (const pugi::xml_node reference = Child(source.textStyle, "fontRef")) {
                    if (auto color = ResolveColorIn(reference, colors_)) style.run.color = color;
                }
            }
        }
        return style;
    }

    void EmitBodyProperties(std::string& out, const std::vector<pugi::xml_node>& bodies, bool tableCell) {
        std::string anchor = "t";
        bool anchorCenter = false;
        long long insets[4] = {91440, 45720, 91440, 45720};
        bool wrap = true;
        std::string vertical = "horz";
        std::string autofit = "none";
        double fontScale = 1;
        double lineReduction = 0;
        long long columns = 1;
        double rotation = 0;
        for (pugi::xml_node body : bodies) {
            if (!body) continue;
            if (HasAttr(body, "anchor")) anchor = std::string(AttrText(body, "anchor"));
            if (HasAttr(body, "anchorCtr")) anchorCenter = AttrBool(body, "anchorCtr", false);
            if (HasAttr(body, "lIns")) insets[0] = AttrInt(body, "lIns", insets[0]);
            if (HasAttr(body, "tIns")) insets[1] = AttrInt(body, "tIns", insets[1]);
            if (HasAttr(body, "rIns")) insets[2] = AttrInt(body, "rIns", insets[2]);
            if (HasAttr(body, "bIns")) insets[3] = AttrInt(body, "bIns", insets[3]);
            if (HasAttr(body, "wrap")) wrap = AttrText(body, "wrap") != "none";
            if (HasAttr(body, "vert")) vertical = std::string(AttrText(body, "vert"));
            if (HasAttr(body, "numCol")) columns = AttrInt(body, "numCol", 1);
            if (HasAttr(body, "rot")) rotation = static_cast<double>(AttrInt(body, "rot", 0)) / 60000.0;
            if (Child(body, "noAutofit")) {
                autofit = "none";
                fontScale = 1;
                lineReduction = 0;
            } else if (const pugi::xml_node normal = Child(body, "normAutofit")) {
                autofit = "normal";
                fontScale = AttrPercent(normal, "fontScale", 1.0);
                lineReduction = AttrPercent(normal, "lnSpcReduction", 0);
            } else if (Child(body, "spAutoFit")) {
                autofit = "shape";
                fontScale = 1;
                lineReduction = 0;
            }
        }
        if (!tableCell) {
            KeyString(out, "anchor", anchor);
            if (anchorCenter) KeyBool(out, "anchorCenter", true);
            Key(out, "insets");
            out += '[';
            for (int index = 0; index < 4; ++index) {
                if (index) out += ',';
                Number(out, static_cast<double>(insets[index]));
            }
            out += ']';
        }
        KeyBool(out, "wrap", wrap);
        KeyString(out, "vert", vertical);
        KeyString(out, "autofit", autofit);
        if (fontScale != 1) KeyNumber(out, "fontScale", fontScale);
        if (lineReduction != 0) KeyNumber(out, "lineReduction", lineReduction);
        if (columns > 1) KeyNumber(out, "columns", static_cast<double>(columns));
        if (rotation != 0) KeyNumber(out, "rot", rotation);
    }

    static std::string Roman(long long number, bool upper) {
        static const struct { int value; const char* text; } kTable[] = {
            {1000, "m"}, {900, "cm"}, {500, "d"}, {400, "cd"}, {100, "c"}, {90, "xc"},
            {50, "l"}, {40, "xl"}, {10, "x"}, {9, "ix"}, {5, "v"}, {4, "iv"}, {1, "i"}};
        std::string text;
        number = std::max<long long>(1, std::min<long long>(number, 3999));
        for (const auto& entry : kTable) {
            while (number >= entry.value) {
                text += entry.text;
                number -= entry.value;
            }
        }
        if (upper) {
            for (char& character : text) character = static_cast<char>(character - 'a' + 'A');
        }
        return text;
    }

    static std::string Alpha(long long number, bool upper) {
        std::string text;
        number = std::max<long long>(1, number);
        const long long repeat = (number - 1) / 26 + 1;
        const char letter = static_cast<char>((upper ? 'A' : 'a') + (number - 1) % 26);
        text.assign(static_cast<std::size_t>(std::min<long long>(repeat, 10)), letter);
        return text;
    }

    static std::string AutoNumberText(const std::string& scheme, long long number) {
        std::string core;
        if (scheme.rfind("romanUc", 0) == 0) core = Roman(number, true);
        else if (scheme.rfind("romanLc", 0) == 0) core = Roman(number, false);
        else if (scheme.rfind("alphaUc", 0) == 0) core = Alpha(number, true);
        else if (scheme.rfind("alphaLc", 0) == 0) core = Alpha(number, false);
        else core = std::to_string(number);
        if (scheme.size() >= 9 && scheme.compare(scheme.size() - 9, 9, "ParenBoth") == 0) return "(" + core + ")";
        if (scheme.size() >= 6 && scheme.compare(scheme.size() - 6, 6, "ParenR") == 0) return core + ")";
        if (scheme.size() >= 6 && scheme.compare(scheme.size() - 6, 6, "Period") == 0) return core + ".";
        if (scheme.size() >= 5 && scheme.compare(scheme.size() - 5, 5, "Minus") == 0) return core + "-";
        return core;
    }

    static void EmitSpacing(std::string& out, const char* key, const std::optional<Spacing>& spacing) {
        if (!spacing) return;
        Key(out, key);
        out += spacing->percent ? "{\"pct\":" : "{\"pt\":";
        Number(out, spacing->value);
        out += '}';
    }

    void EmitRunStyle(std::string& out, const RunStyle& style, const std::optional<std::string>& link) {
        KeyNumber(out, "size", style.size.value_or(18));
        const std::string latin = ResolveFont(style.latin.value_or("+mn-lt"), 'l');
        if (!latin.empty()) KeyString(out, "font", latin);
        const std::string ea = ResolveFont(style.ea.value_or("+mn-ea"), 'e');
        if (!ea.empty() && ea != latin) KeyString(out, "ea", ea);
        const std::string cs = ResolveFont(style.cs.value_or("+mn-cs"), 'c');
        if (!cs.empty() && cs != latin) KeyString(out, "cs", cs);
        const Rgba color = style.color.value_or(Rgba{});
        KeyString(out, "color", HexOf(color));
        if (color.a < 1) KeyNumber(out, "alpha", color.a);
        if (style.bold.value_or(false)) KeyBool(out, "b", true);
        if (style.italic.value_or(false)) KeyBool(out, "i", true);
        if (style.underline && *style.underline != "none") KeyString(out, "u", *style.underline);
        if (style.strike && *style.strike != "noStrike") KeyBool(out, "strike", true);
        if (style.baseline && *style.baseline != 0) KeyNumber(out, "baseline", *style.baseline);
        if (style.cap && *style.cap != "none") KeyString(out, "caps", *style.cap);
        if (style.spacing && *style.spacing != 0) KeyNumber(out, "spacing", *style.spacing);
        if (style.highlight) KeyString(out, "highlight", HexOf(*style.highlight));
        if (link) KeyString(out, "link", *link);
    }

    std::optional<std::string> LinkOf(pugi::xml_node rPr, const LoadedPart& owner) {
        const pugi::xml_node click = Child(rPr, "hlinkClick");
        const std::string_view id = RelAttr(click, "id");
        if (id.empty()) return std::nullopt;
        const Relationship* relationship = owner.rels.ById(id);
        if (relationship == nullptr || !relationship->external) return std::nullopt;
        const std::string target = LowercaseAscii(relationship->target.substr(0, 8));
        if (target.rfind("http://", 0) == 0 || target.rfind("https://", 0) == 0 ||
            target.rfind("mailto:", 0) == 0) {
            return relationship->target;
        }
        return std::nullopt;
    }

    void EmitTextBody(std::string& out, const LoadedPart& owner, pugi::xml_node body,
                      const Inherited& inherited, pugi::xml_node shapeStyle,
                      pugi::xml_node tableTextStyle, bool tableCell = false) {
        out += '{';
        std::vector<pugi::xml_node> bodies;
        if (inherited.master) bodies.push_back(Child(Child(inherited.master->shape, "txBody"), "bodyPr"));
        if (inherited.layout) bodies.push_back(Child(Child(inherited.layout->shape, "txBody"), "bodyPr"));
        bodies.push_back(Child(body, "bodyPr"));
        EmitBodyProperties(out, bodies, tableCell);

        std::vector<StyleSource> chain;
        chain.push_back({deck_.defaultTextStyle, {}, {}});
        chain.push_back({MasterTextStyle(inherited.type), {}, {}});
        if (inherited.master) chain.push_back({Child(Child(inherited.master->shape, "txBody"), "lstStyle"), {}, {}});
        if (inherited.layout) chain.push_back({Child(Child(inherited.layout->shape, "txBody"), "lstStyle"), {}, {}});
        if (const pugi::xml_node fontRef = Child(shapeStyle, "fontRef")) chain.push_back({{}, fontRef, {}});
        if (tableTextStyle) chain.push_back({{}, {}, tableTextStyle});
        chain.push_back({Child(body, "lstStyle"), {}, {}});

        ParaStyle levels[9];
        bool built[9] = {};
        long long counters[9] = {};
        std::string schemes[9];

        Key(out, "paragraphs");
        out += '[';
        for (pugi::xml_node paragraph = body.first_child(); paragraph; paragraph = paragraph.next_sibling()) {
            if (!Is(paragraph, "p")) continue;
            const pugi::xml_node pPr = Child(paragraph, "pPr");
            const int level = static_cast<int>(std::min<long long>(8, std::max<long long>(0, AttrInt(pPr, "lvl", 0))));
            if (!built[level]) {
                levels[level] = LevelStyle(chain, level);
                built[level] = true;
            }
            ParaStyle style = levels[level];
            ApplyParagraphProperties(style, pPr, colors_);

            bool hasText = false;
            for (pugi::xml_node run = paragraph.first_child(); run; run = run.next_sibling()) {
                if ((Is(run, "r") || Is(run, "fld")) && Child(run, "t").child_value()[0] != '\0') hasText = true;
            }

            Separator(out);
            out += '{';
            KeyString(out, "align", style.align.value_or(style.rtl.value_or(false) ? "r" : "l"));
            if (level) KeyNumber(out, "level", level);
            KeyNumber(out, "marL", static_cast<double>(style.marL.value_or(0)));
            KeyNumber(out, "indent", static_cast<double>(style.indent.value_or(0)));
            if (style.rtl.value_or(false)) KeyBool(out, "rtl", true);
            EmitSpacing(out, "lineSpacing", style.lineSpacing);
            EmitSpacing(out, "spaceBefore", style.spaceBefore);
            EmitSpacing(out, "spaceAfter", style.spaceAfter);

            // Numbering restarts after a shallower paragraph or another scheme.
            for (int deeper = level + 1; deeper < 9; ++deeper) counters[deeper] = 0;
            const std::string bulletType = style.bulletType.value_or("none");
            Key(out, "bullet");
            if (!hasText || bulletType == "none") {
                if (hasText && bulletType == "none") counters[level] = 0;
                out += "null";
            } else {
                RunStyle firstRun = style.run;
                for (pugi::xml_node run = paragraph.first_child(); run; run = run.next_sibling()) {
                    if (Is(run, "r") || Is(run, "fld")) {
                        ApplyRunProperties(firstRun, Child(run, "rPr"), colors_);
                        break;
                    }
                }
                out += '{';
                if (bulletType == "num") {
                    const std::string scheme = style.bulletScheme.value_or("arabicPeriod");
                    if (schemes[level] != scheme || counters[level] == 0) {
                        counters[level] = style.bulletStart.value_or(1);
                        schemes[level] = scheme;
                    } else {
                        ++counters[level];
                    }
                    KeyString(out, "text", AutoNumberText(scheme, counters[level]));
                } else if (bulletType == "pic" && style.bulletMedia) {
                    const Relationship* relationship = owner.rels.ById(*style.bulletMedia);
                    if (relationship && !relationship->partName.empty() &&
                        MediaStatus(*deck_.types, relationship->partName).empty()) {
                        if (deck_.servableMedia) deck_.servableMedia->insert(relationship->partName);
                        KeyString(out, "media", relationship->partName);
                    } else {
                        KeyString(out, "char", "\xE2\x80\xA2");
                    }
                } else {
                    KeyString(out, "char", style.bulletChar.value_or("\xE2\x80\xA2"));
                }
                if (bulletType != "num") counters[level] = 0;
                std::string font = style.bulletFontFollowsText.value_or(true) || !style.bulletFont
                                       ? ResolveFont(firstRun.latin.value_or("+mn-lt"), 'l')
                                       : ResolveFont(*style.bulletFont, 'l');
                KeyString(out, "font", font);
                const Rgba color = (!style.bulletColorFollowsText.value_or(true) && style.bulletColor)
                                       ? *style.bulletColor
                                       : firstRun.color.value_or(Rgba{});
                KeyString(out, "color", HexOf(color));
                double size = 1;
                if (style.bulletSizePercent) size = *style.bulletSizePercent;
                if (style.bulletSizePoints && firstRun.size.value_or(18) > 0) {
                    size = *style.bulletSizePoints / firstRun.size.value_or(18);
                }
                KeyNumber(out, "size", size);
                out += '}';
            }

            Key(out, "runs");
            out += '[';
            for (pugi::xml_node run = paragraph.first_child(); run; run = run.next_sibling()) {
                const bool isRun = Is(run, "r");
                const bool isField = Is(run, "fld");
                const bool isBreak = Is(run, "br");
                if (!isRun && !isField && !isBreak) continue;
                RunStyle runStyle = style.run;
                const pugi::xml_node rPr = Child(run, "rPr");
                ApplyRunProperties(runStyle, rPr, colors_);
                Separator(out);
                out += '{';
                if (isBreak) {
                    KeyBool(out, "br", true);
                    KeyNumber(out, "size", runStyle.size.value_or(18));
                    out += '}';
                    continue;
                }
                std::string text = Child(run, "t").child_value();
                if (isField && AttrText(run, "type") == "slidenum") {
                    text = std::to_string(deck_.firstSlideNumber + static_cast<long long>(index_));
                }
                KeyString(out, "t", text);
                if (isField && !AttrText(run, "type").empty()) KeyString(out, "field", AttrText(run, "type"));
                const std::optional<std::string> link = LinkOf(rPr, owner);
                if (link && !runStyle.color) {
                    // Hyperlinks take the theme's link colour unless the run sets one.
                }
                if (link && !(rPr && FirstFillColor(rPr, colors_))) {
                    const auto found = colors_.theme.find("hlink");
                    if (found != colors_.theme.end()) runStyle.color = found->second;
                    if (!runStyle.underline) runStyle.underline = std::string("sng");
                }
                EmitRunStyle(out, runStyle, link);
                out += '}';
            }
            out += ']';
            RunStyle endStyle = style.run;
            ApplyRunProperties(endStyle, Child(paragraph, "endParaRPr"), colors_);
            KeyNumber(out, "endSize", endStyle.size.value_or(18));
            out += '}';
        }
        out += "]}";
    }

    // -------------------------------------------------------- background

    void EmitBackground(std::string& out) {
        for (const LoadedPart* part : {&slide_, layout_.part, master_.part}) {
            const pugi::xml_node background = Child(Child(part->root, "cSld"), "bg");
            if (!background) continue;
            if (const pugi::xml_node properties = Child(background, "bgPr")) {
                if (EmitFillIn(out, properties, *part)) return;
            }
            if (const pugi::xml_node reference = Child(background, "bgRef")) {
                pugi::xml_node style = background;
                std::string json;
                const long long index = AttrInt(reference, "idx", 0);
                const std::optional<Rgba> color = ResolveColorIn(reference, colors_);
                pugi::xml_node fill;
                if (index >= 1001 && index - 1001 < static_cast<long long>(theme_.bgFills.size())) {
                    fill = theme_.bgFills[static_cast<std::size_t>(index - 1001)];
                } else if (index >= 1 && index <= static_cast<long long>(theme_.fills.size())) {
                    fill = theme_.fills[static_cast<std::size_t>(index - 1)];
                }
                (void)style;
                if (fill && EmitFillElement(out, fill, *part, color)) return;
                if (color) {
                    EmitSolid(out, *color);
                    return;
                }
            }
        }
        Rgba white;
        white.r = white.g = white.b = 1;
        const auto found = colors_.theme.find(colors_.map.count("bg1") ? colors_.map.at("bg1") : "lt1");
        EmitSolid(out, found != colors_.theme.end() ? found->second : white);
    }

    const DeckContext& deck_;
    const LoadedPart& slide_;
    const Layout& layout_;
    const Master& master_;
    const Theme& theme_;
    std::size_t index_;
    Failure& failure_;
    ColorContext colors_;
    std::string groupFill_;
    const char* layer_ = nullptr;  // "master" or "layout" while emitting their shapes
    std::uint32_t shapeCount_ = 0;
    std::vector<std::unique_ptr<LoadedPart>> keptParts_;
};

}  // namespace

bool PlaceholderOf(pugi::xml_node shape, std::string& type, long long& idx) {
    pugi::xml_node nonVisual;
    for (const char* name : {"nvSpPr", "nvPicPr", "nvGraphicFramePr", "nvGrpSpPr", "nvCxnSpPr"}) {
        nonVisual = Child(shape, name);
        if (nonVisual) break;
    }
    const pugi::xml_node placeholder = Child(Child(nonVisual, "nvPr"), "ph");
    if (!placeholder) {
        return false;
    }
    type = std::string(AttrText(placeholder, "type"));
    if (type.empty()) type = "obj";
    idx = AttrInt(placeholder, "idx", 0);  // the schema default
    return true;
}

std::string TextOfBody(pugi::xml_node txBody) {
    std::string text;
    bool firstParagraph = true;
    for (pugi::xml_node paragraph = txBody.first_child(); paragraph; paragraph = paragraph.next_sibling()) {
        if (!Is(paragraph, "p")) continue;
        if (!firstParagraph) text += '\n';
        firstParagraph = false;
        for (pugi::xml_node run = paragraph.first_child(); run; run = run.next_sibling()) {
            if (Is(run, "r") || Is(run, "fld")) {
                text += Child(run, "t").child_value();
            } else if (Is(run, "br")) {
                text += '\n';
            }
        }
    }
    return text;
}

bool BuildSlideJson(
    const DeckContext& deck,
    const LoadedPart& slide,
    const Layout& layout,
    std::size_t slideIndex,
    std::string& json,
    Failure& failure) {
    SlideBuilder builder(deck, slide, layout, slideIndex, failure);
    return builder.Run(json);
}

}  // namespace leanslides::core::detail
