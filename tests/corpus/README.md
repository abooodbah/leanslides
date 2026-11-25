# Public test corpus

164 public PowerPoint files from the Apache POI and LibreOffice test data.
They are downloaded on demand into `tests/corpus/cache/` (gitignored) and are
never committed.

```sh
node tests/corpus/fetch-corpus.mjs
node tests/corpus/run-corpus.mjs --inspect build/Release/tools/inspect/leanslides-inspect.exe
```

- `manifest.json` lists each file with its raw URL pinned to an upstream
  commit, the source folder, the licence, a note, the error code the core
  should report (empty for none), whether the PowerPoint ground-truth harness
  exports it (`powerpoint`), its size, and its SHA-256.
- `fetch-corpus.mjs` downloads missing files, checks each one against its
  SHA-256, and refuses changed bytes unless run with `--update`.
- `run-corpus.mjs` runs `leanslides-inspect` on each file: the deck index, then
  every slide model. It fails on a crash, a run over 20 s, an error code the
  manifest does not expect, or a slide that does not build, and flags files
  over 2 s. `--markdown` prints a table.

## Sources

| Source | Folder | Commit | Licence | Files |
| --- | --- | --- | --- | ---: |
| [Apache POI](https://github.com/apache/poi) | `test-data/slideshow/` | `4793c3e741c2858bf29e728f13f617ee784243f4` | Apache-2.0 | 100 |
| [LibreOffice](https://github.com/LibreOffice/core) | `sd/qa/unit/data/pptx/` | `88289f1ea16f267c3f0438ff3bb72b33318da285` | MPL-2.0 | 64 |

All 100 PowerPoint files in the POI folder are listed. The LibreOffice files
are the 64 whose names describe one feature that 0.1.0 draws or reports
(placeholders, colour maps, bullets, autofit, crops, custom geometry, groups,
tables, notes, SmartArt, OLE, and media). The numbered bug files are not
listed yet. The licence is the licence of the repository that publishes the
file.

Twelve files are expected to fail with `corrupt-zip`: the eleven POI fuzzer
files, and `Divino_Revelado.pptx`, which is truncated upstream (it ends inside
a part and has no central directory). These twelve are left out of the
PowerPoint harness, because PowerPoint's repair prompts can stop automation.
