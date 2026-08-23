import { z } from "zod";
import { COUNTRIES } from "./countries";

// The list itself lives in countries.ts, which has no imports, because the
// frontend bundles it directly for its country dropdowns. Keeping the enum
// derived from that one array is what guarantees the dropdown and the API can
// never drift apart. See the note in countries.ts before adding an import there.
export const countrySchema = z.enum(COUNTRIES);

export const demographicSchema = z.discriminatedUnion("version", [
  z.object({
    version: z.literal("v1"),
    countries: z.array(
      z.object({
        country: countrySchema,
        percentage: z.number().min(0).max(100),
      })
    ),
  }),
]);

export type DemographicData = z.infer<typeof demographicSchema>;

// ── Geo payout rule input ──
// Shared by every geo-rule mutation so the admin UI and the API enforce the
// SAME shape. Validation is strict on purpose: a malformed rule is a money bug,
// and the DB has no way to express these cross-field constraints.
export const geoRuleInputSchema = z
  .object({
    name: z.string().trim().max(60).optional().nullable(),
    matchMode: z.enum(["combined", "each"]).default("each"),
    countries: z
      .array(
        z.object({
          country: countrySchema,
          // Only meaningful when matchMode = "each".
          minPercentage: z.number().min(0).max(100).optional(),
        })
      )
      .min(1, "A geo rule must name at least one country")
      .max(20),
    // Only meaningful when matchMode = "combined".
    minCombinedPercentage: z.number().min(0).max(100).default(0),
    // The EXTRA cpm added on top of the campaign base rate. Must be positive —
    // a zero or negative "bonus" is a no-op row that silently does nothing.
    bonusCpmPer1000: z.number().positive("Bonus CPM must be greater than 0"),
  })
  .superRefine((rule, ctx) => {
    const seen = new Set<string>();
    for (const entry of rule.countries) {
      const key = entry.country.trim().toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["countries"],
          message: `Duplicate country: ${entry.country}`,
        });
      }
      seen.add(key);
    }

    if (rule.matchMode === "each") {
      // Every country needs its own threshold, or the rule can never be
      // satisfied (geo-rules.ts treats a missing minimum as unsatisfiable).
      rule.countries.forEach((entry, index) => {
        if (!entry.minPercentage || entry.minPercentage <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["countries", index, "minPercentage"],
            message: `Set a minimum percentage for ${entry.country}`,
          });
        }
      });
    } else if (rule.minCombinedPercentage <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minCombinedPercentage"],
        message: "Combined minimum percentage must be greater than 0",
      });
    }
  });

export type GeoRuleInput = z.infer<typeof geoRuleInputSchema>;

// ── Weekly demographic submission (clipper-facing) ──
// The clipper submits ONE report per connected account per week: a link to a
// screen recording of that account's in-platform analytics, plus the Top 5
// audience countries typed in by hand.
//
// Validation is strict because this report is what prices the geo bonus. Every
// rule below is enforced here rather than only in the form, so the API can't be
// called directly with a malformed report.
// The top-5 audience breakdown itself. Split out so the campaign-scoped
// submission below can reuse the EXACT same rules — a second copy would drift,
// and this is the data a geo bonus is priced from.
export const audienceCountriesSchema = z
  .array(
    z.object({
      country: countrySchema,
      // Strictly greater than zero: a 0% country carries no information and
      // is almost always an unfilled row rather than a real measurement.
      percentage: z
        .number({ invalid_type_error: "Percentage must be a number" })
        .gt(0, "Percentage must be greater than 0")
        .max(100, "Percentage cannot exceed 100"),
    })
  )
  // Exactly five — not "at least", not "up to". Every platform's analytics
  // shows a top-5 breakdown, so this is both checkable against the
  // recording and consistent between clippers.
  .length(5, "Enter exactly 5 countries");

export const weeklyDemographicsInputSchema = z
  .object({
    verifiedUserId: z.string().min(1, "Select which account this is for"),
    // Proof: a link to the screen recording of the last 7 days of analytics.
    evidenceVideoUrl: z
      .string()
      .trim()
      .url("Paste a valid link to your screen recording"),
    countries: audienceCountriesSchema,
  })
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    input.countries.forEach((entry, index) => {
      const key = entry.country.trim().toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["countries", index, "country"],
          message: `${entry.country} is already listed`,
        });
      }
      seen.add(key);
    });

    // A top-5 breakdown summing over 100% cannot be a real audience split.
    // Under 100% is fine — the remainder is the untracked long tail.
    const total = input.countries.reduce((sum, c) => sum + c.percentage, 0);
    if (total > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["countries"],
        message: `Percentages add up to ${total.toFixed(
          2
        )}% — they cannot exceed 100%`,
      });
    }
  });

export type WeeklyDemographicsInput = z.infer<
  typeof weeklyDemographicsInputSchema
>;

// ── Campaign-scoped submission: full report OR exemption ──
//
// Both modes are real submissions. Both require the screen recording — the
// evidence is what a moderator reviews either way, and dropping it for the
// exemption path would turn "I can't give you a country breakdown" into "I
// don't have to show you anything", which is not the same claim.
//
// The ONE difference is the audience breakdown. A report carries the top five
// countries and can therefore be scored against the campaign's geo rules. An
// exemption carries none, so the account is paid base rate only — it is not
// eligible for a geo bonus on this campaign for this cycle. That is the whole
// point of the option, not a side effect of the missing data: geo-payout.ts
// excludes exempt rows explicitly rather than relying on parsed_data being null.
//
// Discriminated on `mode` rather than "countries present?" so the intent is
// recorded, and a report that simply failed to send its countries is rejected
// as an invalid report instead of silently becoming an exemption.
const submissionBase = z.object({
  campaignId: z.string().min(1, "Campaign is required"),
  verifiedUserId: z.string().min(1, "Select which account this is for"),
  evidenceVideoUrl: z
    .string()
    .trim()
    .url("Paste a valid link to your screen recording"),
});

export const campaignDemographicsSubmissionSchema = z
  .discriminatedUnion("mode", [
    submissionBase.extend({
      mode: z.literal("report"),
      countries: audienceCountriesSchema,
    }),
    submissionBase.extend({
      mode: z.literal("exemption"),
      // Free text, but required: a moderator approving an exemption is
      // accepting a stated reason, and "no reason given" is not reviewable.
      exemptionReason: z
        .string()
        .trim()
        .min(10, "Explain why this account can't provide a country breakdown")
        .max(500),
    }),
  ])
  // The cross-field breakdown rules, applied to the union rather than to the
  // report member: a discriminated union's members must stay plain objects, so
  // refining one of them in place would break the discriminator.
  .superRefine((input, ctx) => {
    if (input.mode !== "report") return;

    const seen = new Set<string>();
    input.countries.forEach((entry, index) => {
      const key = entry.country.trim().toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["countries", index, "country"],
          message: `${entry.country} is already listed`,
        });
      }
      seen.add(key);
    });

    const total = input.countries.reduce((sum, c) => sum + c.percentage, 0);
    if (total > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["countries"],
        message: `Percentages add up to ${total.toFixed(
          2
        )}% — they cannot exceed 100%`,
      });
    }
  });

export type CampaignDemographicsSubmission = z.infer<
  typeof campaignDemographicsSubmissionSchema
>;
