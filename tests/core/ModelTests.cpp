// LeanSlides slide-model tests. A synthetic deck built in memory pins each
// inheritance and safety rule the slide builder relies on; each check names
// the rule. Plain checks, no framework: a failed check prints a line and the
// process exits 1.

#include <iostream>
#include <string>
#include <vector>

#include "TestZip.h"
#include "core/Color.h"
#include "core/SlideCore.h"
#include "pugixml.hpp"

namespace {

namespace core = leanslides::core;
namespace detail = leanslides::core::detail;
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

void ExpectContains(const std::string& text, const std::string& part, const std::string& message) {
    Expect(text.find(part) != std::string::npos,
           message + "\n  missing:  " + part + "\n  in:       " + text.substr(0, 1200));
}

void ExpectLacks(const std::string& text, const std::string& part, const std::string& message) {
    Expect(text.find(part) == std::string::npos, message + "\n  unexpected: " + part);
}

// The JSON object for the shape with this id: from its "kind" key to the
// matching close brace.
std::string ShapeJson(const std::string& slide, int id) {
    const std::string key = "\"id\":" + std::to_string(id) + ",";
    const std::size_t at = slide.find(key);
    if (at == std::string::npos) return {};
    const std::size_t start = slide.rfind("{\"kind\"", at);
    int depth = 0;
    bool quoted = false;
    for (std::size_t index = start; index < slide.size(); ++index) {
        const char character = slide[index];
        if (quoted) {
            if (character == '\\') ++index;
            else if (character == '"') quoted = false;
            continue;
        }
        if (character == '"') quoted = true;
        else if (character == '{' || character == '[') ++depth;
        else if ((character == '}' || character == ']') && --depth == 0) return slide.substr(start, index - start + 1);
    }
    return {};
}

// ------------------------------------------------------------ colour maths

std::string Resolve(const std::string& colorXml) {
    pugi::xml_document document;
    const std::string xml = "<a:solidFill xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\">" +
                            colorXml + "</a:solidFill>";
    document.load_string(xml.c_str());
    detail::ColorContext context;
    detail::Rgba accent;
    accent.r = 0x44 / 255.0;
    accent.g = 0x72 / 255.0;
    accent.b = 0xC4 / 255.0;
    context.theme["accent1"] = accent;
    detail::Rgba dark;
    dark.r = dark.g = dark.b = 0x11 / 255.0;
    context.theme["dk1"] = dark;
    context.map["tx1"] = "dk1";
    const auto color = detail::ResolveColorIn(document.document_element(), context);
    return color ? detail::HexOf(*color) : std::string("none");
}

void TestColors() {
    // PowerPoint's own theme variants of accent 1 (#4472C4).
    ExpectEqual(Resolve("<a:schemeClr val=\"accent1\"><a:lumMod val=\"75000\"/></a:schemeClr>"), "#2f5597",
                "lumMod 75% (Darker 25%) is applied in HSL");
    ExpectEqual(Resolve("<a:schemeClr val=\"accent1\"><a:lumMod val=\"60000\"/><a:lumOff val=\"40000\"/></a:schemeClr>"),
                "#8faadc", "lumMod 60% + lumOff 40% (Lighter 40%)");
    ExpectEqual(Resolve("<a:schemeClr val=\"accent1\"><a:lumMod val=\"20000\"/><a:lumOff val=\"80000\"/></a:schemeClr>"),
                "#dae3f3", "lumMod 20% + lumOff 80% (Lighter 80%)");
    ExpectEqual(Resolve("<a:schemeClr val=\"tx1\"/>"), "#111111", "tx1 goes through the colour map to dk1");
    ExpectEqual(Resolve("<a:srgbClr val=\"FFFFFF\"><a:shade val=\"50000\"/></a:srgbClr>"), "#bcbcbc",
                "shade is applied in linear light");
    ExpectEqual(Resolve("<a:srgbClr val=\"000000\"><a:tint val=\"50000\"/></a:srgbClr>"), "#bcbcbc",
                "tint is applied in linear light");
    ExpectEqual(Resolve("<a:sysClr val=\"windowText\" lastClr=\"0A0B0C\"/>"), "#0a0b0c", "sysClr uses lastClr");
    ExpectEqual(Resolve("<a:prstClr val=\"red\"/>"), "#ff0000", "preset colour names");
}

// ------------------------------------------------------- synthetic deck

const char* kNs =
    " xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\""
    " xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\""
    " xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"";

const char* kRelNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";

std::string Rels(const std::vector<std::vector<std::string>>& items) {
    std::string xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships "
                      "xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">";
    for (const auto& item : items) {
        xml += "<Relationship Id=\"" + item[0] + "\" Type=\"" + kRelNs + item[1] + "\" Target=\"" + item[2] + "\"";
        if (item.size() > 3) xml += " TargetMode=\"External\"";
        xml += "/>";
    }
    return xml + "</Relationships>";
}

std::string Part(const std::string& root, const std::string& body, const std::string& attributes = "") {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?><p:" + root + kNs + attributes + ">" + body + "</p:" + root + ">";
}

std::string Xfrm(int x, int y, int w, int h, const std::string& extra = "") {
    return "<a:xfrm" + extra + "><a:off x=\"" + std::to_string(x) + "\" y=\"" + std::to_string(y) +
           "\"/><a:ext cx=\"" + std::to_string(w) + "\" cy=\"" + std::to_string(h) + "\"/></a:xfrm>";
}

std::string Sp(int id, const std::string& ph, const std::string& spPr, const std::string& text,
               const std::string& nvExtra = "") {
    return "<p:sp><p:nvSpPr><p:cNvPr id=\"" + std::to_string(id) + "\" name=\"Shape " + std::to_string(id) +
           "\"/><p:cNvSpPr" + nvExtra + "/><p:nvPr>" + ph + "</p:nvPr></p:nvSpPr><p:spPr>" + spPr +
           "</p:spPr>" + (text.empty() ? std::string() : "<p:txBody><a:bodyPr/><a:lstStyle/>" + text + "</p:txBody>") +
           "</p:sp>";
}

std::string Tree(const std::string& shapes) {
    return "<p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>"
           "<p:grpSpPr/>" + shapes + "</p:spTree>";
}

const std::string kPng = std::string("\x89PNG\r\n\x1a\n", 8) + std::string(32, '\0');

std::string Theme() {
    std::string colors;
    const char* names[] = {"dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3",
                           "accent4", "accent5", "accent6", "hlink", "folHlink"};
    const char* values[] = {"112233", "FFFFFF", "222222", "EEEEEE", "4472C4", "ED7D31", "A5A5A5",
                            "FFC000", "5B9BD5", "70AD47", "0563C1", "954F72"};
    for (int index = 0; index < 12; ++index) {
        colors += std::string("<a:") + names[index] + "><a:srgbClr val=\"" + values[index] + "\"/></a:" + names[index] + ">";
    }
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?><a:theme" + std::string(kNs) +
           " name=\"Test\"><a:themeElements><a:clrScheme name=\"Test\">" + colors +
           "</a:clrScheme><a:fontScheme name=\"Test\"><a:majorFont><a:latin typeface=\"Georgia\"/>"
           "<a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:majorFont><a:minorFont><a:latin typeface=\"Verdana\"/>"
           "<a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:minorFont></a:fontScheme><a:fmtScheme name=\"Test\">"
           "<a:fillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill>"
           "<a:solidFill><a:schemeClr val=\"phClr\"><a:lumMod val=\"75000\"/></a:schemeClr></a:solidFill>"
           "<a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:fillStyleLst>"
           "<a:lnStyleLst><a:ln w=\"6350\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:ln>"
           "<a:ln w=\"12700\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:ln>"
           "<a:ln w=\"19050\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:ln></a:lnStyleLst>"
           "<a:effectStyleLst/><a:bgFillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill>"
           "</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>";
}

std::string Master() {
    const std::string titleText = "<a:p><a:r><a:rPr lang=\"en-US\"/><a:t>Master title</a:t></a:r></a:p>";
    const std::string shapes =
        Sp(2, "<p:ph type=\"title\"/>", Xfrm(127000, 127000, 8890000, 1270000), titleText) +
        Sp(3, "<p:ph type=\"body\" idx=\"1\"/>", Xfrm(127000, 1524000, 8890000, 4572000), titleText) +
        // A logo every slide shows (not a placeholder).
        Sp(50, "", Xfrm(0, 6350000, 254000, 254000) + "<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom>"
                   "<a:solidFill><a:schemeClr val=\"accent2\"/></a:solidFill>", "");
    const std::string styles =
        "<p:txStyles><p:titleStyle><a:lvl1pPr algn=\"ctr\"><a:defRPr sz=\"4400\"><a:solidFill>"
        "<a:schemeClr val=\"tx1\"/></a:solidFill><a:latin typeface=\"+mj-lt\"/></a:defRPr></a:lvl1pPr>"
        "</p:titleStyle><p:bodyStyle><a:lvl1pPr marL=\"342900\" indent=\"-342900\"><a:buFont typeface=\"Arial\"/>"
        "<a:buChar char=\"&#8226;\"/><a:defRPr sz=\"3200\"><a:solidFill><a:schemeClr val=\"tx1\"/></a:solidFill>"
        "<a:latin typeface=\"+mn-lt\"/></a:defRPr></a:lvl1pPr><a:lvl2pPr marL=\"742950\" indent=\"-285750\">"
        "<a:buChar char=\"-\"/><a:defRPr sz=\"2800\"/></a:lvl2pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr>"
        "<a:defRPr sz=\"1000\"/></a:lvl1pPr></p:otherStyle></p:txStyles>";
    return Part("sldMaster",
                "<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val=\"ABCDEF\"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>" +
                    Tree(shapes) + "</p:cSld><p:clrMap bg1=\"lt1\" tx1=\"dk1\" bg2=\"lt2\" tx2=\"dk2\" accent1=\"accent1\" "
                    "accent2=\"accent2\" accent3=\"accent3\" accent4=\"accent4\" accent5=\"accent5\" accent6=\"accent6\" "
                    "hlink=\"hlink\" folHlink=\"folHlink\"/><p:sldLayoutIdLst><p:sldLayoutId id=\"2147483649\" r:id=\"rId1\"/>"
                    "</p:sldLayoutIdLst>" + styles);
}

std::string Layout() {
    // The layout moves the title and leaves the body where the master put it.
    const std::string shapes =
        Sp(2, "<p:ph type=\"title\"/>", Xfrm(254000, 381000, 7620000, 1016000), "<a:p><a:endParaRPr/></a:p>") +
        Sp(3, "<p:ph idx=\"1\"/>", "", "<a:p><a:endParaRPr/></a:p>");
    return Part("sldLayout", "<p:cSld name=\"Title and Content\">" + Tree(shapes) + "</p:cSld>", " type=\"obj\"");
}

std::string Picture(int id, const std::string& blip) {
    return "<p:pic><p:nvPicPr><p:cNvPr id=\"" + std::to_string(id) + "\" name=\"Picture " + std::to_string(id) +
           "\"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill>" + blip +
           "<a:srcRect l=\"10000\" r=\"20000\"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>" +
           Xfrm(1270000, 1270000, 1270000, 1270000) + "<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></p:spPr></p:pic>";
}

std::string Slide1() {
    const std::string body =
        "<a:p><a:r><a:rPr lang=\"en-US\"/><a:t>First point</a:t></a:r></a:p>"
        "<a:p><a:pPr lvl=\"1\"/><a:r><a:rPr lang=\"en-US\"/><a:t>Second level</a:t></a:r></a:p>";
    // The group maps child space (0,0)-(2540000,2540000) onto 2540000 x 1270000
    // at (2540000,2540000): x scale 1, y scale 0.5.
    const std::string groupFixed =
        "<p:grpSp><p:nvGrpSpPr><p:cNvPr id=\"20\" name=\"Group 20\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>"
        "<p:grpSpPr><a:xfrm><a:off x=\"2540000\" y=\"2540000\"/><a:ext cx=\"2540000\" cy=\"1270000\"/>"
        "<a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"2540000\" cy=\"2540000\"/></a:xfrm></p:grpSpPr>" +
        Sp(21, "", Xfrm(0, 0, 1270000, 2540000, " rot=\"5400000\""), "") + "</p:grpSp>";
    const std::string table =
        "<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id=\"30\" name=\"Table 30\"/><p:cNvGraphicFramePr/><p:nvPr/>"
        "</p:nvGraphicFramePr><p:xfrm><a:off x=\"127000\" y=\"5080000\"/><a:ext cx=\"2540000\" cy=\"508000\"/></p:xfrm>"
        "<a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/table\"><a:tbl><a:tblPr/>"
        "<a:tblGrid><a:gridCol w=\"1270000\"/><a:gridCol w=\"1270000\"/></a:tblGrid>"
        "<a:tr h=\"127000\"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>a</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>"
        "<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>b</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>"
        "<a:tr h=\"127000\"><a:tc gridSpan=\"2\"><a:txBody><a:bodyPr/><a:p><a:r><a:t>c</a:t></a:r></a:p></a:txBody>"
        "<a:tcPr/></a:tc><a:tc hMerge=\"1\"><a:txBody><a:bodyPr/><a:p/></a:txBody><a:tcPr/></a:tc></a:tr>"
        "</a:tbl></a:graphicData></a:graphic></p:graphicFrame>";
    const std::string ole =
        "<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id=\"40\" name=\"Object 40\"/><p:cNvGraphicFramePr/><p:nvPr/>"
        "</p:nvGraphicFramePr><p:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"127000\" cy=\"127000\"/></p:xfrm><a:graphic>"
        "<a:graphicData uri=\"http://schemas.openxmlformats.org/presentationml/2006/ole\"><p:oleObj progId=\"Excel.Sheet.12\" "
        "r:id=\"rId9\"><p:embed/><p:pic><p:nvPicPr><p:cNvPr id=\"0\" name=\"\"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>"
        "<p:blipFill><a:blip r:embed=\"rId3\"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>" +
        Xfrm(0, 0, 127000, 127000) + "</p:spPr></p:pic></p:oleObj></a:graphicData></a:graphic></p:graphicFrame>";
    const std::string shapes =
        Sp(2, "<p:ph type=\"title\"/>", "", "<a:p><a:r><a:rPr lang=\"en-US\"/><a:t>Hello</a:t></a:r></a:p>") +
        Sp(3, "<p:ph idx=\"1\"/>", "", body) +
        Sp(4, "", Xfrm(127000, 6096000, 2540000, 254000) + "<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom>",
           "<a:p><a:r><a:rPr lang=\"en-US\"/><a:t>Plain box</a:t></a:r><a:r><a:rPr lang=\"en-US\"><a:hlinkClick r:id=\"rId7\"/>"
           "</a:rPr><a:t> link</a:t></a:r><a:fld id=\"{1}\" type=\"slidenum\"><a:t>&lt;#&gt;</a:t></a:fld></a:p>",
           " txBox=\"1\"") +
        Picture(10, "<a:blip r:embed=\"rId3\"/>") + Picture(11, "<a:blip r:link=\"rId4\"/>") +
        Picture(12, "<a:blip r:embed=\"rId5\"/>") + Picture(13, "<a:blip r:embed=\"rId6\"/>") + groupFixed + table + ole;
    const std::string controls =
        "<p:controls><p:control name=\"CheckBox1\" r:id=\"rId8\"><p:pic><p:nvPicPr><p:cNvPr id=\"60\" name=\"CheckBox1\"/>"
        "<p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed=\"rId6\"/></p:blipFill><p:spPr>" +
        Xfrm(0, 0, 254000, 127000) + "</p:spPr></p:pic></p:control></p:controls>";
    return Part("sld", "<p:cSld>" + Tree(shapes) + controls + "</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>"
                "<p:transition/>");
}

std::string Slide2() {
    // An untyped placeholder with no idx is idx 0: the layout's title.
    // A typed body with no idx is also idx 0, but keeps to the layout's body.
    const std::string shapes =
        Sp(2, "<p:ph/>", "", "<a:p><a:r><a:rPr lang=\"en-US\"/><a:t>Untyped</a:t></a:r></a:p>") +
        Sp(3, "<p:ph type=\"body\"/>", "", "<a:p><a:r><a:rPr lang=\"en-US\"/><a:t>Typed body</a:t></a:r></a:p>");
    return Part("sld", "<p:cSld>" + Tree(shapes) + "</p:cSld>", " show=\"0\"");
}

std::string Notes() {
    const std::string shapes =
        Sp(2, "<p:ph type=\"sldImg\"/>", "", "") +
        Sp(3, "<p:ph type=\"body\" idx=\"1\"/>", "", "<a:p><a:r><a:t>Speaker note</a:t></a:r></a:p>");
    return Part("notes", "<p:cSld>" + Tree(shapes) + "</p:cSld>");
}

struct DeckOptions {
    std::string mainType = "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
    bool macros = false;
};

std::string BuildDeck(const DeckOptions& options = {}) {
    std::vector<TestEntry> entries;
    entries.push_back(
        {"[Content_Types].xml",
         "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
         "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
         "<Default Extension=\"xml\" ContentType=\"application/xml\"/><Default Extension=\"png\" ContentType=\"image/png\"/>"
         "<Default Extension=\"wmf\" ContentType=\"image/x-wmf\"/>"
         "<Override PartName=\"/ppt/presentation.xml\" ContentType=\"" + options.mainType + "\"/></Types>"});
    entries.push_back({"_rels/.rels", Rels({{"rId1", "officeDocument", "ppt/presentation.xml"},
                                            {"rId2", "metadata/core-properties", "docProps/core.xml"}})});
    entries.push_back(
        {"docProps/core.xml",
         "<?xml version=\"1.0\" encoding=\"UTF-8\"?><cp:coreProperties "
         "xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" "
         "xmlns:dc=\"http://purl.org/dc/elements/1.1/\"><dc:title>Test deck</dc:title><dc:creator>Tester</dc:creator>"
         "</cp:coreProperties>"});
    entries.push_back(
        {"ppt/presentation.xml",
         Part("presentation",
              "<p:sldMasterIdLst><p:sldMasterId id=\"2147483648\" r:id=\"rId1\"/></p:sldMasterIdLst>"
              "<p:sldIdLst><p:sldId id=\"256\" r:id=\"rId2\"/><p:sldId id=\"257\" r:id=\"rId3\"/></p:sldIdLst>"
              "<p:sldSz cx=\"9144000\" cy=\"6858000\"/><p:notesSz cx=\"6858000\" cy=\"9144000\"/>"
              "<p:defaultTextStyle><a:lvl1pPr><a:defRPr sz=\"1800\"><a:solidFill><a:schemeClr val=\"tx1\"/></a:solidFill>"
              "<a:latin typeface=\"+mn-lt\"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle>",
              " firstSlideNum=\"5\"")});
    entries.push_back({"ppt/_rels/presentation.xml.rels",
                       Rels({{"rId1", "slideMaster", "slideMasters/slideMaster1.xml"},
                             {"rId2", "slide", "slides/slide1.xml"},
                             {"rId3", "slide", "slides/slide2.xml"},
                             {"rId4", "theme", "theme/theme1.xml"}})});
    entries.push_back({"ppt/theme/theme1.xml", Theme()});
    entries.push_back({"ppt/slideMasters/slideMaster1.xml", Master()});
    entries.push_back({"ppt/slideMasters/_rels/slideMaster1.xml.rels",
                       Rels({{"rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"},
                             {"rId2", "theme", "../theme/theme1.xml"}})});
    entries.push_back({"ppt/slideLayouts/slideLayout1.xml", Layout()});
    entries.push_back({"ppt/slideLayouts/_rels/slideLayout1.xml.rels",
                       Rels({{"rId1", "slideMaster", "../slideMasters/slideMaster1.xml"}})});
    entries.push_back({"ppt/slides/slide1.xml", Slide1()});
    entries.push_back({"ppt/slides/_rels/slide1.xml.rels",
                       Rels({{"rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"},
                             {"rId2", "notesSlide", "../notesSlides/notesSlide1.xml"},
                             {"rId3", "image", "../media/image1.png"},
                             {"rId4", "image", "https://example.invalid/remote.png", "External"},
                             {"rId5", "image", "../media/fake.png"},
                             {"rId6", "image", "../media/control.wmf"},
                             {"rId7", "hyperlink", "https://example.invalid/page", "External"},
                             {"rId8", "control", "../activeX/activeX1.xml"},
                             {"rId9", "package", "../embeddings/sheet.xlsx"}})});
    entries.push_back({"ppt/slides/slide2.xml", Slide2()});
    entries.push_back({"ppt/slides/_rels/slide2.xml.rels",
                       Rels({{"rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"}})});
    entries.push_back({"ppt/notesSlides/notesSlide1.xml", Notes()});
    entries.push_back({"ppt/media/image1.png", kPng});
    entries.push_back({"ppt/media/fake.png", "this is not a picture"});
    entries.push_back({"ppt/media/control.wmf", std::string("\xD7\xCD\xC6\x9A", 4) + std::string(20, '\0')});
    entries.push_back({"ppt/embeddings/sheet.xlsx", "PK"});
    if (options.macros) entries.push_back({"ppt/vbaProject.bin", "macro bytes"});
    return BuildZip(entries);
}

std::string SlideOf(core::Presentation& deck, std::size_t index) {
    std::string json;
    std::string code;
    Expect(deck.SlideJson(index, json, code), "slide " + std::to_string(index + 1) + " builds (" + code + ")");
    return json;
}

void TestDeck() {
    const core::OpenResult result = core::OpenPresentationBytes(BuildDeck());
    Expect(result.ok && result.presentation, "synthetic deck opens: " + result.errorCode + " " + result.errorMessage);
    if (!result.presentation) return;
    core::Presentation& deck = *result.presentation;
    Expect(deck.SlideCount() == 2, "two slides from p:sldIdLst r:id (not the numeric id)");
    const std::string& index = deck.IndexJson();
    ExpectContains(index, "\"slideCount\":2", "index slide count");
    ExpectContains(index, "\"title\":\"Test deck\",\"creator\":\"Tester\"", "index properties");
    ExpectContains(index, "\"code\":\"ole-object\",\"count\":1", "index counts embedded objects");
    ExpectLacks(index, "\"macros\"", "a pptx without a macro part has no macros notice");

    // Nothing is served before a slide that references it is built.
    std::string bytes;
    std::string type;
    Expect(!deck.Media("ppt/media/image1.png", bytes, type), "media is not served before a slide names it");

    const std::string slide = SlideOf(deck, 0);
    ExpectContains(slide, "\"background\":{\"type\":\"solid\",\"color\":\"#abcdef\"}", "background from the master");

    const std::string logo = ShapeJson(slide, 50);
    ExpectContains(logo, "\"layer\":\"master\"", "a master's non-placeholder shape shows, marked as master");
    ExpectContains(logo, "\"color\":\"#ed7d31\"", "master shape fill through the theme");
    ExpectLacks(slide, "Master title", "master placeholders do not show on the slide");

    const std::string title = ShapeJson(slide, 2);
    ExpectContains(title, "\"x\":254000,\"y\":381000,\"w\":7620000,\"h\":1016000", "title box from the layout");
    ExpectContains(title, "\"ph\":\"title\"", "title placeholder type");
    ExpectContains(title, "\"align\":\"ctr\"", "title alignment from the master title style");
    ExpectContains(title, "\"size\":44,\"font\":\"Georgia\",\"color\":\"#112233\"",
                   "title run: master size, theme major font, tx1 through the colour map");

    const std::string body = ShapeJson(slide, 3);
    ExpectContains(body, "\"x\":127000,\"y\":1524000,\"w\":8890000,\"h\":4572000",
                   "body box from the master when the layout has none");
    ExpectContains(body, "\"t\":\"First point\",\"size\":32,\"font\":\"Verdana\"", "body level 1 size and minor font");
    ExpectContains(body, "\"t\":\"Second level\",\"size\":28", "body level 2 size");
    ExpectContains(body, "\"bullet\":{\"char\":\"\xE2\x80\xA2\",\"font\":\"Arial\"", "level 1 bullet character and font");
    ExpectContains(body, "\"bullet\":{\"char\":\"-\"", "level 2 bullet character");
    ExpectContains(body, "\"marL\":342900,\"indent\":-342900", "level 1 indents");

    const std::string box = ShapeJson(slide, 4);
    ExpectContains(box, "\"t\":\"Plain box\",\"size\":18,\"font\":\"Verdana\"",
                   "a text box takes presentation.xml defaultTextStyle, not the master's otherStyle");
    ExpectContains(box, "\"link\":\"https://example.invalid/page\"", "an external hyperlink is kept as a link");
    ExpectContains(box, "\"color\":\"#0563c1\",\"u\":\"sng\"", "a link takes the theme's link colour and an underline");
    ExpectContains(box, "\"t\":\"5\"", "slide number field counts from firstSlideNum");
    ExpectContains(box, "\"field\":\"slidenum\"", "field type is kept");

    const std::string picture = ShapeJson(slide, 10);
    ExpectContains(picture, "\"media\":\"ppt/media/image1.png\"", "embedded picture is named by its part");
    ExpectContains(picture, "\"crop\":[0.1,0,0.2,0]", "picture crop from srcRect");
    const std::string linked = ShapeJson(slide, 11);
    ExpectContains(linked, "\"missing\":\"linked\"", "a linked picture is never fetched");
    ExpectLacks(linked, "example.invalid", "a linked picture's address is not in the model");
    ExpectContains(ShapeJson(slide, 13), "\"missing\":\"metafile\"", "a WMF picture is a metafile placeholder");

    Expect(deck.Media("ppt/media/image1.png", bytes, type) && type == "image/png",
           "a referenced PNG is served after its slide is built");
    Expect(!deck.Media("ppt/media/fake.png", bytes, type), "a part named .png that is not a PNG is not served");
    Expect(!deck.Media("ppt/media/control.wmf", bytes, type), "a metafile is not served");
    Expect(!deck.Media("ppt/slides/slide1.xml", bytes, type), "a non-media part is not served");
    Expect(!deck.Media("https://example.invalid/remote.png", bytes, type), "an external target is not served");

    const std::string child = ShapeJson(slide, 21);
    ExpectContains(child, "\"x\":2857500,\"y\":1905000,\"w\":635000,\"h\":2540000,\"rot\":90",
                   "a child turned 90 degrees takes the group's y scale on its width, centred");

    const std::string table = ShapeJson(slide, 30);
    ExpectContains(table, "\"w\":2540000,\"h\":254000", "a table is as tall as its rows");
    ExpectContains(table, "\"span\":2", "grid span");
    ExpectContains(table, "{\"merged\":true}", "merged cell");

    const std::string ole = ShapeJson(slide, 40);
    ExpectContains(ole, "\"label\":\"Embedded object\",\"media\":\"ppt/media/image1.png\"",
                   "an embedded object shows its stored picture (well-formed JSON)");

    const std::string control = ShapeJson(slide, 60);
    ExpectContains(control, "\"feature\":\"activex\"", "an ActiveX control under p:cSld is drawn as an object");
    ExpectContains(control, "\"missing\":\"metafile\"", "its stored WMF picture is a metafile placeholder");

    const std::string second = SlideOf(deck, 1);
    ExpectContains(second, "\"hidden\":true", "show=0 marks a hidden slide");
    const std::string untyped = ShapeJson(second, 2);
    ExpectContains(untyped, "\"ph\":\"title\"", "an untyped placeholder with no idx takes the title (idx 0)");
    ExpectContains(untyped, "\"size\":44", "and the title style");
    const std::string typed = ShapeJson(second, 3);
    ExpectContains(typed, "\"x\":127000,\"y\":1524000", "a typed body with idx 0 keeps the body box, not the title's");
    ExpectContains(typed, "\"t\":\"Typed body\",\"size\":32", "and the body style");

    std::string json;
    std::string code;
    Expect(!deck.SlideJson(2, json, code) && code == "no-slide", "a slide past the end fails with no-slide");

    const std::string details = deck.DetailsJson();
    ExpectContains(details, "{\"index\":0,\"hidden\":false,\"title\":\"Hello\"", "details title");
    ExpectContains(details, "\"notes\":\"Speaker note\"", "notes from the notes slide body placeholder");
    ExpectContains(details, "First point\\nSecond level", "details text, paragraphs joined by a newline");
    ExpectContains(details, "{\"index\":1,\"hidden\":true", "details hidden flag");
    ExpectContains(details, "\"code\":\"transitions\",\"count\":1", "details count transitions");
}

void TestMacros() {
    DeckOptions pptm;
    pptm.mainType = "application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml";
    const core::OpenResult macroKind = core::OpenPresentationBytes(BuildDeck(pptm));
    Expect(macroKind.presentation != nullptr, "pptm opens");
    if (macroKind.presentation) {
        ExpectContains(macroKind.presentation->IndexJson(), "\"code\":\"macros\"", "a pptm is flagged for macros");
    }
    DeckOptions part;
    part.macros = true;
    const core::OpenResult macroPart = core::OpenPresentationBytes(BuildDeck(part));
    if (macroPart.presentation) {
        ExpectContains(macroPart.presentation->IndexJson(), "\"code\":\"macros\"",
                       "a vbaProject.bin part is flagged for macros");
    }
}

void TestLimits() {
    core::Limits slides;
    slides.maximumSlides = 1;
    const core::OpenResult tooMany = core::OpenPresentationBytes(BuildDeck(), slides);
    ExpectEqual(tooMany.errorCode, "too-many-slides", "the slide limit is enforced at open");

    core::Limits shapes;
    shapes.maximumShapesPerSlide = 3;
    const core::OpenResult opened = core::OpenPresentationBytes(BuildDeck(), shapes);
    Expect(opened.presentation != nullptr, "deck opens under a small shape limit");
    if (opened.presentation) {
        std::string json;
        std::string code;
        Expect(!opened.presentation->SlideJson(0, json, code), "a slide over the shape limit fails");
        ExpectEqual(code, "too-many-shapes", "shape limit error code");
        Expect(opened.presentation->SlideJson(1, json, code), "a slide under the limit still builds");
    }
}

}  // namespace

int main() {
    TestColors();
    TestDeck();
    TestMacros();
    TestLimits();
    std::cout << checks << " checks, " << failures << " failed\n";
    return failures == 0 ? 0 : 1;
}
