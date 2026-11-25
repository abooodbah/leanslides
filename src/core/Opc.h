#pragma once

// Internal to the core: Open Packaging Conventions helpers. Content types,
// relationships, and part-name resolution, all bounded by the ZIP reader.

#include <cstdint>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

#include "core/Failure.h"
#include "core/SlideCore.h"
#include "core/Xml.h"
#include "core/Zip.h"

namespace leanslides::core::detail {

bool StartsWith(std::string_view value, std::string_view prefix);
bool EndsWith(std::string_view value, std::string_view suffix);

// Lowercase extension of a part name, without the dot.
std::string Extension(std::string_view partName);

// [Content_Types].xml. Keys are lowercase part names without the leading
// slash, and lowercase extensions.
struct ContentTypes {
    std::unordered_map<std::string, std::string> defaults;
    std::unordered_map<std::string, std::string> overrides;
    std::string mainPart;
    FileKind mainKind = FileKind::NotAPresentation;

    std::string TypeOf(std::string_view partName) const;
    bool HasType(std::string_view contentType) const;
};

FileKind KindFromMainType(std::string_view contentType);

bool ReadXml(
    ZipReader& zip,
    const ZipEntry& entry,
    const Limits& limits,
    XmlPart& part,
    Failure& failure);

bool ParseContentTypes(
    ZipReader& zip,
    const Limits& limits,
    ContentTypes& types,
    Failure& failure);

// ODP by its mimetype entry, OOXML presentations by the main content type.
FileKind ClassifyZip(
    ZipReader& zip,
    const Limits& limits,
    ContentTypes& types,
    Failure& failure);

std::string PercentDecode(std::string_view value);

// Resolves a relationship target against its source part, per OPC. Returns
// an empty string for a target that leaves the package.
std::string ResolvePartName(std::string_view source, std::string_view target);

std::string RelsPathFor(std::string_view partName);

struct Relationship {
    std::string id;
    std::string type;
    std::string tail;  // last path segment of the type, lowercased ("slide", "image")
    std::string target;
    bool external = false;
    std::string partName;  // resolved and present in the archive; else empty
};

struct Relationships {
    std::vector<Relationship> items;
    const Relationship* ById(std::string_view id) const;
    const Relationship* FirstOfTail(std::string_view tail) const;
};

// Reads the .rels part of `partName`. A missing .rels part is an empty set.
bool ReadRelationships(
    ZipReader& zip,
    const Limits& limits,
    std::string_view partName,
    Relationships& relationships,
    Failure& failure);

bool IsZipSignature(std::string_view bytes);

}  // namespace leanslides::core::detail
