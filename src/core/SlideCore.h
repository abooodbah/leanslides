#pragma once

// LeanSlides' portable core. This header is the contract between the core, the
// native host, and the leanslides-inspect command-line tool. The host never
// parses a presentation itself: it reads the file, calls OpenPresentation(),
// serves the deck index, one slide model at a time, and the pictures the
// slide models name.
//
// The core never performs I/O other than reading the one requested file, never
// follows a relationship outside the package, and never executes anything.
// Macros, OLE objects, ActiveX controls, and linked media are never loaded.

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

namespace leanslides::core {

// Every bound is checked before memory is committed. A presentation that
// exceeds a limit fails closed with a named error; it is never partially shown.
struct Limits {
    std::uint64_t maximumInputBytes = 512ull * 1024ull * 1024ull;
    std::uint32_t maximumEntries = 16384;
    std::uint64_t maximumPartBytes = 128ull * 1024ull * 1024ull;
    std::uint64_t maximumTotalUncompressedBytes = 1024ull * 1024ull * 1024ull;
    // Applies to entries whose uncompressed size exceeds 1 MiB.
    std::uint32_t maximumCompressionRatio = 100;
    std::uint32_t maximumXmlDepth = 256;
    std::uint32_t maximumSlides = 5000;
    // Shapes per slide, counting the shapes inside groups.
    std::uint32_t maximumShapesPerSlide = 20000;
};

enum class FileKind {
    Pptx,              // presentationml.presentation.main+xml
    Ppsx,              // presentationml.slideshow.main+xml
    Potx,              // presentationml.template.main+xml
    Pptm,              // ms-powerpoint.presentation.macroEnabled.main+xml
    Ppsm,              // ms-powerpoint.slideshow.macroEnabled.main+xml
    Potm,              // ms-powerpoint.template.macroEnabled.main+xml
    LegacyPpt,         // OLE compound file with a "PowerPoint Document" stream (97-2003)
    EncryptedOoxml,    // OLE compound file holding EncryptionInfo + EncryptedPackage
    Odp,               // ZIP whose "mimetype" entry is application/vnd.oasis.opendocument.presentation
    NotAPresentation,  // anything else, including other OOXML (docx, xlsx)
};

// True for kinds the reader shows. The rest get a page that says what the
// file is and offers the "open in editor" action.
bool IsRenderableKind(FileKind kind);
const char* FileKindName(FileKind kind);  // "pptx", "legacy-ppt", ...

// Stable feature codes. The reader and leanslides-inspect use the code; the
// wording lives in FeatureLabel so the notice bar, the CLI, and the tests agree.
enum class Feature {
    // Content LeanSlides does not draw. Each one shows the picture the file
    // stores for it when there is one, otherwise a labelled placeholder.
    Chart,            // c:chart and chartex frames
    SmartArt,         // dgm:relIds frames without a stored drawing
    OleObject,        // p:oleObj (embedded or linked objects)
    Video,            // videoFile, or media with a video relationship
    Audio,            // audioFile, wavAudioFile, or media with an audio relationship
    Model3D,          // am3d model frames
    Ink,              // contentPart ink
    Equation,         // a14:m math without a stored picture
    Metafile,         // EMF or WMF pictures, which the web runtime cannot draw
    UnsupportedImage, // TIFF and other formats the web runtime cannot draw
    // Present, handled safely, and disclosed.
    Macros,           // vbaProject.bin or a macro-enabled content type (never run)
    LinkedMedia,      // pictures, media, and objects linked outside the file (never fetched)
    EmbeddedFonts,    // p:embeddedFontLst (not loaded; system fonts are used)
    Comments,         // comment parts (not shown)
    Animations,       // p:timing on a slide (not played)
    Transitions,      // p:transition on a slide (not played)
    ActiveX,          // p:controls (never run)
};

const char* FeatureCode(Feature feature);     // "chart", "macros", ...
bool FeatureIsNotDrawn(Feature feature);      // true for the first group
struct FeatureLabel {
    const char* singular;
    const char* plural;
};
FeatureLabel LabelFor(Feature feature);

struct FeatureCount {
    Feature feature;
    std::uint32_t count = 0;
};

// The result of opening a file. The deck keeps the file's bytes and the
// parsed theme, masters, and layouts; slide models are built on request.
class Presentation;

struct OpenResult {
    // True when the core read the file without an error. Recognised kinds the
    // reader does not show (legacy-ppt, encrypted-ooxml, odp) are ok with no
    // presentation; not-a-presentation is never ok.
    bool ok = false;
    // Stable error code: "too-large", "not-a-zip", "corrupt-zip",
    // "too-many-entries", "part-too-large", "compression-ratio",
    // "unsafe-entry-name", "duplicate-entry", "encrypted-entry",
    // "missing-main-part", "too-many-slides", "xml-doctype", "xml-malformed",
    // "xml-too-deep", "read-failed". Empty when ok.
    std::string errorCode;
    std::string errorMessage;  // one plain sentence for the reader
    FileKind kind = FileKind::NotAPresentation;
    std::uint64_t sourceBytes = 0;
    // Set when ok and IsRenderableKind(kind).
    std::shared_ptr<Presentation> presentation;
};

// Classifies by content, never by extension alone.
FileKind DetectKind(std::string_view bytes);

// Takes ownership of the bytes: the presentation reads parts from them later.
OpenResult OpenPresentationBytes(std::string bytes, const Limits& limits = {});

// Reads a regular file (no directories, devices, or FIFOs) within
// limits.maximumInputBytes and calls OpenPresentationBytes().
OpenResult OpenPresentationFile(
    const std::filesystem::path& path,
    const Limits& limits = {});

// Extensions LeanSlides registers for: .pptx .ppsx .potx .pptm .ppsm .potm
// .ppt .odp.
bool IsSupportedPresentationPath(const std::filesystem::path& path);

class Presentation {
public:
    virtual ~Presentation() = default;

    virtual std::size_t SlideCount() const = 0;

    // The deck index as one JSON object, built once at open. Shape:
    // {"ok":true,"kind":str,"sourceBytes":num,
    //  "slideWidth":num,"slideHeight":num,           (EMU)
    //  "slides":[{"index":num,"hidden":bool,"title":str,"text":str,"notes":str}],
    //  "features":[{"code":str,"count":num,"notDrawn":bool,"singular":str,"plural":str}],
    //  "properties":{"title":str,"creator":str}}
    // "text" and "notes" are each slide's plain text, used for find, copy,
    // and the notes panel; paragraphs are separated by "\n".
    virtual const std::string& IndexJson() const = 0;

    // One slide's resolved model (placeholders inherited from layout and
    // master, theme colours and fonts resolved), as described in
    // docs/MODEL.md. Returns false with an error code when the slide part
    // cannot be read; the reader then shows that slide as failed.
    virtual bool SlideJson(std::size_t index, std::string& json, std::string& errorCode) = 0;

    // The bytes and content type of a picture a slide model names by its
    // "media" id. Only pictures that a built slide model references, and
    // whose bytes sniff as PNG, JPEG, GIF, or BMP, are served.
    virtual bool Media(std::string_view id, std::string& bytes, std::string& contentType) = 0;
};

// The report for a file that is not shown (or failed), as JSON with the same
// "ok", "errorCode", "errorMessage", "kind", "sourceBytes" keys as the index.
std::string FailureJson(const OpenResult& result);

bool IsPathWithin(
    const std::filesystem::path& root,
    const std::filesystem::path& candidate);
void AppendJsonString(std::string& output, std::string_view value);
std::string EscapeJsonString(std::string_view value);

}  // namespace leanslides::core
