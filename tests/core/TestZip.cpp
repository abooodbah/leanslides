#include "TestZip.h"

#include "miniz.h"

namespace leanslides::tests {
namespace {

void Le16(std::string& output, std::uint32_t value) {
    output += static_cast<char>(value & 0xFF);
    output += static_cast<char>((value >> 8) & 0xFF);
}

void Le32(std::string& output, std::uint32_t value) {
    Le16(output, value & 0xFFFF);
    Le16(output, value >> 16);
}

}  // namespace

std::string Deflate(std::string_view data) {
    std::size_t size = 0;
    void* compressed = tdefl_compress_mem_to_heap(
        data.data(), data.size(), &size, TDEFL_DEFAULT_MAX_PROBES);
    std::string output(static_cast<const char*>(compressed), size);
    mz_free(compressed);
    return output;
}

std::uint32_t Crc32(std::string_view data) {
    return static_cast<std::uint32_t>(mz_crc32(
        MZ_CRC32_INIT, reinterpret_cast<const unsigned char*>(data.data()), data.size()));
}

std::string BuildZip(const std::vector<TestEntry>& entries) {
    std::string output;
    std::string central;
    for (const TestEntry& entry : entries) {
        const std::string payload = entry.deflate ? Deflate(entry.data) : entry.data;
        const std::uint32_t crc =
            entry.crc32 >= 0 ? static_cast<std::uint32_t>(entry.crc32) : Crc32(entry.data);
        const std::uint32_t declared = entry.declaredSize >= 0
                                           ? static_cast<std::uint32_t>(entry.declaredSize)
                                           : static_cast<std::uint32_t>(entry.data.size());
        const std::uint32_t method =
            entry.method >= 0 ? static_cast<std::uint32_t>(entry.method) : (entry.deflate ? 8u : 0u);
        const auto offset = static_cast<std::uint32_t>(output.size());

        Le32(output, 0x04034b50u);
        Le16(output, 20);
        Le16(output, entry.flags);
        Le16(output, method);
        Le16(output, 0);
        Le16(output, 0x21);
        Le32(output, crc);
        Le32(output, static_cast<std::uint32_t>(payload.size()));
        Le32(output, declared);
        Le16(output, static_cast<std::uint32_t>(entry.name.size()));
        Le16(output, 0);
        output += entry.name;
        output += payload;

        Le32(central, 0x02014b50u);
        Le16(central, 20);
        Le16(central, 20);
        Le16(central, entry.flags);
        Le16(central, method);
        Le16(central, 0);
        Le16(central, 0x21);
        Le32(central, crc);
        Le32(central, static_cast<std::uint32_t>(payload.size()));
        Le32(central, declared);
        Le16(central, static_cast<std::uint32_t>(entry.name.size()));
        Le16(central, 0);
        Le16(central, 0);
        Le16(central, 0);
        Le16(central, 0);
        Le32(central, 0);
        Le32(central, offset);
        central += entry.name;
    }
    const auto directoryOffset = static_cast<std::uint32_t>(output.size());
    output += central;
    Le32(output, 0x06054b50u);
    Le16(output, 0);
    Le16(output, 0);
    Le16(output, static_cast<std::uint32_t>(entries.size()));
    Le16(output, static_cast<std::uint32_t>(entries.size()));
    Le32(output, static_cast<std::uint32_t>(central.size()));
    Le32(output, directoryOffset);
    Le16(output, 0);
    return output;
}

}  // namespace leanslides::tests
