import type { TCampaignGeoRule } from "./schema";
import { demographicSchema } from "./zod-schemas/demographic";

// ─────────────────────────────────────────────────────────────────────────────
// GEO PAYOUT RULE EVALUATION
//
// Pure functions — no database, no clock, no side effects — so the money
// decision can be unit-tested directly and reasoned about in isolation. The
// caller supplies an already-APPROVED audience report; deciding which report
// counts as approved (and whether the account is banned/deleted/disconnected)
// belongs to the caller, not here.
//
// Every function degrades to "no bonus" rather than guessing. An unreadable or
// missing report must never invent a rate — the fallback is real money.
// ─────────────────────────────────────────────────────────────────────────────

export type AudienceCountry = { country: string; percentage: number };

/**
 * Read the country breakdown out of a demographics_verifications_v2
 * `parsed_data` blob. Returns null when the column is empty or doesn't match
 * the versioned shape, so callers can distinguish "no report" from "0%".
 */
export function readAudienceCountries(
  parsedData: unknown
): AudienceCountry[] | null {
  if (parsedData == null) return null;

  const parsed = demographicSchema.safeParse(parsedData);
  if (!parsed.success) return null;

  // Read `countries` off the parsed value directly rather than narrowing with
  // Extract<DemographicData, { version: "v1" }>. The frontend's tsconfig also
  // compiles this file (it imports backend types) and resolves that Extract to
  // `never`, which fails the build there while passing in the backend. The
  // schema has already validated the shape by this point, so the cast is
  // narrow and safe.
  const data = parsed.data as { countries?: AudienceCountry[] };
  return data.countries ?? null;
}

// Country names are compared case-insensitively and trimmed. Both the rule and
// the report are authored against the same countrySchema enum, but a report can
// arrive from an older row or an API parse, and an exact === would silently
// score 0% and quietly withhold a bonus the clipper earned.
const normalize = (country: string) => country.trim().toLowerCase();

const percentageFor = (
  audience: AudienceCountry[],
  country: string
): number => {
  const target = normalize(country);
  // Sum rather than find: a malformed report listing a country twice must not
  // silently drop one of the entries.
  return audience
    .filter((entry) => normalize(entry.country) === target)
    .reduce((total, entry) => total + (Number(entry.percentage) || 0), 0);
};

/** Combined audience share across every country named by a rule. */
export function combinedShare(
  audience: AudienceCountry[],
  countries: { country: string }[]
): number {
  // De-duplicate the rule's own country list first, so a rule that names the
  // same country twice can't double-count its way past the threshold.
  const seen = new Set<string>();
  let total = 0;
  for (const entry of countries) {
    const key = normalize(entry.country);
    if (seen.has(key)) continue;
    seen.add(key);
    total += percentageFor(audience, entry.country);
  }
  return total;
}

/**
 * Does this account's audience satisfy this rule?
 *
 *   combined — the named countries are SUMMED and compared once against
 *              min_combined_percentage.
 *   each     — every country carries its own min_percentage and ALL must pass.
 *
 * A rule with no countries never qualifies: an empty list would otherwise sum
 * to 0 and pass any 0 threshold, silently paying the bonus to everyone.
 */
export function qualifies(
  rule: Pick<
    TCampaignGeoRule,
    "countries" | "match_mode" | "min_combined_percentage"
  >,
  audience: AudienceCountry[]
): boolean {
  const countries = rule.countries ?? [];
  if (countries.length === 0) return false;

  if (rule.match_mode === "each") {
    return countries.every((entry) => {
      // A per-country rule with no minimum is a configuration error, not a
      // free pass — treat a missing/invalid threshold as unsatisfiable.
      const min = Number(entry.min_percentage);
      if (!Number.isFinite(min) || min <= 0) return false;
      return percentageFor(audience, entry.country) >= min;
    });
  }

  const threshold = Number(rule.min_combined_percentage);
  if (!Number.isFinite(threshold) || threshold <= 0) return false;
  return combinedShare(audience, countries) >= threshold;
}

/**
 * The rule an account qualifies for, out of a campaign's full set.
 *
 * When several match, the HIGHEST bonus wins — the most predictable outcome to
 * explain to a clipper and the easiest to defend in an audit. Ties break on the
 * older rule (stable across edits) so the same inputs always pick the same row.
 */
export function selectBestRule<
  T extends Pick<
    TCampaignGeoRule,
    | "id"
    | "countries"
    | "match_mode"
    | "min_combined_percentage"
    | "bonus_cpm_per_1000"
    | "created_at"
  >
>(rules: T[], audience: AudienceCountry[] | null): T | null {
  if (!audience || audience.length === 0) return null;

  const matching = rules.filter((rule) => qualifies(rule, audience));
  if (matching.length === 0) return null;

  return matching.reduce((best, candidate) => {
    const bestBonus = Number(best.bonus_cpm_per_1000) || 0;
    const candidateBonus = Number(candidate.bonus_cpm_per_1000) || 0;
    if (candidateBonus !== bestBonus) {
      return candidateBonus > bestBonus ? candidate : best;
    }
    return candidate.created_at < best.created_at ? candidate : best;
  });
}

/**
 * The BONUS cpm to add to a campaign's base rate for one connected account.
 * Returns 0 — never negative, never a replacement rate — when nothing matches,
 * so a caller that forgets to branch still pays exactly today's rate.
 */
export function resolveGeoBonus(
  rules: Parameters<typeof selectBestRule>[0],
  audience: AudienceCountry[] | null
): number {
  const rule = selectBestRule(rules, audience);
  if (!rule) return 0;
  const bonus = Number(rule.bonus_cpm_per_1000);
  return Number.isFinite(bonus) && bonus > 0 ? bonus : 0;
}
