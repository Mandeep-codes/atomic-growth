// ── Non-campaign-clip exemption ──
//
// Clippers listed here NEVER have to post a non-campaign clip, on ANY campaign,
// even when the campaign sets non_campaign_clips_required > 0. Their campaign
// clips submit without a redemption credit and are paid as if covered.
//
// Implemented as an explicit allowlist rather than by minting a synthetic
// "cover" non-campaign clip for them: the 4-hour cron view-checks
// non_campaign_clips and strikes them toward deletion, so a placeholder cover
// row would eventually be marked deleted, cascade-uncover their campaign clips
// and claw the money back. An allowlist has no such moving parts.
//
// The rule is per-USER (Discord id, the same key the wallet and every payout
// path uses), so it survives handle changes and applies to every campaign,
// current and future.
//
// To add someone: append their Discord id with a comment naming them. To
// revoke: delete the line — their FUTURE clips then need coverage again;
// already-paid clips are untouched (payouts are high-water-marked, never
// re-run), and any still-uncovered clip simply stops contributing.
export const NC_EXEMPT_USER_IDS = new Set<string>([
  "1529347113845129219", // prthvi11 (Pruthvii) — exempted 2026-07-31 by Pranav
]);

export const isNcExemptClipper = (userId: string | null | undefined): boolean =>
  typeof userId === "string" && NC_EXEMPT_USER_IDS.has(userId);

// THE question every redemption gate actually asks: "does the non-campaign-clip
// requirement apply to THIS clipper on THIS campaign?" Campaign opts in via
// non_campaign_clips_required, minus the exemption. Use this instead of
// re-deriving `(non_campaign_clips_required ?? 0) > 0` at each call site, so a
// new gate can't silently miss the exemption.
export const ncRedemptionApplies = (
  userId: string | null | undefined,
  nonCampaignClipsRequired: number | null | undefined
): boolean => (nonCampaignClipsRequired ?? 0) > 0 && !isNcExemptClipper(userId);
