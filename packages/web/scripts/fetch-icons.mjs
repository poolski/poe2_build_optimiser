// packages/web/scripts/fetch-icons.mjs
//
// Downloads the unique node icons referenced by tree-0_5.min.json's iconIdx field. The
// image.ggpk.exposed host serves real PNG bytes for a .dds-suffixed path (verified 2026-08-30 --
// content-type: image/png) -- no DDS decode needed, just fetch and write with a swapped
// extension. A bad/unknown path returns HTTP 500 (verified), not 404 -- treat any non-ok
// response as a failure.
//
//   node packages/web/scripts/fetch-icons.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://image.ggpk.exposed/poe2";
const CONCURRENCY = 8;

export function iconPathsFromTree(minTreeFile) {
  const paths = new Set();
  for (const t of Object.values(minTreeFile.nodes)) {
    const iconIdx = t[8];
    if (iconIdx === undefined) continue;
    const path = minTreeFile.strings[iconIdx];
    if (path) paths.add(path);
  }
  return [...paths].sort();
}

export async function fetchIcons(iconPaths, destRoot, fetchImpl) {
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  const failedPaths = [];
  let cursor = 0;

  async function worker() {
    while (cursor < iconPaths.length) {
      const path = iconPaths[cursor++];
      const dest = join(destRoot, path.replace(/\.dds$/i, ".png"));
      if (existsSync(dest)) {
        skipped++;
        continue;
      }
      try {
        const res = await fetchImpl(`${BASE}/${path}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, buf);
        downloaded++;
      } catch (err) {
        failed++;
        failedPaths.push({ path, error: String(err) });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, iconPaths.length) || 1 }, worker));
  return { downloaded, skipped, failed, failedPaths };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const here = dirname(fileURLToPath(import.meta.url));
  const minTreeFile = JSON.parse(readFileSync(resolve(here, "../public/tree-0_5.min.json"), "utf-8"));
  const paths = iconPathsFromTree(minTreeFile);
  const destRoot = resolve(here, "../public/icons/tree");
  const result = await fetchIcons(paths, destRoot, fetch);
  console.log(
    `icons: ${paths.length} unique  downloaded: ${result.downloaded}  skipped: ${result.skipped}  failed: ${result.failed}`,
  );
  if (result.failed) {
    console.log(result.failedPaths);
    process.exit(1);
  }
}
