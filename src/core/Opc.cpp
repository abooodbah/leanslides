#include "core/Opc.h"

#include <cctype>
#include <cstring>
#include <unordered_set>

namespace leanslides::core::detail {
namespace {

constexpr char kPptxMain[] =
    "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
constexpr char kPpsxMain[] =
    "application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml";
constexpr char kPotxMain[] =
    "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml";
constexpr char kPptmMain[] = "application/vnd.ms-powerpoint.presentation.macroenabled.main+xml";
constexpr char kPpsmMain[] = "application/vnd.ms-powerpoint.slideshow.macroenabled.main+xml";
constexpr char kPotmMain[] = "application/vnd.ms-powerpoint.template.macroenabled.main+xml";
constexpr char kOdpMime[] = "application/vnd.oasis.opendocument.presentation";

std::string TypeTail(std::string_view type) {
    const std::size_t slash = type.rfind('/');
    return LowercaseAscii(slash == std::string_view::npos ? type : type.substr(slash + 1));
}

}  // namespace

bool StartsWith(std::string_view value, std::string_view prefix) {
    return value.size() >= prefix.size() && value.substr(0, prefix.size()) == prefix;
}

bool EndsWith(std::string_view value, std::string_view suffix) {
    return value.size() >= suffix.size() &&
           value.substr(value.size() - suffix.size()) == suffix;
}

std::string Extension(std::string_view partName) {
    const std::size_t slash = partName.rfind('/');
    const std::size_t dot = partName.rfind('.');
    if (dot == std::string_view::npos || (slash != std::string_view::npos && dot < slash)) {
        return {};
    }
    return LowercaseAscii(partName.substr(dot + 1));
}

std::string ContentTypes::TypeOf(std::string_view partName) const {
    const auto found = overrides.find(LowercaseAscii(partName));
    if (found != overrides.end()) {
        return found->second;
    }
    const auto byExtension = defaults.find(Extension(partName));
    return byExtension == defaults.end() ? std::string() : byExtension->second;
}

bool ContentTypes::HasType(std::string_view contentType) const {
    const std::string wanted = LowercaseAscii(contentType);
    for (const auto& entry : defaults) {
        if (LowercaseAscii(entry.second) == wanted) return true;
    }
    for (const auto& entry : overrides) {
        if (LowercaseAscii(entry.second) == wanted) return true;
    }
    return false;
}

FileKind KindFromMainType(std::string_view contentType) {
    const std::string lowered = LowercaseAscii(contentType);
    if (lowered == kPptxMain) return FileKind::Pptx;
    if (lowered == kPpsxMain) return FileKind::Ppsx;
    if (lowered == kPotxMain) return FileKind::Potx;
    if (lowered == kPptmMain) return FileKind::Pptm;
    if (lowered == kPpsmMain) return FileKind::Ppsm;
    if (lowered == kPotmMain) return FileKind::Potm;
    return FileKind::NotAPresentation;
}

bool ReadXml(
    ZipReader& zip,
    const ZipEntry& entry,
    const Limits& limits,
    XmlPart& part,
    Failure& failure) {
    return zip.Read(entry, part.source, failure) && ParseXmlPart(part, limits, failure);
}

bool ParseContentTypes(
    ZipReader& zip,
    const Limits& limits,
    ContentTypes& types,
    Failure& failure) {
    const ZipEntry* entry = zip.Find("[Content_Types].xml");
    if (entry == nullptr) {
        return true;
    }
    auto part = std::make_unique<XmlPart>();
    if (!ReadXml(zip, *entry, limits, *part, failure)) {
        return false;
    }
    NsScope scope;
    pugi::xml_node root = part->document.document_element();
    scope.Push(root);
    for (pugi::xml_node child = root.first_child(); child; child = child.next_sibling()) {
        if (child.type() != pugi::node_element) {
            continue;
        }
        const std::size_t mark = scope.Mark();
        scope.Push(child);
        const QName name = scope.Element(child);
        const std::string contentType = child.attribute("ContentType").value();
        if (name.Is(Ns::Ct, "Default")) {
            types.defaults.emplace(
                LowercaseAscii(child.attribute("Extension").value()), contentType);
        } else if (name.Is(Ns::Ct, "Override")) {
            std::string_view partName = child.attribute("PartName").value();
            while (!partName.empty() && partName.front() == '/') {
                partName.remove_prefix(1);
            }
            types.overrides.emplace(LowercaseAscii(partName), contentType);
            const FileKind kind = KindFromMainType(contentType);
            if (kind != FileKind::NotAPresentation &&
                types.mainKind == FileKind::NotAPresentation) {
                types.mainKind = kind;
                types.mainPart = std::string(partName);
            }
        }
        scope.Pop(mark);
    }
    return true;
}

FileKind ClassifyZip(
    ZipReader& zip,
    const Limits& limits,
    ContentTypes& types,
    Failure& failure) {
    if (const ZipEntry* mimetype = zip.Find("mimetype")) {
        std::string value;
        if (mimetype->uncompressedSize <= 256 && zip.Read(*mimetype, value, failure)) {
            while (!value.empty() &&
                   (value.back() == '\n' || value.back() == '\r' || value.back() == ' ')) {
                value.pop_back();
            }
            if (value == kOdpMime) {
                return FileKind::Odp;
            }
        }
        if (failure.Failed()) {
            return FileKind::NotAPresentation;
        }
    }
    if (!ParseContentTypes(zip, limits, types, failure)) {
        return FileKind::NotAPresentation;
    }
    return types.mainKind;
}

std::string PercentDecode(std::string_view value) {
    std::string output;
    output.reserve(value.size());
    for (std::size_t index = 0; index < value.size(); ++index) {
        if (value[index] == '%' && index + 2 < value.size() &&
            std::isxdigit(static_cast<unsigned char>(value[index + 1])) &&
            std::isxdigit(static_cast<unsigned char>(value[index + 2]))) {
            const auto hex = [](char digit) {
                return digit <= '9' ? digit - '0' : (digit | 0x20) - 'a' + 10;
            };
            output += static_cast<char>(hex(value[index + 1]) * 16 + hex(value[index + 2]));
            index += 2;
        } else {
            output += value[index];
        }
    }
    return output;
}

std::string ResolvePartName(std::string_view source, std::string_view target) {
    const std::size_t cut = target.find_first_of("?#");
    if (cut != std::string_view::npos) {
        target = target.substr(0, cut);
    }
    std::string path;
    if (!target.empty() && target.front() == '/') {
        path = std::string(target.substr(1));
    } else {
        const std::size_t slash = source.rfind('/');
        path = slash == std::string_view::npos ? std::string()
                                               : std::string(source.substr(0, slash + 1));
        path.append(target);
    }
    std::vector<std::string> segments;
    std::size_t start = 0;
    while (start <= path.size()) {
        const std::size_t slash = path.find('/', start);
        const std::size_t end = slash == std::string::npos ? path.size() : slash;
        const std::string segment = path.substr(start, end - start);
        if (segment == "..") {
            if (segments.empty()) {
                return {};
            }
            segments.pop_back();
        } else if (!segment.empty() && segment != ".") {
            segments.push_back(segment);
        }
        if (slash == std::string::npos) {
            break;
        }
        start = slash + 1;
    }
    std::string resolved;
    for (const std::string& segment : segments) {
        if (!resolved.empty()) {
            resolved += '/';
        }
        resolved += segment;
    }
    return resolved;
}

std::string RelsPathFor(std::string_view partName) {
    const std::size_t slash = partName.rfind('/');
    if (slash == std::string_view::npos) {
        return "_rels/" + std::string(partName) + ".rels";
    }
    return std::string(partName.substr(0, slash + 1)) + "_rels/" +
           std::string(partName.substr(slash + 1)) + ".rels";
}

const Relationship* Relationships::ById(std::string_view id) const {
    for (const Relationship& relationship : items) {
        if (relationship.id == id) {
            return &relationship;
        }
    }
    return nullptr;
}

const Relationship* Relationships::FirstOfTail(std::string_view tail) const {
    for (const Relationship& relationship : items) {
        if (relationship.tail == tail && !relationship.external &&
            !relationship.partName.empty()) {
            return &relationship;
        }
    }
    return nullptr;
}

bool ReadRelationships(
    ZipReader& zip,
    const Limits& limits,
    std::string_view partName,
    Relationships& relationships,
    Failure& failure) {
    relationships.items.clear();
    const std::string relsName =
        partName.empty() ? std::string("_rels/.rels") : RelsPathFor(partName);
    const ZipEntry* entry = zip.Find(relsName);
    if (entry == nullptr) {
        return true;
    }
    auto part = std::make_unique<XmlPart>();
    if (!ReadXml(zip, *entry, limits, *part, failure)) {
        return false;
    }
    NsScope scope;
    pugi::xml_node root = part->document.document_element();
    scope.Push(root);
    std::unordered_set<std::string> seen;
    for (pugi::xml_node child = root.first_child(); child; child = child.next_sibling()) {
        if (child.type() != pugi::node_element) {
            continue;
        }
        const std::size_t mark = scope.Mark();
        scope.Push(child);
        const QName name = scope.Element(child);
        scope.Pop(mark);
        if (std::strcmp(name.local, "Relationship") != 0 ||
            (name.ns != Ns::Pr && name.ns != Ns::None)) {
            continue;
        }
        Relationship relationship;
        relationship.id = child.attribute("Id").value();
        relationship.type = child.attribute("Type").value();
        relationship.tail = TypeTail(relationship.type);
        relationship.target = child.attribute("Target").value();
        relationship.external =
            LowercaseAscii(child.attribute("TargetMode").value()) == "external";
        if (relationship.id.empty() || !seen.insert(relationship.id).second) {
            continue;
        }
        if (!relationship.external) {
            std::string resolved = ResolvePartName(partName, PercentDecode(relationship.target));
            const ZipEntry* target = resolved.empty() ? nullptr : zip.Find(resolved);
            if (target == nullptr) {
                resolved = ResolvePartName(partName, relationship.target);
                target = resolved.empty() ? nullptr : zip.Find(resolved);
            }
            // Package bookkeeping parts are never relationship targets.
            if (target != nullptr && !target->directory &&
                target->key != "[content_types].xml" && !EndsWith(target->key, ".rels")) {
                relationship.partName = target->name;
            }
        }
        relationships.items.push_back(std::move(relationship));
    }
    return true;
}

bool IsZipSignature(std::string_view bytes) {
    return StartsWith(bytes, std::string_view("PK\x03\x04", 4)) ||
           StartsWith(bytes, std::string_view("PK\x05\x06", 4));
}

}  // namespace leanslides::core::detail
