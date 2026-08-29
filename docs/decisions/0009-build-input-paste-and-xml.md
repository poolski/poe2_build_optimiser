<!-- generated-by: groundrules v1.10.0 -->
# 0009 — Build input: paste PoB code and `.xml` upload, both

**Date**: 2026-08-28
**Status**: Accepted

## Context

Builds reach the tool either as a PoB import code (`base64(zlib(xml))`) or as a raw PoB `.xml`
export. The CLIs already accept both.

## Decision

The web UI accepts both — paste the PoB code and upload the `.xml`. Same "parse in / data out"
contract as the CLIs.

## Alternatives considered

- **Paste only** — rejected: the `.xml` is what a user has on disk after an export, and the CLIs
  already read it.
- **Fetch by pobb.in / pastebin URL** — deferred: a network dependency for what is otherwise a
  fully local app; no consumer asked for it.

## Consequences

### Neutral
- The API's build-ingest endpoint decodes the paste path and accepts a file upload; both normalise
  to the same stored XML.
- `treeVersion` is read straight off `<Spec treeVersion>` of the **first** `<Spec>` (the one
  `applyPlan` edits).
