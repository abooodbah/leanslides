#pragma once

#include "core/ReaderSettings.h"

#include <windows.h>
#include <wrl.h>

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include <WebView2.h>

#include "core/SlideCore.h"
#include "EditorChoice.h"
#include "HostJson.h"

namespace leanslides::windows_host {

struct LaunchOptions {
    std::vector<std::wstring> paths;
    bool smokeTest = false;
    // --exit-after-render=MS: close MS milliseconds after the first rendered.
    std::optional<unsigned> exitAfterRenderMs;
};

class LeanSlidesApp {
public:
    // Shared with main.cpp, which hands a second launch's documents to the
    // running window instead of starting another browser process.
    static constexpr wchar_t kWindowClassName[] = L"LeanSlides.Reader.Window";
    static constexpr ULONG_PTR kOpenDocumentsCopyData = 0x4C534331;  // "LSC1"
    static constexpr std::size_t kMaximumForwardedPaths = 64;

    explicit LeanSlidesApp(LaunchOptions options);
    int Run(HINSTANCE instance, int showCommand);

private:
    using ThemeMode = settings::Theme;

    struct FileStamp {
        FILETIME writeTime = {};
        ULONGLONG size = 0;
        bool valid = false;
    };

    // A tab keeps only what the tab strip and the file watcher need. The
    // opened deck of the active tab is the only presentation data held, and a
    // background tab is read from disk again when it is selected.
    struct Tab {
        unsigned id = 0;
        std::wstring path;
        std::wstring fileName;
        unsigned generation = 0;
        bool shown = false;
        FileStamp loaded;
        FileStamp pending;
        ULONGLONG pendingSince = 0;
        bool missingReported = false;
    };

    static constexpr UINT_PTR kFilePollTimer = 1;
    static constexpr UINT_PTR kSmokeTimer = 2;
    static constexpr UINT_PTR kExitAfterRenderTimer = 3;
    static constexpr UINT_PTR kSmokeProbeTimer = 4;
    static constexpr UINT_PTR kWebViewStartTimer = 5;
    static constexpr UINT kFilePollIntervalMs = 500;
    static constexpr UINT kSmokeTimeoutMs = 18000;
    static constexpr UINT kOpenPendingMessage = WM_APP + 1;
    static constexpr UINT kRecreateWebViewMessage = WM_APP + 2;
    static constexpr std::size_t kMaximumTabs = 64;
    static constexpr std::size_t kMaximumRecent = 10;

    static FileStamp ReadStamp(const std::wstring& path);
    static bool SameStamp(const FileStamp& left, const FileStamp& right);

    static LRESULT CALLBACK WindowProcedure(
        HWND window, UINT message, WPARAM wParam, LPARAM lParam);
    LRESULT HandleWindowMessage(UINT message, WPARAM wParam, LPARAM lParam);

    bool CreateMainWindow(int showCommand);
    void InitializeWebView();
    void ConfigureWebView();
    void ResizeWebView();
    void NavigateToReader();
    void OpenDroppedFile(const std::wstring& path);
    void RecreateWebView();
    void HandleProcessFailed(COREWEBVIEW2_PROCESS_FAILED_KIND kind);
    void RetryWebViewOrFail(const wchar_t* message, const char* reason);
    void SetMinimized(bool minimized);
    void Fail(const wchar_t* message);

    bool ReceiveOpenRequest(const COPYDATASTRUCT* data);
    void OpenDocuments(const std::vector<std::wstring>& paths);
    void ActivateTab(unsigned id);
    void CloseTab(unsigned id);
    void ShowActiveTab(bool automaticReload);
    void ClearDeck();
    Tab* FindTab(unsigned id);
    Tab* ActiveTab();
    void HandleAppRequest(ICoreWebView2WebResourceRequestedEventArgs* arguments);
    template <typename Respond>
    void ServeDeck(
        const std::string& uri, const Respond& respond, const std::wstring& commonHeaders);
    template <typename Respond>
    void ServeAsset(
        const std::string& uri, const Respond& respond, const std::wstring& commonHeaders);

    void OpenDocumentDialog();
    void PollActiveTab();
    void UpdateTitle();

    void PostJson(const std::string& json);
    void SendHost();
    void SendTheme();
    void SendTabs();
    void SendEmpty();
    void SendStatus(std::string_view message, const char* tone = "info");
    void HandleWebMessage(ICoreWebView2WebMessageReceivedEventArgs* arguments);
    void HandleRendered(const host_json::Object& message, bool failed);
    void HandleLink(const std::string& href);
    void OpenInEditor(unsigned tabId);

    void StartSmokeProbe();
    void CollectSmokeProbe();
    void SetPresenting(bool presenting);
    void CompleteSmoke(bool success, const std::string& detail);

    void LoadSettings();
    void SaveSettings() const;
    void AddRecent(const std::wstring& path);
    void ApplyWindowTheme();
    bool EffectiveDarkTheme() const;
    settings::Rgb WindowCanvas() const;
    const char* ThemeName() const;

    HINSTANCE instance_ = nullptr;
    HWND window_ = nullptr;
    std::wstring assetDirectory_;
    std::vector<std::wstring> pendingPaths_;
    bool smokeTest_ = false;
    bool smokeComplete_ = false;
    bool smokeProbeStarted_ = false;
    unsigned smokeProbePolls_ = 0;

    // A slide show fills the monitor with a borderless window; the style and
    // placement it had come back when the show ends.
    bool presenting_ = false;
    LONG_PTR savedStyle_ = 0;
    WINDOWPLACEMENT savedPlacement_ = {sizeof(WINDOWPLACEMENT)};
    int exitCode_ = 0;
    unsigned smokeRenderMs_ = 0;
    bool firstRenderSeen_ = false;
    std::optional<unsigned> exitAfterRenderMs_;
    std::uint64_t lastCoreMs_ = 0;

    Microsoft::WRL::ComPtr<ICoreWebView2Environment> environment_;
    Microsoft::WRL::ComPtr<ICoreWebView2Controller> controller_;
    Microsoft::WRL::ComPtr<ICoreWebView2> webView_;

    std::vector<Tab> tabs_;
    unsigned activeTab_ = 0;
    unsigned nextTabId_ = 1;

    // The opened deck of the active tab, answered from memory below
    // https://app.leanslides.invalid/deck/<tab>/<generation>/ (DeckUrl.h).
    std::shared_ptr<core::Presentation> deck_;
    unsigned deckTab_ = 0;
    unsigned deckGeneration_ = 0;

    bool readerReady_ = false;
    bool minimized_ = false;
    bool themeChangedWhileMinimized_ = false;
    ULONGLONG recoveryWindowStart_ = 0;
    unsigned recoveriesInWindow_ = 0;
    // Each WebView2 start has a number; a callback from an earlier start
    // that arrives after a retry is dropped (WebViewStart.h).
    unsigned webViewStart_ = 0;
    bool onRecoveryFolder_ = false;

    ThemeMode theme_ = ThemeMode::System;

    settings::Language language_ = settings::Language::Auto;
    std::vector<std::wstring> recent_;
    EditorChoice editor_;
};

}  // namespace leanslides::windows_host
