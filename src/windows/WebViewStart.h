#pragma once

// How the host starts its WebView2, free of Windows headers so
// tests/hosts/HostLogicTests.cpp checks it without a window.
//
// Every LeanSlides process on one user-data folder shares one browser. A
// browser on that folder that has stopped answering keeps a new window blank
// until WebView2 gives up on it, and one started with other arguments (another
// LeanSlides version, a test profile) makes creation fail. So a start that
// fails, or that has not reported "ready" after kWebViewStartTimeoutMs, is
// tried once more on a second folder inside the first. The uninstaller removes
// the first folder with everything in it (installer/uninstall.ps1).
//
// The deadline sits between a slow healthy start and WebView2's own limit: a
// first start on a new profile took 8.9 s on a CI runner, and WebView2 gave up
// on a stopped browser after about 41 s. The start on the second folder has no
// deadline; it may be a first start too, and the window waits for it.

#include <string>
#include <string_view>

namespace leanslides::windows_host {

constexpr unsigned kWebViewStartTimeoutMs = 20000;
constexpr std::wstring_view kWebViewFolderName = L"WebView2";
constexpr std::wstring_view kWebViewRecoveryFolderName = L"Recovery";

enum class WebViewStartStep { RetryOnRecoveryFolder, GiveUp };

// What to do when a start fails or runs out of time.
constexpr WebViewStartStep NextWebViewStartStep(bool onRecoveryFolder) {
    return onRecoveryFolder ? WebViewStartStep::GiveUp : WebViewStartStep::RetryOnRecoveryFolder;
}

// The user-data folder below the LeanSlides data folder, written with
// backslashes: "WebView2" or "WebView2\Recovery".
inline std::wstring WebViewFolder(std::wstring_view dataFolder, bool onRecoveryFolder) {
    std::wstring folder(dataFolder);
    if (!folder.empty() && folder.back() != L'\\') {
        folder += L'\\';
    }
    folder += kWebViewFolderName;
    if (onRecoveryFolder) {
        folder += L'\\';
        folder += kWebViewRecoveryFolderName;
    }
    return folder;
}

}  // namespace leanslides::windows_host
