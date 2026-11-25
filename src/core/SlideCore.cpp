#include "core/SlideCore.h"

#include <fstream>
#include <new>

#include "core/Cfb.h"
#include "core/Deck.h"
#include "core/Failure.h"
#include "core/Opc.h"
#include "core/Xml.h"
#include "core/Zip.h"

namespace leanslides::core {
namespace {

using detail::ContentTypes;
using detail::Failure;
using detail::ZipReader;

void AppendQuoted(std::string& output, std::string_view value) {
    output += '"';
    AppendJsonString(output, value);
    output += '"';
}

std::string MegabytesText(std::uint64_t bytes) {
    return std::to_string(bytes / (1024ull * 1024ull));
}

void FailTooLarge(Failure& failure, const Limits& limits) {
    failure.Set(
        "too-large",
        "This file is larger than LeanSlides' " + MegabytesText(limits.maximumInputBytes) +
            " MB limit.");
}

OpenResult OpenUnchecked(std::string bytes, const Limits& limits) {
    OpenResult result;
    Failure failure;
    result.sourceBytes = bytes.size();
    if (bytes.size() > limits.maximumInputBytes) {
        FailTooLarge(failure, limits);
    } else if (!detail::IsZipSignature(bytes)) {
        if (detail::HasCompoundFileSignature(bytes)) {
            result.kind = detail::ClassifyCompoundFile(bytes);
        }
        if (result.kind == FileKind::NotAPresentation) {
            failure.Set("not-a-zip", "This file is not a PowerPoint presentation.");
        }
    } else {
        // The ZIP reader parses the bytes in place, so the deck takes them first.
        auto bytesOwner = std::make_shared<const std::string>(std::move(bytes));
        ZipReader zip(limits);
        ContentTypes types;
        if (zip.Open(*bytesOwner, failure)) {
            const FileKind kind = detail::ClassifyZip(zip, limits, types, failure);
            if (!failure.Failed()) {
                result.kind = kind;
                if (kind == FileKind::NotAPresentation) {
                    failure.Set(
                        "missing-main-part",
                        "This file does not contain a PowerPoint presentation part.");
                } else if (IsRenderableKind(kind) && zip.ValidateEntries(failure)) {
                    result.presentation = detail::OpenDeck(
                        std::move(bytesOwner), std::move(types), limits, result, failure);
                }
            }
        }
    }

    if (failure.Failed()) {
        result.ok = false;
        result.errorCode = std::move(failure.code);
        result.errorMessage = std::move(failure.message);
        result.presentation.reset();
        return result;
    }
    result.ok = true;
    return result;
}

}  // namespace

bool IsRenderableKind(FileKind kind) {
    return kind == FileKind::Pptx || kind == FileKind::Ppsx || kind == FileKind::Potx ||
           kind == FileKind::Pptm || kind == FileKind::Ppsm || kind == FileKind::Potm;
}

const char* FileKindName(FileKind kind) {
    switch (kind) {
        case FileKind::Pptx: return "pptx";
        case FileKind::Ppsx: return "ppsx";
        case FileKind::Potx: return "potx";
        case FileKind::Pptm: return "pptm";
        case FileKind::Ppsm: return "ppsm";
        case FileKind::Potm: return "potm";
        case FileKind::LegacyPpt: return "legacy-ppt";
        case FileKind::EncryptedOoxml: return "encrypted-ooxml";
        case FileKind::Odp: return "odp";
        case FileKind::NotAPresentation: break;
    }
    return "not-a-presentation";
}

const char* FeatureCode(Feature feature) {
    switch (feature) {
        case Feature::Chart: return "chart";
        case Feature::SmartArt: return "smartart";
        case Feature::OleObject: return "ole-object";
        case Feature::Video: return "video";
        case Feature::Audio: return "audio";
        case Feature::Model3D: return "model-3d";
        case Feature::Ink: return "ink";
        case Feature::Equation: return "equation";
        case Feature::Metafile: return "metafile";
        case Feature::UnsupportedImage: return "unsupported-image";
        case Feature::Macros: return "macros";
        case Feature::LinkedMedia: return "linked-media";
        case Feature::EmbeddedFonts: return "embedded-fonts";
        case Feature::Comments: return "comments";
        case Feature::Animations: return "animations";
        case Feature::Transitions: return "transitions";
        case Feature::ActiveX: return "activex";
    }
    return "unknown";
}

bool FeatureIsNotDrawn(Feature feature) {
    switch (feature) {
        case Feature::Chart:
        case Feature::SmartArt:
        case Feature::OleObject:
        case Feature::Video:
        case Feature::Audio:
        case Feature::Model3D:
        case Feature::Ink:
        case Feature::Equation:
        case Feature::Metafile:
        case Feature::UnsupportedImage:
            return true;
        default:
            return false;
    }
}

FeatureLabel LabelFor(Feature feature) {
    switch (feature) {
        case Feature::Chart: return {"chart", "charts"};
        case Feature::SmartArt: return {"SmartArt graphic", "SmartArt graphics"};
        case Feature::OleObject: return {"embedded object", "embedded objects"};
        case Feature::Video: return {"video", "videos"};
        case Feature::Audio: return {"sound", "sounds"};
        case Feature::Model3D: return {"3D model", "3D models"};
        case Feature::Ink: return {"ink drawing", "ink drawings"};
        case Feature::Equation: return {"equation", "equations"};
        case Feature::Metafile: return {"EMF or WMF picture", "EMF or WMF pictures"};
        case Feature::UnsupportedImage: return {"picture format", "picture formats"};
        case Feature::Macros: return {"macro project", "macro projects"};
        case Feature::LinkedMedia: return {"linked file", "linked files"};
        case Feature::EmbeddedFonts: return {"embedded font", "embedded fonts"};
        case Feature::Comments: return {"comment", "comments"};
        case Feature::Animations: return {"animated slide", "animated slides"};
        case Feature::Transitions: return {"slide transition", "slide transitions"};
        case Feature::ActiveX: return {"ActiveX control", "ActiveX controls"};
    }
    return {"item", "items"};
}

FileKind DetectKind(std::string_view bytes) {
    if (!detail::IsZipSignature(bytes)) {
        return detail::HasCompoundFileSignature(bytes) ? detail::ClassifyCompoundFile(bytes)
                                                       : FileKind::NotAPresentation;
    }
    try {
        const Limits limits;
        ZipReader zip(limits);
        ContentTypes types;
        Failure failure;
        if (!zip.Open(bytes, failure)) {
            return FileKind::NotAPresentation;
        }
        const FileKind kind = detail::ClassifyZip(zip, limits, types, failure);
        return failure.Failed() ? FileKind::NotAPresentation : kind;
    } catch (const std::bad_alloc&) {
        return FileKind::NotAPresentation;
    }
}

OpenResult OpenPresentationBytes(std::string bytes, const Limits& limits) {
    const std::uint64_t size = bytes.size();
    try {
        return OpenUnchecked(std::move(bytes), limits);
    } catch (const std::bad_alloc&) {
        OpenResult result;
        result.sourceBytes = size;
        result.errorCode = "read-failed";
        result.errorMessage = "LeanSlides ran out of memory while reading this file.";
        return result;
    }
}

OpenResult OpenPresentationFile(const std::filesystem::path& path, const Limits& limits) {
    OpenResult result;
    const auto fail = [&result](const char* message) {
        result.ok = false;
        result.errorCode = "read-failed";
        result.errorMessage = message;
        return result;
    };

    std::error_code code;
    const auto status = std::filesystem::status(path, code);
    if (code || !std::filesystem::exists(status)) {
        return fail("LeanSlides could not find this file.");
    }
    if (std::filesystem::is_directory(status)) {
        return fail("That path is a folder, not a presentation.");
    }
    if (!std::filesystem::is_regular_file(status)) {
        return fail("LeanSlides can only read regular files.");
    }
    const auto size = std::filesystem::file_size(path, code);
    if (code) {
        return fail("LeanSlides could not measure this file.");
    }
    if (static_cast<std::uint64_t>(size) > limits.maximumInputBytes) {
        Failure failure;
        FailTooLarge(failure, limits);
        result.sourceBytes = static_cast<std::uint64_t>(size);
        result.errorCode = failure.code;
        result.errorMessage = failure.message;
        return result;
    }

    std::string bytes;
    try {
        std::ifstream input(path, std::ios::binary);
        if (!input) {
            return fail("LeanSlides could not read this file.");
        }
        bytes.resize(static_cast<std::size_t>(size));
        if (!bytes.empty()) {
            input.read(bytes.data(), static_cast<std::streamsize>(bytes.size()));
            const auto bytesRead = input.gcount();
            if (bytesRead < 0 || (input.bad() && bytesRead == 0)) {
                return fail("LeanSlides could not finish reading this file.");
            }
            bytes.resize(static_cast<std::size_t>(bytesRead));
        }
    } catch (const std::bad_alloc&) {
        return fail("LeanSlides ran out of memory while reading this file.");
    }
    return OpenPresentationBytes(std::move(bytes), limits);
}

bool IsSupportedPresentationPath(const std::filesystem::path& path) {
    const std::string extension = detail::LowercaseAscii(path.extension().string());
    return extension == ".pptx" || extension == ".ppsx" || extension == ".potx" ||
           extension == ".pptm" || extension == ".ppsm" || extension == ".potm" ||
           extension == ".ppt" || extension == ".odp";
}

std::string FailureJson(const OpenResult& result) {
    std::string json = "{\"ok\":";
    json += result.ok ? "true" : "false";
    json += ",\"errorCode\":";
    AppendQuoted(json, result.errorCode);
    json += ",\"errorMessage\":";
    AppendQuoted(json, result.errorMessage);
    json += ",\"kind\":";
    AppendQuoted(json, FileKindName(result.kind));
    json += ",\"sourceBytes\":";
    json += std::to_string(result.sourceBytes);
    json += '}';
    return json;
}

bool IsPathWithin(
    const std::filesystem::path& root,
    const std::filesystem::path& candidate) {
    std::error_code rootError;
    std::error_code candidateError;
    const auto canonicalRoot = std::filesystem::canonical(root, rootError);
    const auto canonicalCandidate = std::filesystem::canonical(candidate, candidateError);
    if (rootError || candidateError) {
        return false;
    }
    auto rootPart = canonicalRoot.begin();
    auto candidatePart = canonicalCandidate.begin();
    for (; rootPart != canonicalRoot.end(); ++rootPart, ++candidatePart) {
        if (candidatePart == canonicalCandidate.end() || *rootPart != *candidatePart) {
            return false;
        }
    }
    return true;
}

void AppendJsonString(std::string& output, std::string_view value) {
    static constexpr char kHex[] = "0123456789abcdef";
    std::size_t runStart = 0;
    for (std::size_t index = 0; index < value.size(); ++index) {
        const auto character = static_cast<unsigned char>(value[index]);
        char control[] = "\\u0000";
        const char* replacement = nullptr;
        std::size_t consumed = 1;
        switch (character) {
            case '"': replacement = "\\\""; break;
            case '\\': replacement = "\\\\"; break;
            case '\b': replacement = "\\b"; break;
            case '\f': replacement = "\\f"; break;
            case '\n': replacement = "\\n"; break;
            case '\r': replacement = "\\r"; break;
            case '\t': replacement = "\\t"; break;
            default:
                if (character < 0x20) {
                    control[4] = kHex[(character >> 4) & 0xF];
                    control[5] = kHex[character & 0xF];
                    replacement = control;
                } else if (
                    character == 0xE2 && index + 2 < value.size() &&
                    static_cast<unsigned char>(value[index + 1]) == 0x80 &&
                    (static_cast<unsigned char>(value[index + 2]) == 0xA8 ||
                     static_cast<unsigned char>(value[index + 2]) == 0xA9)) {
                    replacement = static_cast<unsigned char>(value[index + 2]) == 0xA8
                                      ? "\\u2028"
                                      : "\\u2029";
                    consumed = 3;
                }
                break;
        }
        if (replacement == nullptr) {
            continue;
        }
        output.append(value.data() + runStart, index - runStart);
        output += replacement;
        index += consumed - 1;
        runStart = index + 1;
    }
    output.append(value.data() + runStart, value.size() - runStart);
}

std::string EscapeJsonString(std::string_view value) {
    std::string output;
    output.reserve(value.size() + 16);
    AppendJsonString(output, value);
    return output;
}

}  // namespace leanslides::core
