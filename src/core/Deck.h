#pragma once

// Internal to the core: the opened presentation. Reads presentation.xml, the
// theme, masters, and layouts once, and builds slide models on request.

#include <memory>
#include <string>

#include "core/Failure.h"
#include "core/Opc.h"
#include "core/SlideCore.h"

namespace leanslides::core::detail {

// Returns null and sets `failure` when the presentation cannot be opened.
// `result.kind` is already set by the caller.
std::shared_ptr<Presentation> OpenDeck(
    std::shared_ptr<const std::string> bytes,
    ContentTypes types,
    const Limits& limits,
    OpenResult& result,
    Failure& failure);

}  // namespace leanslides::core::detail
