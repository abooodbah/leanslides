# LeanSlides: a free, read-only PowerPoint (.pptx) viewer for Windows

LeanSlides opens PowerPoint presentations (`.pptx`, `.ppsx`, `.potx`, and
`.pptm` without running its macros) for reading and presenting. It never runs
macros or embedded objects and never fetches anything the file points to.
MIT licensed, no telemetry.

LeanSlides is in development. There is no release yet; this page will list the
download, what it draws, what it does not, and measured start-up time and
memory once version 0.1.0 is out.

It is the fourth of the Lean apps, small read-only viewers with the same look:
[LeanMark](https://github.com/abooodbah/leanmark) for Markdown,
[LeanDoc](https://github.com/abooodbah/leandoc) for Word documents, and
[LeanRows](https://github.com/abooodbah/leanrows) for large CSV files.

## Source builds

Requirements on Windows: Visual Studio 2022 or newer with the C++ workload,
CMake, and Ninja.

```powershell
scripts\dev-build.cmd Release
ctest --test-dir build\Release --output-on-failure
```

The core in `src/core` is portable C++17 and also builds on Linux:

```sh
cmake -S . -B build/linux -G Ninja -DBUILD_TESTING=ON
cmake --build build/linux && ctest --test-dir build/linux
```

## License

[MIT](LICENSE). Bundled components keep their own licences, listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
