/**
 * Minimal robots.txt parser + matcher, scoped to what the collector needs: rules for a
 * single user-agent group (we only ever care about `*`), `Disallow`/`Allow` with `*`
 * wildcards and an optional trailing `$` end-anchor. No external dependency — this is
 * small enough to hand-roll and test directly against the real fixture in
 * tests/fixtures/bluetokaicoffee.com/robots.txt.
 */

export type RobotsRule = { type: "allow" | "disallow"; pattern: string; regex: RegExp };

/** Converts a robots.txt path pattern (with `*` wildcards and an optional trailing `$`)
 * into an anchored-at-start regex. Every literal segment is escaped; `*` becomes `.*`. */
function patternToRegex(pattern: string): RegExp {
  const hasEndAnchor = pattern.endsWith("$");
  const body = hasEndAnchor ? pattern.slice(0, -1) : pattern;
  const escaped = body
    .split("*")
    .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}${hasEndAnchor ? "$" : ""}`);
}

/**
 * Parses robots.txt text and returns the flattened list of Allow/Disallow rules that
 * apply to `userAgent` (case-insensitive, default `*`). Groups are separated by
 * `User-agent:` lines per the standard; a line's `#` and anything after it is a comment.
 */
export function parseRobots(text: string, userAgent = "*"): RobotsRule[] {
  const wantAgent = userAgent.toLowerCase();
  const lines = text.split(/\r?\n/);

  type Group = { agents: string[]; rules: RobotsRule[] };
  const groups: Group[] = [];
  let current: Group | null = null;
  // Per the spec, a run of consecutive `User-agent:` lines belongs to one group; the
  // first non-agent directive after them closes the group for further agent additions.
  let groupOpenForAgents = false;

  for (const raw of lines) {
    const line = raw.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const sepIdx = line.indexOf(":");
    if (sepIdx === -1) continue;
    const field = line.slice(0, sepIdx).trim().toLowerCase();
    const value = line.slice(sepIdx + 1).trim();

    if (field === "user-agent") {
      if (!current || !groupOpenForAgents) {
        current = { agents: [], rules: [] };
        groups.push(current);
        groupOpenForAgents = true;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }

    if (!current) continue; // directive before any User-agent line: ignore

    if (field === "disallow" || field === "allow") {
      groupOpenForAgents = false;
      if (value === "" && field === "disallow") continue; // "Disallow:" with no value = allow all
      current.rules.push({ type: field, pattern: value, regex: patternToRegex(value) });
    }
    // Crawl-delay, Sitemap, etc. are irrelevant to path matching — ignored.
  }

  return groups.filter((g) => g.agents.includes(wantAgent)).flatMap((g) => g.rules);
}

/**
 * Standard robots.txt precedence: the longest matching pattern wins; Allow beats
 * Disallow on a tie. No matching rule at all means the path is allowed.
 */
export function isPathAllowed(rules: RobotsRule[], pathAndQuery: string): boolean {
  let bestLength = -1;
  let allowed = true;
  for (const rule of rules) {
    if (rule.regex.test(pathAndQuery) && rule.pattern.length >= bestLength) {
      bestLength = rule.pattern.length;
      allowed = rule.type === "allow";
    }
  }
  return allowed;
}
