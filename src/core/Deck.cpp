#include "core/Deck.h"

#include "core/Zip.h"

namespace leanslides::core::detail {
namespace {

// Placeholder until the deck model lands: an opened, validated package with
// no slides read yet.
class Deck final : public Presentation {
public:
    Deck(std::shared_ptr<const std::string> bytes, const Limits& limits, const OpenResult& result)
        : bytes_(std::move(bytes)), limits_(limits) {
        index_ = "{\"ok\":true,\"kind\":\"";
        index_ += FileKindName(result.kind);
        index_ += "\",\"sourceBytes\":";
        index_ += std::to_string(result.sourceBytes);
        index_ += ",\"slideWidth\":0,\"slideHeight\":0,\"slideCount\":0,\"features\":[],"
                  "\"properties\":{\"title\":\"\",\"creator\":\"\"}}";
    }

    std::size_t SlideCount() const override { return 0; }
    const std::string& IndexJson() const override { return index_; }
    std::string DetailsJson() override { return "{\"slides\":[],\"features\":[]}"; }
    bool SlideJson(std::size_t, std::string& json, std::string& errorCode) override {
        json.clear();
        errorCode = "no-slide";
        return false;
    }
    bool Media(std::string_view, std::string& bytes, std::string& contentType) override {
        bytes.clear();
        contentType.clear();
        return false;
    }

private:
    std::shared_ptr<const std::string> bytes_;
    Limits limits_;
    std::string index_;
};

}  // namespace

std::shared_ptr<Presentation> OpenDeck(
    std::shared_ptr<const std::string> bytes,
    ContentTypes,
    const Limits& limits,
    OpenResult& result,
    Failure&) {
    return std::make_shared<Deck>(std::move(bytes), limits, result);
}

}  // namespace leanslides::core::detail
