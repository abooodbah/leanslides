// LeanSlides core tests. Plain checks, no framework: every failed check prints
// a line and the process exits 1. The first argument, when given, is the
// corpus cache folder (tests/corpus/cache); tests that need a public deck
// from it are skipped with a note when it is missing.

#include "core/SlideCore.h"

#include <filesystem>
#include <iostream>
#include <string>
#include <vector>

#include "TestZip.h"

namespace {

namespace core = leanslides::core;
namespace fs = std::filesystem;
using leanslides::tests::BuildZip;
using leanslides::tests::TestEntry;

int failures = 0;
int checks = 0;

void Expect(bool condition, const std::string& message) {
    ++checks;
    if (!condition) {
        ++failures;
        std::cerr << "FAIL: " << message << '\n';
    }
}

void ExpectEqual(const std::string& actual, const std::string& expected, const std::string& message) {
    Expect(actual == expected, message + "\n  expected: " + expected + "\n  actual:   " + actual);
}

std::string ContentTypes(const std::string& mainType) {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
           "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
           "<Default Extension=\"rels\" "
           "ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
           "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
           "<Override PartName=\"/ppt/presentation.xml\" ContentType=\"" +
           mainType + "\"/></Types>";
}

std::string Package(const std::string& mainType) {
    std::vector<TestEntry> entries;
    entries.push_back({"[Content_Types].xml", ContentTypes(mainType)});
    entries.push_back(
        {"_rels/.rels",
         "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
         "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
         "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/"
         "2006/relationships/officeDocument\" Target=\"ppt/presentation.xml\"/>"
         "</Relationships>"});
    entries.push_back(
        {"ppt/presentation.xml",
         "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
         "<p:presentation xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">"
         "<p:sldSz cx=\"9144000\" cy=\"6858000\"/></p:presentation>",
         true});
    return BuildZip(entries);
}

void TestKinds() {
    const struct {
        const char* type;
        core::FileKind kind;
        const char* name;
    } cases[] = {
        {"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
         core::FileKind::Pptx, "pptx"},
        {"application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml",
         core::FileKind::Ppsx, "ppsx"},
        {"application/vnd.openxmlformats-officedocument.presentationml.template.main+xml",
         core::FileKind::Potx, "potx"},
        {"application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml",
         core::FileKind::Pptm, "pptm"},
        {"application/vnd.ms-powerpoint.slideshow.macroEnabled.main+xml",
         core::FileKind::Ppsm, "ppsm"},
        {"application/vnd.ms-powerpoint.template.macroEnabled.main+xml",
         core::FileKind::Potm, "potm"},
    };
    for (const auto& item : cases) {
        const std::string bytes = Package(item.type);
        Expect(core::DetectKind(bytes) == item.kind, std::string("DetectKind ") + item.name);
        const core::OpenResult result = core::OpenPresentationBytes(bytes);
        Expect(result.ok, std::string("opens ") + item.name);
        ExpectEqual(core::FileKindName(result.kind), item.name, "kind name");
        Expect(core::IsRenderableKind(result.kind), std::string("renderable ") + item.name);
        Expect(result.presentation != nullptr, std::string("presentation for ") + item.name);
    }

    const std::string word = Package(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml");
    const core::OpenResult wordResult = core::OpenPresentationBytes(word);
    Expect(!wordResult.ok, "a Word package is refused");
    ExpectEqual(wordResult.errorCode, "missing-main-part", "Word package error code");

    std::vector<TestEntry> odp;
    odp.push_back({"mimetype", "application/vnd.oasis.opendocument.presentation"});
    const core::OpenResult odpResult = core::OpenPresentationBytes(BuildZip(odp));
    Expect(odpResult.ok && odpResult.kind == core::FileKind::Odp, "ODP is recognised");
    Expect(!odpResult.presentation, "ODP is not shown");

    const core::OpenResult text = core::OpenPresentationBytes("just some text");
    ExpectEqual(text.errorCode, "not-a-zip", "plain text error code");

    core::Limits small;
    small.maximumInputBytes = 16;
    const core::OpenResult large = core::OpenPresentationBytes(Package(cases[0].type), small);
    ExpectEqual(large.errorCode, "too-large", "input limit");
}

void TestPaths() {
    Expect(core::IsSupportedPresentationPath("a.PPTX"), "pptx path");
    Expect(core::IsSupportedPresentationPath("a.ppsx"), "ppsx path");
    Expect(core::IsSupportedPresentationPath("a.potx"), "potx path");
    Expect(core::IsSupportedPresentationPath("a.pptm"), "pptm path");
    Expect(!core::IsSupportedPresentationPath("a.docx"), "docx path");
}

void TestJson() {
    ExpectEqual(core::EscapeJsonString("a\"b\\c\n\x01"), "a\\\"b\\\\c\\n\\u0001", "JSON escape");
}

}  // namespace

int main(int argc, char** argv) {
    (void)argc;
    (void)argv;
    TestKinds();
    TestPaths();
    TestJson();
    std::cout << checks << " checks, " << failures << " failed\n";
    return failures == 0 ? 0 : 1;
}
