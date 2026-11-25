#pragma once

#include <windows.h>

#include <string>

#include "EditorChoice.h"

namespace leanslides::windows_host {

// Looks for PowerPoint, LibreOffice, and the default .pptx handler once per launch.
EditorChoice ResolveEditor();

enum class LaunchResult { Started, OpenedWeb, Failed };

// Starts the chosen editor on `path` with CreateProcessW and a quoted argument
// vector. PowerPoint for the web opens in the browser through ShellExecuteW.
LaunchResult LaunchEditor(const EditorChoice& choice, const std::wstring& path);

}  // namespace leanslides::windows_host
