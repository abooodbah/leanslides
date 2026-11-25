#pragma once

// Internal to the core: small helpers for walking DrawingML and PresentationML.
// Elements are matched by local name. Presentation parts use the conventional
// p:, a:, and r: prefixes in practice; where two namespaces share a local name
// the structures are the same (p:txBody and a:txBody), so the prefix does not
// change how LeanSlides reads them.

#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <string>
#include <string_view>

#include "pugixml.hpp"

namespace leanslides::core::detail {

inline const char* LocalName(const char* qualified) {
    const char* colon = std::strchr(qualified, ':');
    return colon == nullptr ? qualified : colon + 1;
}

inline bool Is(pugi::xml_node node, const char* local) {
    return node.type() == pugi::node_element && std::strcmp(LocalName(node.name()), local) == 0;
}

// The first child element with this local name. mc:AlternateContent children
// are looked through (see Resolve below).
pugi::xml_node Child(pugi::xml_node node, const char* local);

// The element that stands for an mc:AlternateContent: its mc:Fallback content
// when there is one (the most widely readable form: pictures for equations,
// plain shapes for newer effects), otherwise the first mc:Choice.
pugi::xml_node AlternateContentPick(pugi::xml_node alternate);

// Calls `visit` for every child element, replacing each mc:AlternateContent by
// the children of its picked branch.
template <typename Visit>
void ForEachChild(pugi::xml_node node, const Visit& visit) {
    for (pugi::xml_node child = node.first_child(); child; child = child.next_sibling()) {
        if (child.type() != pugi::node_element) {
            continue;
        }
        if (Is(child, "AlternateContent")) {
            const pugi::xml_node pick = AlternateContentPick(child);
            for (pugi::xml_node inner = pick.first_child(); inner; inner = inner.next_sibling()) {
                if (inner.type() == pugi::node_element) {
                    visit(inner);
                }
            }
            continue;
        }
        visit(child);
    }
}

// An attribute by local name ("embed" finds r:embed).
pugi::xml_attribute Attr(pugi::xml_node node, const char* local);

// A prefixed attribute by local name ("id" finds r:id but not a plain id).
// Relationship ids are always prefixed; p:sldId carries both forms.
inline std::string_view RelAttr(pugi::xml_node node, const char* local) {
    for (pugi::xml_attribute attribute = node.first_attribute(); attribute;
         attribute = attribute.next_attribute()) {
        const char* name = attribute.name();
        if (std::strchr(name, ':') != nullptr && std::strncmp(name, "xmlns", 5) != 0 &&
            std::strcmp(LocalName(name), local) == 0) {
            return attribute.value();
        }
    }
    return {};
}

inline bool HasAttr(pugi::xml_node node, const char* local) {
    return static_cast<bool>(Attr(node, local));
}

inline long long AttrInt(pugi::xml_node node, const char* local, long long fallback) {
    const pugi::xml_attribute attribute = Attr(node, local);
    if (!attribute) {
        return fallback;
    }
    const char* text = attribute.value();
    char* end = nullptr;
    const long long value = std::strtoll(text, &end, 10);
    return end == text ? fallback : value;
}

inline std::string_view AttrText(pugi::xml_node node, const char* local) {
    const pugi::xml_attribute attribute = Attr(node, local);
    return attribute ? std::string_view(attribute.value()) : std::string_view();
}

// OOXML booleans: "1", "true", "on".
inline bool AttrBool(pugi::xml_node node, const char* local, bool fallback) {
    const pugi::xml_attribute attribute = Attr(node, local);
    if (!attribute) {
        return fallback;
    }
    const std::string_view value = attribute.value();
    return value == "1" || value == "true" || value == "on";
}

// Percent values are thousandths of a percent ("50000" is 50%), and may be
// written as "50%" in Strict files. Returns the fraction (0.5).
double ParsePercent(std::string_view text, double fallback);

inline double AttrPercent(pugi::xml_node node, const char* local, double fallback) {
    const pugi::xml_attribute attribute = Attr(node, local);
    return attribute ? ParsePercent(attribute.value(), fallback) : fallback;
}

}  // namespace leanslides::core::detail
