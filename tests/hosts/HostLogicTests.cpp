// Checks of the Windows host logic that needs no window: the open-in-editor
// order, command-line quoting, the deck addresses the reader asks for, the
// reader message parser, the saved settings, and the test hooks.

#include "core/Links.h"
#include "core/ReaderSettings.h"
#include "windows/ContextMenu.h"
#include "windows/DeckUrl.h"
#include "windows/EditorChoice.h"
#include "windows/HostJson.h"
#include "windows/TestHooks.h"
#include "windows/WebViewStart.h"

#include <cstdlib>
#include <iostream>
#include <optional>
#include <string>
#include <vector>

namespace {

int failures = 0;

void Check(bool condition, const char* description) {
    if (!condition) {
        ++failures;
        std::cerr << "FAIL  " << description << '\n';
    }
}

std::string Narrow(const std::wstring& value) {
    std::string output;
    for (const wchar_t character : value) {
        output.push_back(character < 0x80 ? static_cast<char>(character) : '?');
    }
    return output;
}

// The reverse of QuoteArgument, following CommandLineToArgvW for arguments
// after the first: 2n backslashes and a quote give n backslashes and toggle
// quoting; 2n+1 give n backslashes and a literal quote.
std::vector<std::wstring> SplitCommandLine(const std::wstring& line) {
    std::vector<std::wstring> arguments;
    std::wstring current;
    bool quoted = false;
    bool any = false;
    for (std::size_t index = 0; index < line.size();) {
        const wchar_t character = line[index];
        if (character == L'\\') {
            std::size_t count = 0;
            while (index < line.size() && line[index] == L'\\') {
                ++count;
                ++index;
            }
            if (index < line.size() && line[index] == L'"') {
                current.append(count / 2, L'\\');
                if (count % 2 == 1) {
                    current.push_back(L'"');
                    ++index;
                }
            } else {
                current.append(count, L'\\');
            }
            any = true;
            continue;
        }
        if (character == L'"') {
            quoted = !quoted;
            any = true;
            ++index;
            continue;
        }
        if ((character == L' ' || character == L'\t') && !quoted) {
            if (any) {
                arguments.push_back(current);
                current.clear();
                any = false;
            }
            ++index;
            continue;
        }
        current.push_back(character);
        any = true;
        ++index;
    }
    if (any) {
        arguments.push_back(current);
    }
    return arguments;
}

void TestEditorOrder() {
    using namespace leanslides::windows_host;
    const auto toUtf8 = [](const std::wstring& value) { return Narrow(value); };

    EditorCandidates all;
    all.powerPoint = L"C:\\Office\\POWERPNT.EXE";
    all.libreOffice = L"C:\\LibreOffice\\program\\soffice.exe";
    all.defaultApp = L"C:\\Apps\\Slides.exe";
    all.defaultAppName = L"Slides";
    auto choice = ChooseEditor(all, toUtf8);
    Check(choice.kind == EditorKind::PowerPoint && choice.label == "Open in PowerPoint",
          "PowerPoint comes first when it is installed");

    all.powerPoint.clear();
    choice = ChooseEditor(all, toUtf8);
    Check(choice.kind == EditorKind::LibreOffice &&
              choice.label == "Open in LibreOffice Impress",
          "LibreOffice Impress comes next");

    all.libreOffice.clear();
    choice = ChooseEditor(all, toUtf8);
    Check(choice.kind == EditorKind::Default && choice.label == "Open in Slides",
          "then the named default app for .pptx");

    all.defaultAppName.clear();
    choice = ChooseEditor(all, toUtf8);
    Check(choice.label == "Open with default app", "an unnamed default app has a generic label");

    all.defaultIsSelf = true;
    choice = ChooseEditor(all, toUtf8);
    Check(choice.kind == EditorKind::Web && choice.label == "Open PowerPoint for the web" &&
              choice.target == std::wstring(L"https://www.office.com/launch/powerpoint"),
          "LeanSlides never offers itself; the last resort is PowerPoint for the web");
    Check(std::string(EditorKindName(EditorKind::Web)) == "web" &&
              std::string(EditorKindName(EditorKind::Default)) == "default" &&
              std::string(EditorKindName(EditorKind::LibreOffice)) == "libreoffice" &&
              std::string(EditorKindName(EditorKind::PowerPoint)) == "powerpoint",
          "editor kinds use the protocol names");
}

void TestQuoting() {
    using leanslides::windows_host::BuildCommandLine;
    const std::vector<std::wstring> cases[] = {
        {L"C:\\Program Files\\LibreOffice\\program\\soffice.exe", L"C:\\Decks\\Plan.pptx"},
        {L"C:\\Office\\POWERPNT.EXE", L"C:\\My Decks\\Trailing\\"},
        {L"C:\\a.exe", L"C:\\x\\\"quoted\" name.pptx"},
        {L"C:\\a.exe", L""},
        {L"C:\\a.exe", L"tab\there"},
        {L"C:\\a.exe", L"back\\\\slashes\\\\"},
    };
    for (const auto& arguments : cases) {
        const std::wstring line = BuildCommandLine(arguments);
        const auto parsed = SplitCommandLine(line);
        Check(parsed == arguments, ("command line round trip: " + Narrow(line)).c_str());
    }
    Check(BuildCommandLine({L"C:\\a.exe", L"plain"}) == L"C:\\a.exe plain",
          "plain arguments are not quoted");
}

void TestDeckUrls() {
    using namespace leanslides::windows_host;
    const std::string base = "https://app.leanslides.invalid/deck/";

    auto request = ParseDeckUrl(base + "3/2/index.json");
    Check(request && request->tab == 3 && request->generation == 2 &&
              request->resource == DeckResource::Index,
          "the index address names its tab and generation");
    request = ParseDeckUrl(base + "3/2/details.json");
    Check(request && request->resource == DeckResource::Details, "the details address parses");
    request = ParseDeckUrl(base + "3/2/slide/0.json");
    Check(request && request->resource == DeckResource::Slide && request->slide == 0,
          "slides count from 0");
    request = ParseDeckUrl(base + "3/2/slide/41.json");
    Check(request && request->slide == 41, "slide 41 parses");
    request = ParseDeckUrl(base + "3/2/media?id=%2Fppt%2Fmedia%2Fimage%201.png");
    Check(request && request->resource == DeckResource::Media &&
              request->mediaId == "/ppt/media/image 1.png",
          "a media id is percent-decoded");
    request = ParseDeckUrl(base + "3/2/media?id=%2Fppt%2Fmedia%2F%E5%9B%BE.png");
    Check(request && request->mediaId == "/ppt/media/\xE5\x9B\xBE.png",
          "a media id keeps UTF-8 bytes");

    const char* refused[] = {
        "0/2/index.json",              // tab 0 is never a tab
        "3/0/index.json",              // generation 0 is never shown
        "03/2/index.json",             // a leading zero
        "3/2/slide/01.json",           // a leading zero on the slide
        "3/2/slide/-1.json",           // a sign
        "3/2/slide/.json",             // no number
        "3/2/slide/1.json?x=1",        // a query on a slide
        "3/2/slide/1234567890.json",   // ten digits
        "3/2/index.json#top",          // a fragment
        "3/2/document.pptx",           // an unknown resource
        "3/2/../2/index.json",         // a dot segment
        "3/2/media?id=",               // an empty id
        "3/2/media?id=%2",             // a cut escape
        "3/2/media?id=%zz",            // a bad escape
        "3/2/media?id=%00",            // a NUL
        "3/2/media?id=a+b",            // '+' is never sent
        "3/2/media?id=a&id=b",         // a second parameter
        "3/2/media",                   // no id
        "3/index.json",                // no generation
        "",                            // nothing
    };
    for (const char* tail : refused) {
        Check(!ParseDeckUrl(base + tail), ("refused: " + std::string(tail)).c_str());
    }
    Check(!ParseDeckUrl("https://app.leanslides.invalid/deck3/2/index.json"),
          "a near-miss prefix is refused");
    Check(!ParseDeckUrl("https://evil.invalid/deck/3/2/index.json"), "another origin is refused");
    // The address limit is 2048 bytes and the decoded id limit is 1024 bytes.
    const std::string mediaBase = base + "3/2/media?id=";
    Check(ParseDeckUrl(mediaBase + std::string(1024, 'a')).has_value(),
          "a 1024-byte media id is accepted");
    Check(!ParseDeckUrl(mediaBase + std::string(1025, 'a')), "a 1025-byte media id is refused");
    std::string escaped;
    for (int index = 0; index < 600; ++index) escaped += "%41";  // 1800 bytes, decodes to 600
    escaped += std::string(2048 - mediaBase.size() - escaped.size(), 'a');
    Check(ParseDeckUrl(mediaBase + escaped).has_value(), "a 2048-byte address is accepted");
    Check(!ParseDeckUrl(mediaBase + escaped + "a"), "a 2049-byte address is refused");
}

void TestDeckGates() {
    using namespace leanslides::windows_host;
    DeckRequest request;
    request.tab = 3;
    request.generation = 2;
    Check(IsCurrentDeckRequest(request, true, 3, 2, 3), "the active tab's current deck is served");
    Check(!IsCurrentDeckRequest(request, false, 3, 2, 3), "nothing is served without a deck");
    Check(!IsCurrentDeckRequest(request, true, 4, 2, 3), "another tab's deck is not served");
    Check(!IsCurrentDeckRequest(request, true, 3, 3, 3), "an older generation is not served");
    Check(!IsCurrentDeckRequest(request, true, 3, 2, 4), "a background tab is not served");

    for (const char* type : {"image/png", "image/jpeg", "image/gif", "image/bmp"}) {
        Check(IsServableMediaType(type), (std::string("served picture type: ") + type).c_str());
    }
    for (const char* type : {"image/svg+xml", "image/x-wmf", "image/x-emf", "image/tiff",
                             "text/html", "application/octet-stream", "IMAGE/PNG", ""}) {
        Check(!IsServableMediaType(type), (std::string("refused type: ") + type).c_str());
    }
}

void TestJson() {
    using namespace leanslides::host_json;
    auto message = ParseMessage(
        R"("{\"type\":\"rendered\",\"tab\":3,\"generation\":2,\"slide\":12,\"ms\":40.5}")");
    Check(message.has_value(), "a JSON string holding an object parses");
    if (message) {
        Check(GetString(*message, "type") == std::optional<std::string>("rendered"),
              "type is read");
        Check(GetUnsigned(*message, "tab") == std::optional<unsigned>(3u), "tab is read");
        Check(!GetUnsigned(*message, "ms").has_value(), "a fraction is not an unsigned value");
    }
    message = ParseMessage(R"({"type":"present","on":true})");
    Check(message && GetBool(*message, "on") == std::optional<bool>(true), "true is read");
    message = ParseMessage(R"({"type":"present","on":false})");
    Check(message && GetBool(*message, "on") == std::optional<bool>(false), "false is read");
    message = ParseMessage(R"({"type":"present","on":1})");
    Check(message && !GetBool(*message, "on").has_value(), "a number is not a boolean");
    message = ParseMessage(R"({"type":"present","on":"true"})");
    Check(message && !GetBool(*message, "on").has_value(), "a string is not a boolean");

    message = ParseMessage(R"({"type":"link","href":"https://example.com/a?b=\u00e9&c=\ud83d\ude00"})");
    Check(message && GetString(*message, "href") ==
                         std::optional<std::string>("https://example.com/a?b=\xC3\xA9&c=\xF0\x9F\x98\x80"),
          "escapes and surrogate pairs decode to UTF-8");
    message = ParseMessage(R"({"type":"x","nested":{"a":[1,2,{"b":null}]},"flag":true})");
    Check(message && GetString(*message, "type").has_value(), "nested values are skipped");
    Check(!ParseMessage(R"({"type":"x",})").has_value(), "a trailing comma is refused");
    Check(!ParseMessage(R"({"type":"x"} extra)").has_value(), "trailing text is refused");
    Check(!ParseMessage(R"({"type":"\ud800"})").has_value(), "a lone surrogate is refused");
    Check(!ParseMessage("[1,2]").has_value(), "an array is not a message");
    Check(!ParseMessage(R"("not an object")").has_value(), "a plain string is not a message");
    std::string deep;
    for (int index = 0; index < 40; ++index) {
        deep += "{\"a\":";
    }
    deep += "1";
    for (int index = 0; index < 40; ++index) {
        deep += "}";
    }
    Check(!ParseMessage(deep).has_value(), "nesting is bounded");
    Check(!ParseMessage(std::string(70000, ' ')).has_value(), "size is bounded");
    message = ParseMessage(R"({"type":"selectTab","id":-1})");
    Check(message && !GetUnsigned(*message, "id").has_value(), "negative ids are refused");
}

// The flag parser rejects anything but plain milliseconds, and trace lines
// have one fixed shape.
void TestHooks() {
    namespace wh = leanslides::windows_host;
    Check(wh::ParseExitAfterRender(L"--exit-after-render=0") == 0u, "0 ms is accepted");
    Check(wh::ParseExitAfterRender(L"--exit-after-render=250") == 250u, "250 ms is accepted");
    Check(wh::ParseExitAfterRender(L"--exit-after-render=600000") == 600000u,
          "the 600000 ms ceiling is accepted");
    Check(!wh::ParseExitAfterRender(L"--exit-after-render=600001"), "more than 600000 ms is refused");
    Check(!wh::ParseExitAfterRender(L"--exit-after-render="), "an empty value is refused");
    Check(!wh::ParseExitAfterRender(L"--exit-after-render=abc"), "letters are refused");
    Check(!wh::ParseExitAfterRender(L"--exit-after-render=1234567"), "seven digits are refused");
    Check(wh::FormatTimingLine("slide-served", 90, "slide=0 ms=3") ==
              "LEANSLIDES_TIMING slide-served 90 slide=0 ms=3\n",
          "trace line shape");
}

// A start that fails or times out is tried once more on the recovery folder,
// which sits inside the first folder so the uninstaller removes both.
void TestWebViewStart() {
    namespace wh = leanslides::windows_host;
    Check(wh::kWebViewStartTimeoutMs == 10000, "the start deadline is 10 s");
    Check(wh::NextWebViewStartStep(false) == wh::WebViewStartStep::RetryOnRecoveryFolder,
          "a first start that fails is retried on the recovery folder");
    Check(wh::NextWebViewStartStep(true) == wh::WebViewStartStep::GiveUp,
          "a start on the recovery folder that fails is not retried");
    Check(wh::WebViewFolder(L"C:\\Users\\a\\AppData\\Local\\LeanSlides", false) ==
              L"C:\\Users\\a\\AppData\\Local\\LeanSlides\\WebView2",
          "the first start uses LeanSlides\\WebView2");
    Check(wh::WebViewFolder(L"C:\\Users\\a\\AppData\\Local\\LeanSlides\\", true) ==
              L"C:\\Users\\a\\AppData\\Local\\LeanSlides\\WebView2\\Recovery",
          "the retry uses LeanSlides\\WebView2\\Recovery");
}

// Context menus keep copy and editing items only; nothing that fetches.
void TestContextMenu() {
    namespace wh = leanslides::windows_host;
    for (const wchar_t* allowed : {L"copy", L"copyLinkLocation", L"selectAll", L"paste"}) {
        Check(wh::IsAllowedContextMenuItem(allowed), "copy and edit items are kept");
    }
    for (const wchar_t* refused :
         {L"saveLinkAs", L"openLinkInNewWindow", L"saveImageAs", L"copyImageLocation",
          L"copyImage", L"saveAs", L"print", L"reload", L"back", L"forward",
          L"inspectElement", L"share", L"webCapture", L"createQrCode", L"", L"Copy"}) {
        Check(!wh::IsAllowedContextMenuItem(refused), "every other item is dropped");
    }
}

// The five themes with LeanMark's canvas colours.
void TestReaderSettings() {
    namespace rs = leanslides::settings;
    using rs::Theme;
    const Theme all[] = {Theme::System, Theme::Light, Theme::Dark, Theme::Dim, Theme::Dusk};
    const char* names[] = {"system", "light", "dark", "dim", "dusk"};
    for (int index = 0; index < 5; ++index) {
        Check(std::string(rs::ThemeName(all[index])) == names[index], "each theme saves under its name");
        Check(rs::ParseTheme(names[index]) == all[index], "each saved name reads back");
        Check(rs::IsThemeName(names[index]), "the five names are themes");
    }
    Check(rs::ParseTheme("DIM") == Theme::Dim && rs::ParseTheme("Dusk") == Theme::Dusk,
          "theme names ignore ASCII case");
    Check(rs::ParseTheme("sepia") == Theme::System && rs::ParseTheme("") == Theme::System,
          "an unknown or empty name reads as System");
    Check(!rs::IsThemeName("sepia") && !rs::IsThemeName(""), "unknown names are refused");
    Check(rs::NextTheme(Theme::System) == Theme::Light && rs::NextTheme(Theme::Light) == Theme::Dark &&
              rs::NextTheme(Theme::Dark) == Theme::Dim && rs::NextTheme(Theme::Dim) == Theme::Dusk &&
              rs::NextTheme(Theme::Dusk) == Theme::System,
          "the theme cycle is System, Light, Dark, Dim, Dusk");
    Check(!rs::IsDarkTheme(Theme::Light, true) && rs::IsDarkTheme(Theme::Dark, false) &&
              rs::IsDarkTheme(Theme::Dim, false) && rs::IsDarkTheme(Theme::Dusk, false),
          "Dark, Dim and Dusk have a dark window frame");
    Check(rs::IsDarkTheme(Theme::System, true) && !rs::IsDarkTheme(Theme::System, false),
          "System follows Windows");
    const auto same = [](rs::Rgb color, int red, int green, int blue) {
        return color.red == red && color.green == green && color.blue == blue;
    };
    Check(same(rs::ThemeCanvas(Theme::Light, true), 0xfa, 0xf9, 0xf7), "the light canvas is #faf9f7");
    Check(same(rs::ThemeCanvas(Theme::Dark, false), 0x0e, 0x0d, 0x0b), "the dark canvas is #0e0d0b");
    Check(same(rs::ThemeCanvas(Theme::Dim, false), 0x1e, 0x20, 0x23), "the dim canvas is #1e2023");
    Check(same(rs::ThemeCanvas(Theme::Dusk, false), 0x22, 0x1e, 0x19), "the dusk canvas is #221e19");
    Check(same(rs::ThemeCanvas(Theme::System, true), 0x0e, 0x0d, 0x0b) &&
              same(rs::ThemeCanvas(Theme::System, false), 0xfa, 0xf9, 0xf7),
          "System paints Dark or Light");
}

// The interface language the host saves and sends to the page.
void TestLanguages() {
    namespace rs = leanslides::settings;
    using rs::Language;
    Check(std::string(rs::LanguageName(Language::Auto)) == "auto" &&
              std::string(rs::LanguageName(Language::English)) == "en" &&
              std::string(rs::LanguageName(Language::ChineseSimplified)) == "zh-CN" &&
              std::string(rs::LanguageName(Language::Japanese)) == "ja",
          "languages save as auto, en, zh-CN and ja");
    Check(rs::ParseLanguage("ja") == Language::Japanese &&
              rs::ParseLanguage("zh-cn") == Language::ChineseSimplified &&
              rs::ParseLanguage("EN") == Language::English,
          "saved languages read back, ignoring ASCII case");
    Check(rs::ParseLanguage("fr") == Language::Auto && rs::ParseLanguage("") == Language::Auto,
          "an unknown or missing language reads as auto");
    Check(rs::IsLanguageName("auto") && rs::IsLanguageName("zh-CN") && !rs::IsLanguageName("zh-TW") &&
              !rs::IsLanguageName(""),
          "only the four names are languages");
}

// The rule the host applies before Windows sees a link from a slide.
void TestLinks() {
    using leanslides::core::NormalizeExternalLink;
    const auto link = [](std::string_view href) {
        return NormalizeExternalLink(href).value_or("<refused>");
    };
    Check(link("https://example.com/a?b=c#d") == "https://example.com/a?b=c#d",
          "a normalised https link passes unchanged");
    Check(link("HTTPS://example.com/") == "https://example.com/",
          "the scheme is compared without case and lowered");
    Check(link("http://user@example.com:8080/x") == "http://user@example.com:8080/x",
          "userinfo and port are kept");
    Check(link("MailTo:reader@example.com") == "mailto:reader@example.com",
          "mailto is accepted in any case");
    Check(link("mailto:a@example.com?subject=Hi&attach=/home/u/.ssh/id_rsa&body=x") ==
              "mailto:a@example.com?subject=Hi&body=x",
          "attach= is dropped");
    Check(link("mailto:a@example.com?ATTACHMENT=%2Fetc%2Fpasswd&CC=b@example.com") ==
              "mailto:a@example.com?CC=b@example.com",
          "parameters are matched without case and only the allow-list stays");
    Check(link("mailto:a@example.com#frag") == "mailto:a@example.com",
          "the mailto fragment is dropped");
    for (const char* refused :
         {"", "mailto:", "mailto:?subject=x", "mailto:?attach=/etc/passwd", "https://",
          "https:///path", "http:example.com", "https://?q", "ftp://example.com/",
          "file:///etc/passwd", "javascript:alert(1)", "data:text/html,x",
          "https://exa mple.com/", "mailto:a b@example.com", "https://example.com/\\x",
          "https://example.com/\"x", "https://example.com/<x>", "https://ex\x01.com/",
          "https://ex\xc3\xa9.com/", "ppaction://hlinkshowjump?jump=nextslide",
          "leanslides://app/reader.html", "noscheme"}) {
        Check(!NormalizeExternalLink(refused), (std::string("refused link: ") + refused).c_str());
    }
    Check(!NormalizeExternalLink("https://example.com/" + std::string(8200, 'a')),
          "links over 8192 bytes are refused");
}

}  // namespace

int main() {
    TestLinks();
    TestReaderSettings();
    TestLanguages();
    TestHooks();
    TestWebViewStart();
    TestContextMenu();
    TestEditorOrder();
    TestQuoting();
    TestDeckUrls();
    TestDeckGates();
    TestJson();
    if (failures != 0) {
        std::cerr << failures << " host logic check(s) failed.\n";
        return EXIT_FAILURE;
    }
    std::cout << "LeanSlides host logic checks passed.\n";
    return EXIT_SUCCESS;
}
