#include "core/Deck.h"

#include <mutex>

#include "core/DeckTypes.h"
#include "core/Zip.h"

namespace leanslides::core::detail {
namespace {

void AppendFeatures(std::string& out, const FeatureCounter& counts) {
    out += '[';
    bool first = true;
    for (const auto& [feature, count] : counts) {
        if (count == 0) continue;
        if (!first) out += ',';
        first = false;
        const FeatureLabel label = LabelFor(feature);
        out += "{\"code\":\"";
        out += FeatureCode(feature);
        out += "\",\"count\":";
        out += std::to_string(count);
        out += ",\"notDrawn\":";
        out += FeatureIsNotDrawn(feature) ? "true" : "false";
        out += ",\"singular\":\"";
        AppendJsonString(out, label.singular);
        out += "\",\"plural\":\"";
        AppendJsonString(out, label.plural);
        out += "\"}";
    }
    out += ']';
}

void AppendQuoted(std::string& out, std::string_view value) {
    out += '"';
    AppendJsonString(out, value);
    out += '"';
}

// Text of every text body under `node`, in document order, one per line.
void GatherText(pugi::xml_node node, std::string& text) {
    ForEachChild(node, [&](pugi::xml_node child) {
        if (Is(child, "txBody")) {
            const std::string body = TextOfBody(child);
            if (!body.empty()) {
                if (!text.empty()) text += '\n';
                text += body;
            }
            return;
        }
        GatherText(child, text);
    });
}

bool IsMediaSignature(std::string_view bytes, std::string& contentType) {
    const auto starts = [&](std::string_view prefix) {
        return bytes.size() >= prefix.size() && bytes.substr(0, prefix.size()) == prefix;
    };
    if (starts(std::string_view("\x89PNG\r\n\x1a\n", 8))) contentType = "image/png";
    else if (starts(std::string_view("\xFF\xD8\xFF", 3))) contentType = "image/jpeg";
    else if (starts("GIF87a") || starts("GIF89a")) contentType = "image/gif";
    else if (starts("BM")) contentType = "image/bmp";
    else return false;
    return true;
}

class Deck final : public Presentation {
public:
    Deck(std::shared_ptr<const std::string> bytes, ContentTypes types, const Limits& limits,
         FileKind kind)
        : bytes_(std::move(bytes)), types_(std::move(types)), limits_(limits), zip_(limits_),
          kind_(kind) {}

    bool Open(OpenResult& result, Failure& failure) {
        if (!zip_.Open(*bytes_, failure)) return false;
        if (!LoadPart(types_.mainPart, presentation_, true, failure)) {
            if (!failure.Failed()) {
                failure.Set("missing-main-part", "This file does not contain a PowerPoint presentation part.");
            }
            return false;
        }
        const pugi::xml_node root = presentation_.root;
        const pugi::xml_node size = Child(root, "sldSz");
        context_.slideWidth = std::max<long long>(1, AttrInt(size, "cx", 9144000));
        context_.slideHeight = std::max<long long>(1, AttrInt(size, "cy", 6858000));
        context_.firstSlideNumber = AttrInt(root, "firstSlideNum", 1);
        context_.defaultTextStyle = Child(root, "defaultTextStyle");
        context_.zip = &zip_;
        context_.types = &types_;
        context_.limits = &limits_;
        context_.servableMedia = &servable_;
        context_.features = &builtFeatures_;

        for (pugi::xml_node id = Child(Child(root, "sldIdLst"), "sldId"); id; id = id.next_sibling()) {
            if (!Is(id, "sldId")) continue;
            const Relationship* relationship = presentation_.rels.ById(RelAttr(id, "id"));
            if (relationship == nullptr || relationship->partName.empty()) continue;
            if (slides_.size() >= limits_.maximumSlides) {
                failure.Set("too-many-slides", "This presentation has more slides than LeanSlides opens.");
                return false;
            }
            slides_.push_back({relationship->partName});
        }

        if (const Relationship* styles = presentation_.rels.FirstOfTail("tablestyles")) {
            Failure ignored;
            if (!styles->partName.empty() && LoadPart(styles->partName, tableStyles_, false, ignored)) {
                context_.tableStyles = tableStyles_.root;
            }
        }
        if (Child(root, "embeddedFontLst")) {
            std::uint32_t fonts = 0;
            for (pugi::xml_node font = Child(Child(root, "embeddedFontLst"), "embeddedFont"); font;
                 font = font.next_sibling()) {
                if (Is(font, "embeddedFont")) ++fonts;
            }
            packageFeatures_[Feature::EmbeddedFonts] = fonts;
        }
        CountPackageFeatures();
        BuildIndex(result);
        return true;
    }

    std::size_t SlideCount() const override { return slides_.size(); }
    const std::string& IndexJson() const override { return index_; }

    std::string DetailsJson() override {
        std::lock_guard<std::mutex> lock(mutex_);
        FeatureCounter counts;
        std::string out = "{\"slides\":[";
        for (std::size_t index = 0; index < slides_.size(); ++index) {
            if (index) out += ',';
            LoadedPart slide;
            Failure failure;
            const bool loaded = LoadPart(slides_[index].partName, slide, true, failure);
            std::string title, text, notes;
            bool hidden = false;
            if (loaded) {
                hidden = AttrText(slide.root, "show") == "0";
                const pugi::xml_node tree = Child(Child(slide.root, "cSld"), "spTree");
                GatherText(tree, text);
                ForEachChild(tree, [&](pugi::xml_node shape) {
                    std::string type;
                    long long idx = -1;
                    if (title.empty() && Is(shape, "sp") && PlaceholderOf(shape, type, idx) &&
                        (type == "title" || type == "ctrTitle")) {
                        title = TextOfBody(Child(shape, "txBody"));
                    }
                });
                if (Child(slide.root, "transition")) ++counts[Feature::Transitions];
                if (Child(slide.root, "timing")) ++counts[Feature::Animations];
                notes = NotesText(slide);
            }
            out += "{\"index\":";
            out += std::to_string(index);
            out += ",\"hidden\":";
            out += hidden ? "true" : "false";
            out += ",\"title\":";
            AppendQuoted(out, title);
            out += ",\"text\":";
            AppendQuoted(out, text);
            out += ",\"notes\":";
            AppendQuoted(out, notes);
            out += '}';
        }
        out += "],\"features\":";
        AppendFeatures(out, counts);
        out += '}';
        return out;
    }

    bool SlideJson(std::size_t index, std::string& json, std::string& errorCode) override {
        std::lock_guard<std::mutex> lock(mutex_);
        json.clear();
        errorCode.clear();
        if (index >= slides_.size()) {
            errorCode = "no-slide";
            return false;
        }
        LoadedPart slide;
        Failure failure;
        if (!LoadPart(slides_[index].partName, slide, true, failure)) {
            errorCode = failure.Failed() ? failure.code : "read-failed";
            return false;
        }
        const Layout& layout = LayoutFor(slide);
        if (!BuildSlideJson(context_, slide, layout, index, json, failure)) {
            json.clear();
            errorCode = failure.Failed() ? failure.code : "read-failed";
            return false;
        }
        return true;
    }

    bool Media(std::string_view id, std::string& bytes, std::string& contentType) override {
        std::lock_guard<std::mutex> lock(mutex_);
        bytes.clear();
        contentType.clear();
        const std::string name(id);
        if (servable_.count(name) == 0) return false;
        const ZipEntry* entry = zip_.Find(name);
        if (entry == nullptr) return false;
        Failure failure;
        if (!zip_.Read(*entry, bytes, failure) || !IsMediaSignature(bytes, contentType)) {
            bytes.clear();
            contentType.clear();
            return false;
        }
        return true;
    }

private:
    bool LoadPart(const std::string& name, LoadedPart& part, bool withRelationships, Failure& failure) {
        const ZipEntry* entry = zip_.Find(name);
        if (entry == nullptr) return false;
        if (!ReadXml(zip_, *entry, limits_, part.xml, failure)) return false;
        part.name = name;
        part.root = part.xml.document.document_element();
        if (withRelationships && !ReadRelationships(zip_, limits_, name, part.rels, failure)) return false;
        return true;
    }

    // A part kept for the life of the deck (themes, masters, layouts).
    const LoadedPart* KeepPart(const std::string& name) {
        const auto found = kept_.find(name);
        if (found != kept_.end()) return found->second.get();
        auto part = std::make_unique<LoadedPart>();
        Failure failure;
        if (!LoadPart(name, *part, true, failure)) part = std::make_unique<LoadedPart>();
        const LoadedPart* pointer = part.get();
        kept_.emplace(name, std::move(part));
        return pointer;
    }

    static void ReadPlaceholders(pugi::xml_node root, std::vector<Placeholder>& list) {
        ForEachChild(Child(Child(root, "cSld"), "spTree"), [&](pugi::xml_node shape) {
            Placeholder placeholder;
            if (PlaceholderOf(shape, placeholder.type, placeholder.idx)) {
                placeholder.shape = shape;
                list.push_back(std::move(placeholder));
            }
        });
    }

    const Theme& ThemeFor(const std::string& name) {
        const auto found = themes_.find(name);
        if (found != themes_.end()) return *found->second;
        auto theme = std::make_unique<Theme>();
        theme->part = name.empty() ? &empty_ : KeepPart(name);
        const pugi::xml_node elements = Child(theme->part->root, "themeElements");
        const ColorContext none;
        for (pugi::xml_node color = Child(elements, "clrScheme").first_child(); color;
             color = color.next_sibling()) {
            if (color.type() != pugi::node_element) continue;
            if (auto value = ResolveColorIn(color, none)) {
                theme->colors[LocalName(color.name())] = *value;
            }
        }
        const pugi::xml_node fonts = Child(elements, "fontScheme");
        const auto read = [](pugi::xml_node font, std::string& latin, std::string& ea, std::string& cs) {
            latin = std::string(AttrText(Child(font, "latin"), "typeface"));
            ea = std::string(AttrText(Child(font, "ea"), "typeface"));
            cs = std::string(AttrText(Child(font, "cs"), "typeface"));
        };
        read(Child(fonts, "majorFont"), theme->majorLatin, theme->majorEa, theme->majorCs);
        read(Child(fonts, "minorFont"), theme->minorLatin, theme->minorEa, theme->minorCs);
        if (theme->majorLatin.empty()) theme->majorLatin = "Calibri Light";
        if (theme->minorLatin.empty()) theme->minorLatin = "Calibri";
        const pugi::xml_node format = Child(elements, "fmtScheme");
        const auto list = [](pugi::xml_node parent, std::vector<pugi::xml_node>& out) {
            for (pugi::xml_node child = parent.first_child(); child; child = child.next_sibling()) {
                if (child.type() == pugi::node_element) out.push_back(child);
            }
        };
        list(Child(format, "fillStyleLst"), theme->fills);
        list(Child(format, "bgFillStyleLst"), theme->bgFills);
        list(Child(format, "lnStyleLst"), theme->lines);
        const Theme& reference = *theme;
        themes_.emplace(name, std::move(theme));
        return reference;
    }

    const Master& MasterFor(const std::string& name) {
        const auto found = masters_.find(name);
        if (found != masters_.end()) return *found->second;
        auto master = std::make_unique<Master>();
        master->part = name.empty() ? &empty_ : KeepPart(name);
        const Relationship* theme = master->part->rels.FirstOfTail("theme");
        master->theme = &ThemeFor(theme ? theme->partName : std::string());
        // The default map when the master has none.
        master->clrMap = {{"bg1", "lt1"}, {"tx1", "dk1"}, {"bg2", "lt2"}, {"tx2", "dk2"},
                          {"accent1", "accent1"}, {"accent2", "accent2"}, {"accent3", "accent3"},
                          {"accent4", "accent4"}, {"accent5", "accent5"}, {"accent6", "accent6"},
                          {"hlink", "hlink"}, {"folHlink", "folHlink"}};
        const pugi::xml_node map = Child(master->part->root, "clrMap");
        for (pugi::xml_attribute attribute = map.first_attribute(); attribute;
             attribute = attribute.next_attribute()) {
            master->clrMap[LocalName(attribute.name())] = attribute.value();
        }
        const pugi::xml_node styles = Child(master->part->root, "txStyles");
        master->titleStyle = Child(styles, "titleStyle");
        master->bodyStyle = Child(styles, "bodyStyle");
        master->otherStyle = Child(styles, "otherStyle");
        ReadPlaceholders(master->part->root, master->placeholders);
        const Master& reference = *master;
        masters_.emplace(name, std::move(master));
        return reference;
    }

    const Layout& LayoutFor(const LoadedPart& slide) {
        const Relationship* relationship = slide.rels.FirstOfTail("slidelayout");
        const std::string name = relationship ? relationship->partName : std::string();
        const auto found = layouts_.find(name);
        if (found != layouts_.end()) return *found->second;
        auto layout = std::make_unique<Layout>();
        layout->part = name.empty() ? &empty_ : KeepPart(name);
        const Relationship* master = layout->part->rels.FirstOfTail("slidemaster");
        std::string masterName = master ? master->partName : std::string();
        if (masterName.empty()) {
            // A slide without a layout still takes the first master's theme.
            if (const Relationship* first = presentation_.rels.FirstOfTail("slidemaster")) {
                masterName = first->partName;
            }
        }
        layout->master = &MasterFor(masterName);
        layout->showMasterShapes = AttrBool(layout->part->root, "showMasterSp", true);
        ReadPlaceholders(layout->part->root, layout->placeholders);
        const Layout& reference = *layout;
        layouts_.emplace(name, std::move(layout));
        return reference;
    }

    std::string NotesText(const LoadedPart& slide) {
        const Relationship* relationship = slide.rels.FirstOfTail("notesslide");
        if (relationship == nullptr || relationship->partName.empty()) return {};
        LoadedPart notes;
        Failure failure;
        if (!LoadPart(relationship->partName, notes, false, failure)) return {};
        std::string text;
        ForEachChild(Child(Child(notes.root, "cSld"), "spTree"), [&](pugi::xml_node shape) {
            std::string type;
            long long idx = -1;
            if (Is(shape, "sp") && PlaceholderOf(shape, type, idx) && type == "body") {
                const std::string body = TextOfBody(Child(shape, "txBody"));
                if (!body.empty()) {
                    if (!text.empty()) text += '\n';
                    text += body;
                }
            }
        });
        return text;
    }

    void CountPackageFeatures() {
        if (kind_ == FileKind::Pptm || kind_ == FileKind::Ppsm || kind_ == FileKind::Potm) {
            packageFeatures_[Feature::Macros] = 1;
        }
        for (const ZipEntry& entry : zip_.Entries()) {
            const std::string name = LowercaseAscii(entry.name);
            const std::string type = LowercaseAscii(types_.TypeOf(entry.name));
            if (EndsWith(name, "vbaproject.bin")) {
                packageFeatures_[Feature::Macros] = 1;
            } else if (StartsWith(name, "ppt/charts/chart") && EndsWith(name, ".xml")) {
                ++packageFeatures_[Feature::Chart];
            } else if (StartsWith(name, "ppt/charts/chartex") && EndsWith(name, ".xml")) {
                ++packageFeatures_[Feature::Chart];
            } else if (StartsWith(name, "ppt/embeddings/")) {
                ++packageFeatures_[Feature::OleObject];
            } else if (StartsWith(name, "ppt/activex/") && EndsWith(name, ".xml")) {
                ++packageFeatures_[Feature::ActiveX];
            } else if ((StartsWith(name, "ppt/comments/") && EndsWith(name, ".xml")) ||
                       type.find("comments+xml") != std::string::npos) {
                ++packageFeatures_[Feature::Comments];
            } else if (StartsWith(type, "video/")) {
                ++packageFeatures_[Feature::Video];
            } else if (StartsWith(type, "audio/")) {
                ++packageFeatures_[Feature::Audio];
            }
        }
        // Comment parts that are only authors lists say nothing on their own.
        for (const auto& entry : zip_.Entries()) {
            const std::string name = LowercaseAscii(entry.name);
            if (name == "ppt/commentauthors.xml" && packageFeatures_[Feature::Comments] > 0) {
                --packageFeatures_[Feature::Comments];
            }
        }
    }

    void BuildIndex(const OpenResult& result) {
        std::string title, creator;
        LoadedPart core;
        Failure failure;
        if (LoadPart("docProps/core.xml", core, false, failure)) {
            title = Child(core.root, "title").child_value();
            creator = Child(core.root, "creator").child_value();
        }
        index_ = "{\"ok\":true,\"kind\":\"";
        index_ += FileKindName(kind_);
        index_ += "\",\"sourceBytes\":";
        index_ += std::to_string(result.sourceBytes);
        index_ += ",\"slideWidth\":";
        index_ += std::to_string(context_.slideWidth);
        index_ += ",\"slideHeight\":";
        index_ += std::to_string(context_.slideHeight);
        index_ += ",\"slideCount\":";
        index_ += std::to_string(slides_.size());
        index_ += ",\"features\":";
        AppendFeatures(index_, packageFeatures_);
        index_ += ",\"properties\":{\"title\":";
        AppendQuoted(index_, title);
        index_ += ",\"creator\":";
        AppendQuoted(index_, creator);
        index_ += "}}";
    }

    std::shared_ptr<const std::string> bytes_;
    ContentTypes types_;
    Limits limits_;
    ZipReader zip_;
    FileKind kind_;
    std::mutex mutex_;

    LoadedPart presentation_;
    LoadedPart tableStyles_;
    LoadedPart empty_;
    DeckContext context_;
    std::vector<SlideEntry> slides_;
    std::map<std::string, std::unique_ptr<LoadedPart>> kept_;
    std::map<std::string, std::unique_ptr<Theme>> themes_;
    std::map<std::string, std::unique_ptr<Master>> masters_;
    std::map<std::string, std::unique_ptr<Layout>> layouts_;
    std::set<std::string> servable_;
    FeatureCounter packageFeatures_;
    FeatureCounter builtFeatures_;
    std::string index_;
};

}  // namespace

std::shared_ptr<Presentation> OpenDeck(
    std::shared_ptr<const std::string> bytes,
    ContentTypes types,
    const Limits& limits,
    OpenResult& result,
    Failure& failure) {
    auto deck = std::make_shared<Deck>(std::move(bytes), std::move(types), limits, result.kind);
    if (!deck->Open(result, failure)) {
        if (!failure.Failed()) failure.Set("read-failed", "LeanSlides could not read this presentation.");
        return nullptr;
    }
    return deck;
}

}  // namespace leanslides::core::detail
