# ADR-009 — Build input: paste PoB code and `.xml` upload, both

**Status:** Accepted (2026-08-28)

## Context

Builds reach the tool either as a PoB import code (`base64(zlib(xml))`) or as a raw PoB `.xml`
export. The CLIs already accept both.

## Decision

The web UI accepts both — paste the PoB code and upload the `.xml`. Same "parse in / data out"
contract as the CLIs.

## Consequences

- The API's build-ingest endpoint decodes the paste path and accepts a file upload; both normalise
  to the same stored XML.
- `treeVersion` is read straight off `<Spec treeVersion>` of the **first** `<Spec>` (the one
  `applyPlan` edits).
