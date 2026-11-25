// Lists the DLLs a Windows executable imports and fails if any of them is
// the Visual C++ runtime (vcruntime*, msvcp*, concrt*, vccorlib*) or the
// redistributable C runtime (api-ms-win-crt-*, ucrtbase). LeanSlides links
// the C and C++ runtimes statically, so it starts on a PC that has never
// installed the Visual C++ Redistributable.
//
//   node tests/hosts/check-imports.mjs build/Release/LeanSlides.exe [more.exe ...]
import { readFileSync } from "node:fs";

const RUNTIME = /^(vcruntime|msvcp|concrt|vccorlib|ucrtbase|api-ms-win-crt-)/i;

// The names in the import directory of a PE32+ or PE32 image.
export function importedDlls(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0, true) !== 0x5a4d) throw new Error("not an MZ executable");
  const pe = view.getUint32(0x3c, true);
  if (view.getUint32(pe, true) !== 0x4550) throw new Error("no PE signature");
  const sections = view.getUint16(pe + 6, true);
  const optionalSize = view.getUint16(pe + 20, true);
  const optional = pe + 24;
  const magic = view.getUint16(optional, true);
  const directories = optional + (magic === 0x20b ? 112 : 96);
  const importRva = view.getUint32(directories + 8, true);
  const sectionTable = optional + optionalSize;
  const toOffset = (rva) => {
    for (let i = 0; i < sections; i += 1) {
      const s = sectionTable + i * 40;
      const virtualAddress = view.getUint32(s + 12, true);
      const size = Math.max(view.getUint32(s + 8, true), view.getUint32(s + 16, true));
      if (rva >= virtualAddress && rva < virtualAddress + size) {
        return rva - virtualAddress + view.getUint32(s + 20, true);
      }
    }
    throw new Error(`address ${rva} is in no section`);
  };
  const names = [];
  if (!importRva) return names;
  for (let entry = toOffset(importRva); ; entry += 20) {
    const nameRva = view.getUint32(entry + 12, true);
    if (!nameRva) break;
    let at = toOffset(nameRva);
    let name = "";
    while (bytes[at]) name += String.fromCharCode(bytes[at++]);
    names.push(name);
  }
  return names;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  let failed = false;
  for (const file of process.argv.slice(2)) {
    const dlls = importedDlls(readFileSync(file));
    const runtime = dlls.filter((name) => RUNTIME.test(name));
    console.log(`${file}: ${dlls.join(", ")}`);
    if (runtime.length) {
      console.log(`  imports the C runtime: ${runtime.join(", ")}`);
      failed = true;
    }
  }
  process.exit(failed ? 1 : 0);
}
