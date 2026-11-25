#pragma once

// Internal to the core: recognises OLE compound files (PowerPoint 97-2003 and
// encrypted OOXML) by their directory, without reading any stream.

#include <string_view>

#include "core/SlideCore.h"

namespace leanslides::core::detail {

bool HasCompoundFileSignature(std::string_view bytes);

// LegacyPpt, EncryptedOoxml, or NotAPresentation (another OLE format).
FileKind ClassifyCompoundFile(std::string_view bytes);

}  // namespace leanslides::core::detail
