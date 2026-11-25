#include "core/XmlUtil.h"

namespace leanslides::core::detail {

pugi::xml_node AlternateContentPick(pugi::xml_node alternate) {
    pugi::xml_node choice;
    for (pugi::xml_node child = alternate.first_child(); child; child = child.next_sibling()) {
        if (Is(child, "Fallback")) {
            return child;
        }
        if (!choice && Is(child, "Choice")) {
            choice = child;
        }
    }
    return choice;
}

pugi::xml_node Child(pugi::xml_node node, const char* local) {
    for (pugi::xml_node child = node.first_child(); child; child = child.next_sibling()) {
        if (child.type() != pugi::node_element) {
            continue;
        }
        if (Is(child, local)) {
            return child;
        }
        if (Is(child, "AlternateContent")) {
            const pugi::xml_node pick = AlternateContentPick(child);
            for (pugi::xml_node inner = pick.first_child(); inner; inner = inner.next_sibling()) {
                if (Is(inner, local)) {
                    return inner;
                }
            }
        }
    }
    return {};
}

pugi::xml_attribute Attr(pugi::xml_node node, const char* local) {
    for (pugi::xml_attribute attribute = node.first_attribute(); attribute;
         attribute = attribute.next_attribute()) {
        if (std::strcmp(LocalName(attribute.name()), local) == 0) {
            return attribute;
        }
    }
    return {};
}

double ParsePercent(std::string_view text, double fallback) {
    if (text.empty()) {
        return fallback;
    }
    const std::string copy(text);
    char* end = nullptr;
    const double value = std::strtod(copy.c_str(), &end);
    if (end == copy.c_str()) {
        return fallback;
    }
    if (*end == '%') {
        return value / 100.0;
    }
    return value / 100000.0;
}

}  // namespace leanslides::core::detail
