// Outline numbers for headings: 1, 1.1, 1.1.1 ... counted from the shallowest heading level
// used on the page, so a page that only uses H2 and H3 still starts at 1.
export function numberHeadings(levels) {
  if (!levels.length) return [];
  const base = Math.min(...levels);
  const counters = [0, 0, 0, 0];
  return levels.map((level) => {
    const i = level - 1;
    counters[i] += 1;
    for (let j = i + 1; j < counters.length; j++) counters[j] = 0;
    return counters
      .slice(base - 1, i + 1)
      .map((n) => Math.max(n, 1)) // a skipped level (H1 then H3) counts as 1
      .join('.');
  });
}
