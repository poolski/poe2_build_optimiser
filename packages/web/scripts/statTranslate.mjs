// packages/web/scripts/statTranslate.mjs
//
// Pure formatter for RePoE-fork's stat_translations entries:
//   { ids: string[], English: [{ condition, format, index_handlers, string }] }
// See intake/web-ui/10-repoe-asset-source.md "Stat translator" for the spec.

const TAG_RE = /\[([^\]|]+)(?:\|([^\]]+))?\]/g;
const stripTags = (s) => s.replace(TAG_RE, (_, tag, display) => display ?? tag);

const HANDLERS = {
  negate: (v) => -v,
  divide_by_one_hundred_2dp_if_required: (v) => Math.round((v / 100) * 100) / 100,
  divide_by_ten: (v) => v / 10,
  divide_by_one_hundred: (v) => v / 100,
  divide_by_one_thousand: (v) => v / 1000,
  per_minute_to_per_second: (v) => v / 60,
};
const applyHandlers = (v, names) => (names ?? []).reduce((acc, n) => (HANDLERS[n] ? HANDLERS[n](acc) : acc), v);

const applyFormat = (v, fmt) => {
  if (fmt === "ignore") return null;
  if (fmt === "+#") return v >= 0 ? `+${v}` : `${v}`;
  return `${v}`;
};

const inBounds = (v, cond) => {
  if (cond.min !== undefined && v < cond.min) return false;
  if (cond.max !== undefined && v > cond.max) return false;
  return true;
};

/** Does `values[i]` satisfy `line.condition[i]` for every index? */
function lineMatches(line, values) {
  return line.condition.every((cond, i) => inBounds(values[i], cond));
}

function renderLine(line, values) {
  let out = line.string;
  values.forEach((v, i) => {
    const transformed = applyHandlers(v, line.index_handlers[i]);
    const rendered = applyFormat(transformed, line.format[i]);
    if (rendered !== null) out = out.replaceAll(`{${i}}`, rendered);
  });
  return stripTags(out);
}

/**
 * @param {Record<string, number>} statMap - a passive's raw `stats` object
 * @param {Array<{ids: string[], English: Array<{condition: object[], format: string[], index_handlers: string[][], string: string}>}>} entries
 * @returns {string[]} one line per matched entry (first English line whose condition matches
 *   wins), plus a raw "id: value" line for every id in statMap that no entry's `ids` fully covers
 */
export function translateStat(statMap, entries) {
  const covered = new Set();
  const lines = [];

  for (const entry of entries) {
    if (covered.size === Object.keys(statMap).length) break;
    if (!entry.ids.every((id) => id in statMap && !covered.has(id))) continue;
    const values = entry.ids.map((id) => statMap[id]);
    const match = entry.English.find((line) => lineMatches(line, values));
    if (!match) continue;
    lines.push(renderLine(match, values));
    entry.ids.forEach((id) => covered.add(id));
  }

  for (const [id, value] of Object.entries(statMap)) {
    if (!covered.has(id)) lines.push(`${id}: ${value}`);
  }
  return lines;
}
