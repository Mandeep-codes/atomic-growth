import { TRPCError } from "@trpc/server";
import { autoClaimAfterApproval } from "../lib/auto-claim";
import { SQL, and, asc, count, desc, eq, gte, inArray, isNull, like, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../lib/db";
import {
  campaigns,
  demographics_verification_v2,
  notifications,
  submissions,
  user_clerk,
  verified_users,
} from "../lib/schema";
import {
  demographicsReviewerRoleProcedure,
  protectedProcedure,
  router,
} from "../lib/trpc";
import {
  campaignDemographicsSubmissionSchema,
  demographicSchema,
  weeklyDemographicsInputSchema,
} from "../lib/zod-schemas/demographic";
import { currentCycleStart } from "../lib/demographic-cycles";
import { getPayoutEligibility } from "../lib/payout-eligibility";
import { runClearanceForUser } from "../lib/geo-clearance";
import {
  closeResetRequest,
  getCampaignAsksForUser,
  getClaimableBreakdown,
  getDemographicsThreshold,
  getOpenRequestFor,
  getParticipatingAccounts,
  alwaysRequestsDemographics,
  listOpenRequests,
  openResetRequest,
} from "../lib/demographics-reset";

const claimIdInput = z.object({
  id: z.string().min(1, "id is required"),
});

// Accept any youtube.com/youtu.be URL. Tight regex up front so bad links
// fail at the API boundary instead of leaving a broken row in the queue.
const YOUTUBE_URL_PATTERN =
  /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)[\w-]{6,}/i;

// Google Drive is QUIETLY accepted as an alternative host: some clippers'
// YouTube accounts are banned, so they can't upload the analytics recording
// there. Deliberately unadvertised — the error message below still says
// YouTube-only, and no UI copy mentions Drive. The admin review page
// renders non-YouTube URLs as a plain link.
const GOOGLE_DRIVE_URL_PATTERN =
  /^https?:\/\/(?:drive|docs)\.google\.com\/(?:file\/d\/[A-Za-z0-9_-]{10,}|(?:open|uc)\?(?:[^#]*&)?id=[A-Za-z0-9_-]{10,})/i;

const videoLinkInput = claimIdInput.extend({
  videoUrl: z
    .string()
    .url("Please provide a valid URL")
    .refine(
      (url) =>
        YOUTUBE_URL_PATTERN.test(url) || GOOGLE_DRIVE_URL_PATTERN.test(url),
      "URL must be an unlisted YouTube video (youtube.com or youtu.be)"
    ),
  // Optional country breakdown the clipper entered while submitting.
  // The mod will see this pre-filled in their review form and can edit
  // before approving. Same shape as the mod-side parsed_data write.
  parsedData: z
    .object({
      countries: z.array(
        z.object({
          country: z.string().min(1),
          percentage: z.number().min(0).max(100),
        })
      ),
    })
    .optional(),
  // Clipper's attestation that the country breakdown they entered is
  // accurate to what's shown in their recording. Required if parsedData
  // is provided so we have a clear audit signal.
  attestationConfirmed: z.boolean().optional(),
});

const exemptionInput = claimIdInput.extend({
  exemptionReason: z
    .string()
    .trim()
    .min(1, "Please tell us why you can't record analytics")
    .max(2000, "Exemption reason is too long"),
});

const claimSelect = {
  id: demographics_verification_v2.id,
  campaignId: demographics_verification_v2.campaign_id,
  userId: demographics_verification_v2.user_id,
  verifiedUserId: demographics_verification_v2.verified_user_id,
  screenshotFileUrl: demographics_verification_v2.screenshot_file_url,
  // The clipper's recording lives in ONE of two columns depending on which
  // form they used, so a reviewer needs both selected here. `submitWeekly`
  // (the live weekly flow) writes evidence_video_url; the older per-claim
  // `submitVideoLink` page writes screenshot_file_url. Selecting only the
  // latter is why the review dialog said "No recording submitted yet" for
  // every report filed through the weekly form.
  evidenceVideoUrl: demographics_verification_v2.evidence_video_url,
  parsedData: demographics_verification_v2.parsed_data,
  status: demographics_verification_v2.status,
  viewsFromSnapshot:
    demographics_verification_v2.views_from_submissions_snapshot,
  createdAt: demographics_verification_v2.created_at,
  updatedAt: demographics_verification_v2.updated_at,
  campaignTitle: campaigns.title,
  campaignCreatedAt: campaigns.created_at,
  verifiedHandle: verified_users.handle,
  verifiedUsername: verified_users.username,
  verifiedPlatform: verified_users.platform,
  exemptionReason: demographics_verification_v2.exemption_reason,
};

const assertClaimAccess = async (
  claimId: string,
  userId: string | undefined
) => {
  if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });

  const [claim] = await db
    .select({
      id: demographics_verification_v2.id,
      userId: demographics_verification_v2.user_id,
      verifiedUserId: demographics_verification_v2.verified_user_id,
      status: demographics_verification_v2.status,
    })
    .from(demographics_verification_v2)
    .where(eq(demographics_verification_v2.id, claimId))
    .limit(1);

  if (!claim) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Claim not found" });
  }

  if (claim.userId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Unauthorized" });
  }

  return claim;
};

// A verified account's audience is the same in every campaign it runs in, so
// one clipper submission / mod decision is fanned out to that account's OTHER
// campaign rows. Only rows still awaiting a demographics decision are touched
// — 'approved' and 'cancelled' rows are left alone (a fresh recording doesn't
// silently re-open a campaign that wasn't reset). Each row keeps its own
// views_from_submissions_snapshot, so the per-campaign rollup is unaffected;
// only the shared audience data + status is copied across.
const DEMOGRAPHICS_AWAITING_STATUSES = [
  "created",
  "active",
  "pending",
  "needs-human-review",
  "rejected",
] as const;

// Rows whose view snapshot may still be repaired: everything a moderator has
// not settled yet. 'approved' and 'cancelled' are excluded — see
// repairViewSnapshots.
const SNAPSHOT_REPAIRABLE_STATUSES = DEMOGRAPHICS_AWAITING_STATUSES;

type DemographicsStatus =
  (typeof demographics_verification_v2.$inferSelect)["status"];

// Reject reaches further than approve/submit: it also claws the account out of
// campaigns where it was already 'approved', so a bad audience can't linger.
const DEMOGRAPHICS_REJECT_STATUSES: readonly DemographicsStatus[] = [
  ...DEMOGRAPHICS_AWAITING_STATUSES,
  "approved",
];

export const fanOutDemographicToSiblings = async (opts: {
  verifiedUserId: string;
  userId: string;
  excludeId: string;
  set: Record<string, unknown>;
  // Which sibling statuses to overwrite. Defaults to the "awaiting" set;
  // a rejection passes the wider set (incl. 'approved') to claw an account
  // back out of every campaign it was already approved in.
  statuses?: readonly DemographicsStatus[];
}) => {
  // Scope the fan-out to the SAME weekly cycle as the row being decided.
  // Reports are versioned per week, so a decision on this week's audience must
  // not reach into another week: without this it would flip a different cycle's
  // pending row to approved AND overwrite that week's parsed_data with this
  // week's audience, destroying the per-week record the payout hold relies on —
  // and retroactively "approving" a week the clipper never filed for.
  //
  // Resolved here rather than passed in, so no caller can forget it.
  const [source] = await db
    .select({ cycleStart: demographics_verification_v2.cycle_start })
    .from(demographics_verification_v2)
    .where(eq(demographics_verification_v2.id, opts.excludeId))
    .limit(1);
  if (!source) return;

  await db
    .update(demographics_verification_v2)
    .set(opts.set)
    .where(
      and(
        eq(
          demographics_verification_v2.verified_user_id,
          opts.verifiedUserId
        ),
        eq(demographics_verification_v2.user_id, opts.userId),
        eq(demographics_verification_v2.cycle_start, source.cycleStart),
        ne(demographics_verification_v2.id, opts.excludeId),
        inArray(
          demographics_verification_v2.status,
          opts.statuses ?? DEMOGRAPHICS_AWAITING_STATUSES
        )
      )
    );
};

export const demographicsVerificationRouter = router({
  // ── Weekly demographic submission (clipper-facing) ──
  // What this clipper still owes for the CURRENT cycle: one report per
  // connected account they earn from, with its status. Drives the weekly
  // submission form and mirrors what the payout gate checks.
  getWeeklySubmissionStatus: protectedProcedure.query(async ({ ctx }) => {
    const eligibility = await getPayoutEligibility(ctx.user.id);
    return {
      cycleStart: eligibility.cycleStart,
      accounts: eligibility.accounts,
      allSubmitted: eligibility.accounts.every((a) => a.submitted),
      allApproved: eligibility.eligible,
    };
  }),

  // ── Campaign-scoped ask (clipper-facing) ──
  // Which campaigns are currently asking THIS clipper for demographics, and for
  // which of their accounts. Only accounts that posted to that campaign and
  // generated views appear — a clipper with ten connected accounts is asked
  // about the two that actually ran in the campaign under review.
  //
  // Returned alongside the money split so the screen can say what is being held
  // and why, without a second round trip.
  getCampaignAsks: protectedProcedure.query(async ({ ctx }) => {
    const [asks, claimable] = await Promise.all([
      getCampaignAsksForUser(ctx.user.id),
      getClaimableBreakdown(ctx.user.id),
    ]);
    return {
      asks,
      pendingCount: asks.filter((a) => !a.satisfied).length,
      ...claimable,
    };
  }),

  // What this clipper can withdraw right now, and what each campaign is holding
  // back. Drives the earnings screen; the withdrawal mutations re-derive it
  // themselves rather than trusting anything the client sends.
  getClaimable: protectedProcedure.query(async ({ ctx }) =>
    getClaimableBreakdown(ctx.user.id)
  ),

  // Submit this campaign's report for ONE of its participating accounts.
  //
  // Unlike the old submitWeekly this does NOT fan out to every campaign the
  // account runs in: the ask is per campaign, so the answer is too. A clipper
  // whose account runs in three campaigns answers each campaign's own request,
  // and each campaign's money is released on its own report.
  submitForCampaign: protectedProcedure
    .input(campaignDemographicsSubmissionSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // A moderator round is one reason a campaign asks; a live campaign the
      // clipper has earnings on is the other (AUTO_CAMPAIGN_DEMOGRAPHICS_ASK).
      // BOTH have to be honoured here, not just the round.
      //
      // getCampaignAsksForUser is what decides who is ASKED and what money is
      // held. If this endpoint only accepted moderator rounds while that
      // function also asked on its own, every auto-asked campaign would hold
      // the clipper's money against a report this endpoint then refused with
      // "isn't asking for demographics right now" — money frozen with no way
      // to release it. So the submit side reads the SAME function rather than
      // a second, narrower rule that can drift away from it.
      const openRequest = await getOpenRequestFor(input.campaignId);
      const cycleStart =
        openRequest?.cycle_start ??
        (await getCampaignAsksForUser(userId)).find(
          (ask) => ask.campaignId === input.campaignId
        )?.cycleStart;

      if (!cycleStart) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This campaign isn't asking for demographics right now, so there's nothing to submit.",
        });
      }

      // The account must both belong to the caller AND actually participate in
      // this campaign. Checking participation here, not just ownership, is what
      // stops a clipper filing a report for an account that never ran in the
      // campaign — which would put a row in the moderator's queue that no ask
      // covers, and could release money on an audience nobody asked about.
      const participating = await getParticipatingAccounts(
        input.campaignId,
        userId
      );
      const account = participating.find(
        (a) => a.verifiedUserId === input.verifiedUserId
      );

      if (!account) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "That account didn't generate any views on this campaign, so it isn't part of this request.",
        });
      }

      // ── Combined-views threshold ──
      // Re-checked server-side, not just hidden in the UI: this is the control,
      // the client check is only there to explain it. Measured across ALL the
      // clipper's accounts on this campaign, matching how the ask is decided —
      // checking the single account being submitted would let a clipper past
      // the bar on their biggest account while the campaign total is short.
      const threshold = await getDemographicsThreshold(input.campaignId);
      const totalViews = participating.reduce((sum, a) => sum + a.views, 0);
      // Mirrors the same skip in getCampaignAsksForUser. Someone on the
      // always-request flag is asked below the bar, so they must be able to
      // file below the bar too — otherwise the ask is unanswerable and their
      // money stays held.
      const alwaysAsked = await alwaysRequestsDemographics(userId);
      if (totalViews < threshold && !alwaysAsked) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `This campaign needs ${threshold.toLocaleString()} combined views across your accounts before demographics can be submitted — you're at ${totalViews.toLocaleString()}.`,
        });
      }

      // An exemption is a real submission with no audience breakdown: the
      // evidence video is still attached and a moderator still reviews it, but
      // there is nothing to score against the campaign's geo rules, so the
      // account is paid base rate only. Both columns are written explicitly on
      // BOTH paths — leaving the other one stale would let a clipper who first
      // filed a report and then switched to an exemption keep a scoring
      // breakdown attached to an exempt row, and be paid a bonus for it.
      const isExemption = input.mode === "exemption";
      const parsedData = isExemption
        ? null
        : { version: "v1" as const, countries: input.countries };
      const exemptionReason = isExemption ? input.exemptionReason : null;

      const row = {
        parsed_data: parsedData,
        exemption_reason: exemptionReason,
        evidence_video_url: input.evidenceVideoUrl,
        status: "needs-human-review" as const,
        // Cleared on every submission: a stale "approved by mod" marker on a
        // freshly re-submitted row would misrepresent who accepted this data.
        approval_method: null,
      };

      // ── One recording answers every campaign asking for THIS account ──
      // An account's audience is the same wherever it runs, so asking the same
      // clipper to film and file the identical report once per campaign is pure
      // duplication: 192 accounts currently run in more than one live campaign,
      // which is 384 requests for 192 real answers. Filing for one of them now
      // answers all of them.
      //
      // Each campaign keeps its OWN views_from_submissions_snapshot and its own
      // cycle. The snapshot is that account's view total ON THAT CAMPAIGN and is
      // what weights the campaign's rollup, so copying one campaign's figure
      // across would corrupt every other campaign's country percentages. The
      // cycle differs too when one campaign has a moderator round open and
      // another is asking on its own.
      const targets = new Map<
        string,
        { cycleStart: string; views: number }
      >();
      // The campaign actually submitted for, using the cycle resolved above
      // (a moderator round's cycle wins over the current one).
      targets.set(input.campaignId, { cycleStart, views: account.views });

      for (const ask of await getCampaignAsksForUser(userId)) {
        if (targets.has(ask.campaignId)) continue;
        const asked = ask.accounts.find(
          (a) => a.verifiedUserId === input.verifiedUserId
        );
        // Only campaigns that are asking about THIS account. One the account
        // never ran in is not covered by this report.
        if (!asked) continue;
        // Never reach into a campaign that has already ACCEPTED this account
        // for the cycle. Writing the report there would drop it back to
        // needs-human-review and strip approval_method, re-holding money a
        // moderator had already released and demanding a second review — all
        // because the clipper filed for a DIFFERENT campaign. Same rule
        // fanOutDemographicToSiblings follows: a submit/approve only touches
        // the awaiting statuses, and only a rejection reaches into 'approved'.
        // Re-submitting for the campaign the clipper explicitly chose still
        // replaces that one — it is seeded above, before this loop.
        if (asked.approved) continue;
        targets.set(ask.campaignId, {
          cycleStart: ask.cycleStart,
          views: asked.views,
        });
      }

      for (const [campaignId, target] of targets) {
        await db
          .insert(demographics_verification_v2)
          .values({
            ...row,
            views_from_submissions_snapshot: target.views,
            campaign_id: campaignId,
            user_id: userId,
            verified_user_id: input.verifiedUserId,
            // The cycle the ASK is for, not today's cycle. If the week rolls
            // over while a moderator round is open, the report must still
            // answer the round that was opened, or it would land on a cycle the
            // request does not look at and the clipper would stay locked. An
            // auto-ask carries the current cycle, which is the same rule with
            // no round to defer to.
            cycle_start: target.cycleStart,
          })
          .onDuplicateKeyUpdate({
            set: {
              ...row,
              views_from_submissions_snapshot: target.views,
              updated_at: new Date(),
            },
          });
      }

      return {
        submitted: true,
        exempt: isExemption,
        campaignId: input.campaignId,
        cycleStart,
        handle: account.handle,
        // Every campaign this one report answered, so the client can tell the
        // clipper the other cards are done rather than leaving them to guess.
        campaignsCovered: targets.size,
      };
    }),

  // ── Moderator: ask one campaign for fresh demographics ──
  // Opens a request, clears that campaign's reports for the cycle, and notifies
  // every clipper with a view-generating account on it. Their earnings on this
  // campaign are held back until the accounts are approved; everything they
  // earned elsewhere stays claimable.
  requestCampaignReset: demographicsReviewerRoleProcedure
    .input(
      z.object({
        campaignId: z.string().min(1, "Campaign is required"),
        note: z.string().trim().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [campaign] = await db
        .select({ id: campaigns.id, title: campaigns.title })
        .from(campaigns)
        .where(eq(campaigns.id, input.campaignId))
        .limit(1);

      if (!campaign) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found." });
      }

      const { requestId, cycleStart, participants } = await openResetRequest({
        campaignId: input.campaignId,
        requestedBy: ctx.user?.id ?? null,
        note: input.note ?? null,
      });

      // Best-effort: the request itself is committed, and a notification
      // failure must not roll it back or make the moderator think the ask
      // didn't happen. The clipper still sees it on the demographics screen.
      if (participants.length > 0) {
        try {
          await db.insert(notifications).values(
            participants.map((userId) => ({
              user_id: userId,
              title: `Demographics needed — ${campaign.title ?? "campaign"}`,
              description: input.note?.trim()
                ? input.note.trim()
                : `Submit fresh audience demographics for the accounts you ran in ${
                    campaign.title ?? "this campaign"
                  }. Your earnings from this campaign stay on hold until they're approved — everything you earned elsewhere is unaffected.`,
              metadata: {
                type: "demographics_reset",
                campaignId: input.campaignId,
                requestId,
              },
            }))
          );
        } catch (error) {
          console.error("demographics reset notification failed", error);
        }
      }

      return {
        requestId,
        cycleStart,
        notifiedUserCount: participants.length,
        campaignTitle: campaign.title ?? null,
      };
    }),

  // Stop asking. Releases the hold on this campaign's earnings immediately;
  // reports already filed are left exactly as they are.
  cancelCampaignReset: demographicsReviewerRoleProcedure
    .input(z.object({ campaignId: z.string().min(1, "Campaign is required") }))
    .mutation(async ({ input }) => ({
      closed: await closeResetRequest(input.campaignId),
    })),

  // Every campaign currently asking, for the moderator overview.
  listOpenResetRequests: demographicsReviewerRoleProcedure.query(async () =>
    listOpenRequests()
  ),

  // Submit (or re-submit) this week's report for ONE connected account. The
  // same recording covers every campaign that account runs in, so this writes a
  // row per campaign for the current cycle — that per-campaign grain is what
  // the geo evaluator and the payout gate both read.
  submitWeekly: protectedProcedure
    .input(weeklyDemographicsInputSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const cycleStart = currentCycleStart();

      // The account must belong to the caller. Without this check a clipper
      // could file a report against someone else's account and change the rate
      // that account is paid at.
      const [account] = await db
        .select({
          id: verified_users.id,
          handle: verified_users.handle,
          deletedAt: verified_users.account_deleted_at,
        })
        .from(verified_users)
        .where(
          and(
            eq(verified_users.id, input.verifiedUserId),
            eq(verified_users.discord_id, userId)
          )
        )
        .limit(1);

      if (!account) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "That account is not linked to you.",
        });
      }

      if (account.deletedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This account is flagged as deleted or unavailable, so it can't be verified.",
        });
      }

      // Every campaign this account actually has approved clips in, WITH the
      // views it earned there. The view total is not decoration: the report is
      // weighted by it in the campaign rollup (computeDemographicsBreakdown),
      // so a row carrying 0 contributes nothing to that campaign's country
      // percentages no matter what audience the clipper reported. It is also
      // the "Views snapshot" column a moderator reads when deciding whether a
      // report is worth approving.
      //
      // Deleted clips are excluded and the sum is per campaign — the same
      // definition getParticipatingAccounts uses for the newer per-campaign
      // flow, so both submission paths record the number the same way.
      const campaignRows = await db
        .select({
          campaignId: submissions.campaign_id,
          views: sql<number>`COALESCE(SUM(${submissions.views}), 0)`,
        })
        .from(submissions)
        .where(
          and(
            eq(submissions.verified_user_id, input.verifiedUserId),
            eq(submissions.user_id, userId),
            eq(submissions.status, "approved"),
            isNull(submissions.deleted_at)
          )
        )
        .groupBy(submissions.campaign_id);

      if (campaignRows.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This account has no approved clips yet, so there's nothing to verify.",
        });
      }

      const parsedData = {
        version: "v1" as const,
        countries: input.countries,
      };

      for (const row of campaignRows) {
        await db
          .insert(demographics_verification_v2)
          .values({
            campaign_id: row.campaignId,
            user_id: userId,
            verified_user_id: input.verifiedUserId,
            cycle_start: cycleStart,
            views_from_submissions_snapshot: Number(row.views),
            parsed_data: parsedData,
            evidence_video_url: input.evidenceVideoUrl,
            // 'needs-human-review' is the status the moderator queue actually
            // surfaces. 'pending' means 'pending confirmation' here and never
            // appears in that queue, so a submission would sit invisible.
            status: "needs-human-review",
          })
          // Re-submitting within the same week REPLACES that week's report and
          // sends it back to pending — a rejected report must be fixable, and a
          // corrected one must not keep a stale approval.
          .onDuplicateKeyUpdate({
            set: {
              parsed_data: parsedData,
              evidence_video_url: input.evidenceVideoUrl,
              // Refreshed alongside the report: views have kept accruing since
              // the row was opened, and the snapshot must describe the audience
              // being submitted now, not whatever it was when the placeholder
              // was created.
              views_from_submissions_snapshot: Number(row.views),
              status: "needs-human-review",
              updated_at: new Date(),
            },
          });
      }

      return {
        submitted: true,
        cycleStart,
        campaignCount: campaignRows.length,
        handle: account.handle,
      };
    }),

  listClaims: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;

    const records = await db
      .select({
        id: demographics_verification_v2.id,
        verifiedUserId: demographics_verification_v2.verified_user_id,
        campaignId: demographics_verification_v2.campaign_id,
        campaignTitle: campaigns.title,
        verifiedHandle: verified_users.handle,
        verifiedUsername: verified_users.username,
        verifiedPlatform: verified_users.platform,
        status: demographics_verification_v2.status,
        createdAt: demographics_verification_v2.created_at,
      })
      .from(demographics_verification_v2)
      .leftJoin(
        campaigns,
        eq(demographics_verification_v2.campaign_id, campaigns.id)
      )
      .leftJoin(
        verified_users,
        eq(demographics_verification_v2.verified_user_id, verified_users.id)
      )
      .where(
        and(
          eq(demographics_verification_v2.user_id, userId),
          // 'needs-human-review' belongs here: it is what submitForCampaign
          // and submitVideoLink write, so without it a clipper's report
          // VANISHED from this list the moment they filed it. That is why the
          // two clipper screens disagreed — this one went quiet while the
          // weekly screen still showed the campaign as unsatisfied (it stays
          // unsatisfied until a moderator APPROVES, not until the clipper
          // submits). Production has 199 such rows and none of them were
          // visible to their owners here.
          //
          // Read-only: this list drives display only. The claim gate is
          // getClaimableBreakdown, and the moderator queue is adminListClaims,
          // which already returned these rows (verified: 200 of them).
          inArray(demographics_verification_v2.status, [
            "active",
            "rejected",
            "pending",
            "needs-human-review",
          ])
        )
      )
      .orderBy(desc(demographics_verification_v2.created_at));

    // One card per verified account: the same recording covers every campaign
    // that account runs in, so collapse the per-campaign rows into a single
    // claim listing the campaigns it covers. The representative row (whose id
    // the clipper submits against) prefers an actionable status so the fan-out
    // reaches all of the account's awaiting campaigns.
    const actionability: Partial<Record<DemographicsStatus, number>> = {
      active: 0,
      rejected: 0,
      pending: 1,
    };
    const byAccount = new Map<
      string,
      {
        id: string;
        status: DemographicsStatus;
        createdAt: Date;
        verifiedHandle: string | null;
        verifiedUsername: string | null;
        verifiedPlatform: string | null;
        // Keyed by campaign_id so same-titled or untitled campaigns still
        // count separately (title strings would silently collapse them).
        campaigns: Map<string, string>;
      }
    >();

    for (const record of records) {
      const key = record.verifiedUserId;
      const title = record.campaignTitle ?? "Untitled campaign";
      const existing = byAccount.get(key);
      if (!existing) {
        byAccount.set(key, {
          id: record.id,
          status: record.status,
          createdAt: record.createdAt,
          verifiedHandle: record.verifiedHandle,
          verifiedUsername: record.verifiedUsername,
          verifiedPlatform: record.verifiedPlatform,
          campaigns: new Map([[record.campaignId, title]]),
        });
        continue;
      }
      existing.campaigns.set(record.campaignId, title);
      // Promote to a more actionable representative row when we find one.
      if (
        (actionability[record.status] ?? 1) <
        (actionability[existing.status] ?? 1)
      ) {
        existing.id = record.id;
        existing.status = record.status;
      }
    }

    return [...byAccount.values()].map((account) => {
      const campaignTitles = [...account.campaigns.values()];
      return {
        id: account.id,
        status: account.status,
        createdAt: account.createdAt,
        verifiedHandle: account.verifiedHandle,
        verifiedUsername: account.verifiedUsername,
        verifiedPlatform: account.verifiedPlatform,
        // Representative title kept for backwards compatibility; campaignTitles
        // is the full list of campaigns this one submission covers.
        campaignTitle: campaignTitles[0],
        campaignTitles,
        campaignCount: account.campaigns.size,
      };
    });
  }),
  adminListClaims: demographicsReviewerRoleProcedure
    .input(
      z
        .object({
          status: z
            .enum([
              "created",
              "pending",
              "active",
              "approved",
              "needs-human-review",
              "cancelled",
              "rejected",
            ])
            .optional(),
          approvalMethod: z.enum(["user", "mod", "api"]).optional(),
          campaignId: z.string().optional(),
          page: z.number().int().min(1).optional(),
          limit: z.number().int().min(1).max(100).optional(),
          search: z.string().trim().min(1).max(255).optional(),
          // ── What the queue is allowed to show ──
          // The list had no scoping at all, so "Awaiting" counted every row
          // ever created: 472, of which 345 belong to campaigns that ended in
          // December and January and 49 to cycles that have already closed.
          // None of those 394 can ever be filed, so the number never came down
          // no matter how much the moderators cleared, and it read as though
          // approvals were being undone.
          //
          // "actionable" (the default) = a campaign that is still running, on
          // the cycle currently being asked for — the 78 that a clipper can
          // actually still answer. "all" restores the old unbounded view for
          // when someone genuinely needs the history.
          scope: z.enum(["actionable", "all"]).default("actionable"),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const statusFilter = input?.status;
      const scope = input?.scope ?? "actionable";
      const approvalMethodFilter = input?.approvalMethod;
      const campaignFilter = input?.campaignId;
      const searchQuery = input?.search?.trim();
      const limit = input?.limit ?? 10;
      const page = input?.page ?? 1;
      const offset = (page - 1) * limit;

      let query = db
        .select({
          id: demographics_verification_v2.id,
          campaignId: demographics_verification_v2.campaign_id,
          campaignTitle: campaigns.title,
          verifiedHandle: verified_users.handle,
          verifiedUsername: verified_users.username,
          verifiedPlatform: verified_users.platform,
          status: demographics_verification_v2.status,
          createdAt: demographics_verification_v2.created_at,
          updatedAt: demographics_verification_v2.updated_at,
          userId: demographics_verification_v2.user_id,
          ownerEmail: user_clerk.email,
          ownerFirstName: user_clerk.first_name,
          ownerLastName: user_clerk.last_name,
          approvalMethod: demographics_verification_v2.approval_method,
          viewsFromSnapshot:
            demographics_verification_v2.views_from_submissions_snapshot,
        })
        .from(demographics_verification_v2)
        .leftJoin(
          campaigns,
          eq(demographics_verification_v2.campaign_id, campaigns.id)
        )
        .leftJoin(
          verified_users,
          eq(demographics_verification_v2.verified_user_id, verified_users.id)
        )
        .leftJoin(
          user_clerk,
          eq(user_clerk.discord_id, demographics_verification_v2.user_id)
        );

      const conditions: SQL[] = [];
      if (statusFilter) {
        conditions.push(eq(demographics_verification_v2.status, statusFilter));
      }

      if (approvalMethodFilter) {
        conditions.push(
          eq(demographics_verification_v2.approval_method, approvalMethodFilter)
        );
      }

      if (campaignFilter) {
        conditions.push(
          eq(demographics_verification_v2.campaign_id, campaignFilter)
        );
      }

      // The scope only narrows rows that are waiting on the CLIPPER —
      // 'active' and 'created' are placeholders with nothing for a moderator to
      // do, and on a finished campaign or a closed cycle nobody can ever act on
      // them. A row the clipper has actually FILED is always a moderator's job,
      // whenever it was filed: production has three needs-human-review reports
      // carrying real recordings, all on ended campaigns and old cycles, unread
      // since 1 Aug. Scoping those away would hide the only work that is
      // genuinely outstanding, which is worse than the count this fixes.
      //
      // Written as EXISTS rather than a condition on the joined campaigns row:
      // the count query below joins verified_users and user_clerk but NOT
      // campaigns, so a join-dependent predicate would compile there into a
      // filter on a table that isn't in the FROM clause. This form is
      // identical in both.
      if (scope === "actionable") {
        conditions.push(
          sql`(
            ${demographics_verification_v2.status} NOT IN ('active', 'created')
            OR (
              EXISTS (
                SELECT 1 FROM ${campaigns} AS c_scope
                 WHERE c_scope.id = ${demographics_verification_v2.campaign_id}
                   AND c_scope.active = 1
                   AND c_scope.ended = 0
              )
              AND ${demographics_verification_v2.cycle_start} = ${currentCycleStart()}
            )
          )`
        );
      }

      if (searchQuery) {
        const likePattern = `%${searchQuery.replace(/[%_]/g, "\\$&")}%`;
        conditions.push(
          or(
            like(verified_users.username, likePattern),
            like(verified_users.handle, likePattern),
            like(user_clerk.email, likePattern),
            // Moderators identify a clipper by their DISCORD name — that is
            // what support tickets and the server carry — not by a per-platform
            // social handle. Without this, searching a real clipper who has
            // filed reports returns "Showing 0 requests" and the queue looks
            // empty when it is not.
            like(user_clerk.discord_username, likePattern),
            // discord_id is an exact numeric snowflake. Comparing it to the
            // '%…%' LIKE pattern could never match, so pasting an ID found
            // nothing.
            eq(user_clerk.discord_id, searchQuery),
          ) as SQL<unknown> // YOLO
        );
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const records = await query
        .where(whereClause ?? undefined)
        .orderBy(desc(demographics_verification_v2.created_at))
        .limit(limit)
        .offset(offset);

      const [result] = await db
        .select({ total: count(demographics_verification_v2.id) })
        .from(demographics_verification_v2)
        .leftJoin(
          verified_users,
          eq(demographics_verification_v2.verified_user_id, verified_users.id)
        )
        .leftJoin(
          user_clerk,
          eq(user_clerk.discord_id, demographics_verification_v2.user_id)
        )
        .where(whereClause ?? undefined);

      const total = result ? Number(result.total) : 0;
      return {
        data: records.map((record) => ({
          id: record.id,
          campaignId: record.campaignId,
          campaignTitle: record.campaignTitle,
          verifiedHandle: record.verifiedHandle,
          verifiedUsername: record.verifiedUsername,
          verifiedPlatform: record.verifiedPlatform,
          status: record.status,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          userId: record.userId,
          ownerEmail: record.ownerEmail,
          ownerFirstName: record.ownerFirstName,
          ownerLastName: record.ownerLastName,
          approvalMethod: record.approvalMethod,
          viewsFromSnapshot: record.viewsFromSnapshot,
        })),
        total: Number(total ?? 0),
        page,
        limit,
      };
    }),
  adminGetClaim: demographicsReviewerRoleProcedure
    .input(claimIdInput)
    .query(async ({ input }) => {
      const [record] = await db
        .select(claimSelect)
        .from(demographics_verification_v2)
        .leftJoin(
          campaigns,
          eq(demographics_verification_v2.campaign_id, campaigns.id)
        )
        .leftJoin(
          verified_users,
          eq(demographics_verification_v2.verified_user_id, verified_users.id)
        )
        .where(eq(demographics_verification_v2.id, input.id))
        .limit(1);

      if (!record) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Claim not found" });
      }

      let parsedData;
      if (record.parsedData) {
        const parsed = demographicSchema.safeParse(record.parsedData);
        if (parsed.success) {
          parsedData = parsed.data;
        }
      }

      return {
        id: record.id,
        campaignId: record.campaignId,
        campaignTitle: record.campaignTitle,
        verifiedHandle: record.verifiedHandle,
        verifiedUsername: record.verifiedUsername,
        verifiedPlatform: record.verifiedPlatform,
        screenshotFileUrl: record.screenshotFileUrl,
        // THE recording the reviewer should watch, resolved server-side so the
        // dialog never has to know which form the clipper used. evidence wins
        // when both are set: it is the column the live weekly flow writes, and
        // a leftover screenshot_file_url from the older per-claim page is the
        // staler of the two. Null only when no recording was ever submitted.
        recordingUrl: record.evidenceVideoUrl ?? record.screenshotFileUrl,
        parsedData,
        status: record.status,
        viewsFromSubmissionsSnapshot: record.viewsFromSnapshot,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        exemptionReason: record.exemptionReason,
      };
    }),
  adminUpdateStatus: demographicsReviewerRoleProcedure
    .input(
      z.object({
        id: z.string(),
        approvalMethod: z.enum(["user", "mod", "api"]).optional(),
        status: z.enum([
          "created",
          "pending",
          "approved",
          "needs-human-review",
          "cancelled",
          "rejected",
        ]),
        // Optional country breakdown entered by the moderator while watching
        // the screen recording. Populates parsed_data so the campaign
        // demographics rollup (updateCampaignDemographics) can include this
        // row. Validated against the shared demographicSchema.
        parsedData: z
          .object({
            countries: z.array(
              z.object({
                country: z.string().min(1),
                percentage: z.number().min(0).max(100),
              })
            ),
          })
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      const [existing] = await db
        .select({
          id: demographics_verification_v2.id,
          userId: demographics_verification_v2.user_id,
          verifiedUserId: demographics_verification_v2.verified_user_id,
          parsedData: demographics_verification_v2.parsed_data,
          screenshotFileUrl: demographics_verification_v2.screenshot_file_url,
          exemptionReason: demographics_verification_v2.exemption_reason,
        })
        .from(demographics_verification_v2)
        .where(eq(demographics_verification_v2.id, input.id))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Claim not found" });
      }

      const updateData: Record<string, unknown> = {
        status: input.status,
        approval_method: input.approvalMethod ?? null,
      };

      if (input.parsedData) {
        const parsed = demographicSchema.safeParse({
          version: "v1",
          ...input.parsedData,
        });
        if (!parsed.success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Invalid country breakdown: " +
              parsed.error.errors.map((e) => e.message).join(", "),
          });
        }
        updateData.parsed_data = parsed.data;
      }

      await db
        .update(demographics_verification_v2)
        .set(updateData)
        .where(eq(demographics_verification_v2.id, input.id))
        .limit(1);

      // A decision on the account's audience (approve/reject) applies to every
      // campaign that account runs in — one review covers them all. Other
      // statuses stay row-local so a mod can nudge a single campaign's row.
      // The fan-out MUST carry the reviewed row's audience (parsed_data +
      // recording), not the sparse updateData: a sibling that was batch-created
      // or reset in the meantime has null/stale parsed_data, and flipping it to
      // 'approved' without the audience would silently drop that account from
      // its campaign's US% rollup (the rollup skips null-parsed_data rows).
      // Approval is what releases the hold, so it is also when the withdrawal
      // gets raised - the clipper no longer presses Claim. Best-effort and
      // awaited but never fatal: see lib/auto-claim.ts for every skip case.
      if (input.status === "approved" && existing.userId) {
        await autoClaimAfterApproval(existing.userId);
      }

      if (input.status === "approved" || input.status === "rejected") {
        const fanOutSet: Record<string, unknown> = {
          ...updateData,
          parsed_data:
            "parsed_data" in updateData
              ? updateData.parsed_data
              : existing.parsedData,
          screenshot_file_url: existing.screenshotFileUrl,
          exemption_reason: existing.exemptionReason,
        };
        await fanOutDemographicToSiblings({
          verifiedUserId: existing.verifiedUserId,
          userId: existing.userId,
          excludeId: input.id,
          set: fanOutSet,
          // Approve only fills the account's still-pending campaigns; reject
          // must also claw it back out of campaigns where it was already
          // approved, so a bad audience can't linger live anywhere.
          statuses:
            input.status === "rejected"
              ? DEMOGRAPHICS_REJECT_STATUSES
              : undefined,
        });

        // The fan-out changed the approved set of every campaign this account
        // runs in, so refresh each of their cached demographics_json (a mod
        // can't know which siblings the fan-out touched, and the client
        // dashboards read the cache). Best-effort: a stale cache is recoverable
        // via the manual recompute, so a failure here must not fail the review.
        try {
          const affected = await db
            .selectDistinct({
              campaignId: demographics_verification_v2.campaign_id,
            })
            .from(demographics_verification_v2)
            .where(
              and(
                eq(
                  demographics_verification_v2.verified_user_id,
                  existing.verifiedUserId
                ),
                eq(demographics_verification_v2.user_id, existing.userId)
              )
            );
          await Promise.all(
            affected.map((row) =>
              recomputeCampaignDemographics(row.campaignId)
            )
          );
        } catch (recomputeError) {
          console.error(
            "demographics recompute after review fan-out failed",
            recomputeError
          );
        }
      }

      // ── Weekly hold → clearance ──
      // Approving this week's report is the SECOND check: it releases the
      // clipper's held earnings. Base always clears; the geo bonus clears only
      // where the account still meets the campaign's criteria on this freshly
      // approved audience, and is cancelled where it doesn't.
      //
      // Runs only after every account of this clipper is approved for the
      // cycle, because the payout gate is all-or-nothing — releasing early
      // would hand over money while another account is still unreviewed.
      //
      // Best-effort: the review itself has already been recorded, so a failure
      // here must not fail the mod's action. It is idempotent, so the next
      // approval (or a manual re-run) picks up whatever was missed.
      if (input.status === "approved") {
        try {
          const eligibility = await getPayoutEligibility(existing.userId);
          if (eligibility.eligible) {
            const result = await runClearanceForUser(existing.userId);
            if (result.rowsCleared || result.rowsCancelled) {
              console.log(
                `💰 clearance for ${existing.userId}: released $${result.clearedAmount.toFixed(
                  2
                )}, cancelled $${result.cancelledAmount.toFixed(2)} of geo bonus`
              );
            }
          }
        } catch (clearanceError) {
          console.error("weekly clearance after approval failed", clearanceError);
        }
      }

      return { status: input.status };
    }),
  bulkActivateByCampaign: demographicsReviewerRoleProcedure
    .input(
      z.object({
        campaignId: z.string().min(1, "Campaign ID is required"),
        updatedSince: z.coerce.date(),
      })
    )
    .mutation(async ({ input }) => {
      const filters = and(
        eq(demographics_verification_v2.campaign_id, input.campaignId),
        gte(demographics_verification_v2.updated_at, input.updatedSince)
      );

      const [matchingCount] = await db
        .select({ count: count(demographics_verification_v2.id) })
        .from(demographics_verification_v2)
        .where(filters);

      const totalToUpdate = Number(matchingCount?.count ?? 0);

      if (totalToUpdate === 0) {
        return { updatedCount: 0 };
      }

      await db
        .update(demographics_verification_v2)
        .set({
          status: "active",
          approval_method: null,
          screenshot_file_url: null,
          // Clear BOTH recording columns. A reset means "file this again", so
          // leaving the weekly form's column populated would hand the reviewer
          // last cycle's video for a fresh ask — which is exactly what they
          // would approve against. (demographics-reset.ts already does this;
          // these two older bulk resets were only clearing the legacy column,
          // which was invisible until the review dialog started reading it.)
          evidence_video_url: null,
          parsed_data: null,
          exemption_reason: null,
        })
        .where(filters);

      return { updatedCount: totalToUpdate };
    }),
  // Reset demographics across several campaigns in one shot (the payout-prep
  // button on the Clipping Campaigns page). Runs the same per-campaign reset
  // for each selected campaign and reports a per-campaign breakdown.
  bulkActivateByCampaigns: demographicsReviewerRoleProcedure
    .input(
      z.object({
        campaignIds: z
          .array(z.string().min(1))
          .min(1, "Pick at least one campaign"),
        updatedSince: z.coerce.date(),
        // Optionally set the screen-recording window on these campaigns as part
        // of the reset (7/28/90 days, or null to clear). Omit to leave as-is.
        recordingPeriodDays: z
          .union([z.literal(7), z.literal(28), z.literal(90)])
          .nullable()
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      const campaignIds = [...new Set(input.campaignIds)];
      // All-or-nothing: a mid-loop DB failure rolls back every campaign, so the
      // "Reset failed" toast is truthful (no campaigns half-reset behind it).
      return db.transaction(async (tx) => {
        const perCampaign: { campaignId: string; updatedCount: number }[] = [];
        let totalUpdated = 0;

        if (input.recordingPeriodDays !== undefined) {
          await tx
            .update(campaigns)
            .set({
              demographics_recording_period_days: input.recordingPeriodDays,
            })
            .where(inArray(campaigns.id, campaignIds));
        }

        for (const campaignId of campaignIds) {
          const filters = and(
            eq(demographics_verification_v2.campaign_id, campaignId),
            gte(demographics_verification_v2.updated_at, input.updatedSince)
          );

          const [matchingCount] = await tx
            .select({ count: count(demographics_verification_v2.id) })
            .from(demographics_verification_v2)
            .where(filters);
          const n = Number(matchingCount?.count ?? 0);

          if (n > 0) {
            await tx
              .update(demographics_verification_v2)
              .set({
                status: "active",
                approval_method: null,
                screenshot_file_url: null,
                // Both columns — see the single-campaign reset above.
                evidence_video_url: null,
                parsed_data: null,
                exemption_reason: null,
              })
              .where(filters);
          }

          perCampaign.push({ campaignId, updatedCount: n });
          totalUpdated += n;
        }

        return { totalUpdated, perCampaign };
      });
    }),
  getClaim: protectedProcedure
    .input(claimIdInput)
    .query(async ({ input, ctx }) => {
      await assertClaimAccess(input.id, ctx.user?.id);

      const [record] = await db
        .select(claimSelect)
        .from(demographics_verification_v2)
        .leftJoin(
          campaigns,
          eq(demographics_verification_v2.campaign_id, campaigns.id)
        )
        .leftJoin(
          verified_users,
          eq(demographics_verification_v2.verified_user_id, verified_users.id)
        )
        .where(eq(demographics_verification_v2.id, input.id))
        .limit(1);

      if (!record) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Claim not found" });
      }

      let parsedData;
      if (record.parsedData) {
        const parsed = demographicSchema.safeParse(record.parsedData);
        if (parsed.success) {
          parsedData = parsed.data;
        }
      }

      // Every campaign this one submission will cover — the same account's
      // rows in the SAME awaiting set the submit fan-out writes to, so the
      // scope and (crucially) the required window aren't undercounted by a
      // 'created'/'needs-human-review' sibling the recording will also cover.
      const coveredRows = await db
        .select({
          campaignId: demographics_verification_v2.campaign_id,
          campaignTitle: campaigns.title,
          recordingPeriodDays: campaigns.demographics_recording_period_days,
        })
        .from(demographics_verification_v2)
        .leftJoin(
          campaigns,
          eq(demographics_verification_v2.campaign_id, campaigns.id)
        )
        .where(
          and(
            eq(
              demographics_verification_v2.verified_user_id,
              record.verifiedUserId
            ),
            eq(demographics_verification_v2.user_id, ctx.user!.id),
            inArray(
              demographics_verification_v2.status,
              DEMOGRAPHICS_AWAITING_STATUSES
            )
          )
        );
      const coveredByCampaign = new Map<string, string>();
      // One recording covers several campaigns; if their windows differ, ask
      // for the LONGEST so it satisfies every campaign (a 90-day recording
      // covers a 7-day requirement). null everywhere = no specific window.
      let requiredRecordingPeriodDays: number | null = null;
      for (const row of coveredRows) {
        coveredByCampaign.set(
          row.campaignId,
          row.campaignTitle ?? "Untitled campaign"
        );
        if (
          row.recordingPeriodDays != null &&
          (requiredRecordingPeriodDays == null ||
            row.recordingPeriodDays > requiredRecordingPeriodDays)
        ) {
          requiredRecordingPeriodDays = row.recordingPeriodDays;
        }
      }

      return {
        id: record.id,
        campaignId: record.campaignId,
        campaignTitle: record.campaignTitle,
        campaignCreatedAt: record.campaignCreatedAt,
        verifiedHandle: record.verifiedHandle,
        verifiedPlatform: record.verifiedPlatform,
        verifiedUsername: record.verifiedUsername,
        screenshotFileUrl: record.screenshotFileUrl,
        parsedData,
        status: record.status,
        viewsFromSubmissionsSnapshot: record.viewsFromSnapshot,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        exemptionReason: record.exemptionReason,
        coveredCampaignTitles: [...coveredByCampaign.values()],
        coveredCampaignCount: coveredByCampaign.size,
        requiredRecordingPeriodDays,
      };
    }),
  // Clipper submits an unlisted YouTube link of their screen recording.
  // Goes straight to the moderator queue (status="pending"). No upload,
  // no AI parsing, no creator self-attestation.
  // The column is named `screenshot_file_url` for historical reasons —
  // a rename is a separate DB migration.
  submitVideoLink: protectedProcedure
    .input(videoLinkInput)
    .mutation(async ({ input, ctx }) => {
      const claim = await assertClaimAccess(input.id, ctx.user?.id);

      // Build the update — always set the video URL + status, conditionally
      // store the clipper-entered country breakdown if they filled the form.
      const updateData: Record<string, unknown> = {
        screenshot_file_url: input.videoUrl,
        status: "needs-human-review",
        approval_method: null,
        exemption_reason: null,
      };

      if (input.parsedData) {
        // Require explicit attestation when country data is provided —
        // catches edge cases where the form sent data without the checkbox.
        if (!input.attestationConfirmed) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "You must confirm the country breakdown is accurate before submitting.",
          });
        }
        const parsed = demographicSchema.safeParse({
          version: "v1",
          ...input.parsedData,
        });
        if (!parsed.success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Invalid country breakdown: " +
              parsed.error.errors.map((e) => e.message).join(", "),
          });
        }
        updateData.parsed_data = parsed.data;
      } else {
        // Clipper submitted only the URL with no country data — clear any
        // stale parsed_data so the mod starts from a blank form.
        updateData.parsed_data = null;
      }

      await db
        .update(demographics_verification_v2)
        .set(updateData)
        .where(
          and(
            eq(demographics_verification_v2.id, input.id),
            eq(demographics_verification_v2.user_id, ctx.user!.id)
          )
        )
        .limit(1);

      // Same account, other campaigns: one recording covers them all.
      await fanOutDemographicToSiblings({
        verifiedUserId: claim.verifiedUserId,
        userId: ctx.user!.id,
        excludeId: input.id,
        set: updateData,
      });

      return {
        status: "needs-human-review" as const,
        videoUrl: input.videoUrl,
      };
    }),
  // Clipper requests an exemption (no analytics available). Goes to mod queue.
  submitExemption: protectedProcedure
    .input(exemptionInput)
    .mutation(async ({ input, ctx }) => {
      const claim = await assertClaimAccess(input.id, ctx.user?.id);

      const exemptionSet = {
        screenshot_file_url: null,
        exemption_reason: input.exemptionReason.trim(),
        status: "needs-human-review" as const,
        approval_method: null,
      };

      await db
        .update(demographics_verification_v2)
        .set(exemptionSet)
        .where(
          and(
            eq(demographics_verification_v2.id, input.id),
            eq(demographics_verification_v2.user_id, ctx.user!.id)
          )
        )
        .limit(1);

      // Same account, other campaigns: one exemption covers them all.
      await fanOutDemographicToSiblings({
        verifiedUserId: claim.verifiedUserId,
        userId: ctx.user!.id,
        excludeId: input.id,
        set: exemptionSet,
      });

      return { status: "pending" as const };
    }),

  updateCampaignDemographics: demographicsReviewerRoleProcedure
    .input(
      z.object({
        campaignId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      await recomputeCampaignDemographics(input.campaignId);
    }),

  // ── US Demographics panel ─────────────────────────────────────────────
  // Per-campaign toggle between the NEW method (Other in the denominator,
  // accurate) and the OLD method (Other dropped + renormalized, inflates).
  // LOCKED to a single owner (@channelprnv) — this panel produces
  // client-facing inflated numbers, so only the owner may see or change it,
  // regardless of role. The real gate is these backend checks.

  getUsDemographicsAccess: protectedProcedure.query(({ ctx }) => ({
    isOwner: isUsDemographicsOwner(ctx),
  })),

  getUsDemographicsOverview: protectedProcedure.query(
    async ({ ctx }) => {
      assertUsDemographicsOwner(ctx);
      // ENDED campaigns are included on purpose. The client-facing US number
      // still matters after a campaign closes — final reports and invoices get
      // written from it — so the method must stay switchable. Ongoing first,
      // then ended, newest first within each group. Soft-deleted cards are the
      // only exclusion (they are gone from the product entirely).
      const ongoing = await db
        .select({
          id: campaigns.id,
          title: campaigns.title,
          useOldMethod: campaigns.demographics_use_old_method,
          ended: campaigns.ended,
          active: campaigns.active,
        })
        .from(campaigns)
        .where(isNull(campaigns.card_deleted_at))
        .orderBy(
          asc(sql`CASE WHEN ${campaigns.active} = 1 AND ${campaigns.ended} = 0 THEN 0 ELSE 1 END`),
          desc(campaigns.created_at)
        );

      const result: {
        campaignId: string;
        title: string | null;
        useOldMethod: boolean;
        ended: boolean;
        measuredClippers: number;
        newMethod: { usPct: number; countries: { country: string; percentage: number }[] };
        oldMethod: { usPct: number; countries: { country: string; percentage: number }[] };
      }[] = [];
      for (const c of ongoing) {
        // Compute BOTH methods live from current approved data so the panel
        // shows the true before/after (never the possibly-stale stored json).
        const rows = await getApprovedDemographics(c.id);
        const newMethod = computeDemographicsBreakdown(rows, {
          excludeOther: false,
        });
        const oldMethod = computeDemographicsBreakdown(rows, {
          excludeOther: true,
        });
        const measured = rows.filter((r) => r.parsed_data).length;
        result.push({
          campaignId: c.id,
          title: c.title,
          useOldMethod: Boolean(c.useOldMethod),
          ended: Boolean(c.ended) || !c.active,
          measuredClippers: measured,
          newMethod: { usPct: usPercent(newMethod), countries: newMethod.countries },
          oldMethod: { usPct: usPercent(oldMethod), countries: oldMethod.countries },
        });
      }
      return result;
    }
  ),

  // ── Repair the "Views snapshot" column ──
  // Reports filed through the older submitWeekly path recorded a hardcoded 0
  // view total. That column is not decoration: computeDemographicsBreakdown
  // WEIGHTS each report by it, so a row sitting at 0 contributes nothing to its
  // campaign's country percentages — and once a moderator approves it, that 0
  // is baked in permanently.
  //
  // Exposed as an admin action rather than a script because the team has no
  // write access to the production database; the same reason stableIdBackfill
  // is an endpoint. Idempotent — a second run finds nothing to do.
  repairViewSnapshotsStatus: demographicsReviewerRoleProcedure.query(
    async () => {
      const [pending] = await db
        .select({ c: count() })
        .from(demographics_verification_v2)
        .where(
          and(
            eq(demographics_verification_v2.views_from_submissions_snapshot, 0),
            inArray(demographics_verification_v2.status, [
              ...SNAPSHOT_REPAIRABLE_STATUSES,
            ])
          )
        );
      const [approvedAtZero] = await db
        .select({ c: count() })
        .from(demographics_verification_v2)
        .where(
          and(
            eq(demographics_verification_v2.views_from_submissions_snapshot, 0),
            eq(demographics_verification_v2.status, "approved")
          )
        );
      return {
        awaitingRepair: Number(pending?.c ?? 0),
        approvedAtZero: Number(approvedAtZero?.c ?? 0),
      };
    }
  ),

  repairViewSnapshots: demographicsReviewerRoleProcedure.mutation(async () => {
    const candidates = await db
      .select({
        id: demographics_verification_v2.id,
        campaignId: demographics_verification_v2.campaign_id,
        userId: demographics_verification_v2.user_id,
        verifiedUserId: demographics_verification_v2.verified_user_id,
      })
      .from(demographics_verification_v2)
      .where(
        and(
          eq(demographics_verification_v2.views_from_submissions_snapshot, 0),
          // Already-APPROVED rows are deliberately excluded: re-weighting a
          // settled report would retroactively move campaign demographics that
          // may already have gone to a client. Their count is reported by
          // repairViewSnapshotsStatus so the call stays a human decision.
          inArray(demographics_verification_v2.status, [
            ...SNAPSHOT_REPAIRABLE_STATUSES,
          ])
        )
      );

    let repaired = 0;
    let leftAtZero = 0;

    for (const row of candidates) {
      const [totals] = await db
        .select({ views: sql<number>`COALESCE(SUM(${submissions.views}), 0)` })
        .from(submissions)
        .where(
          and(
            eq(submissions.campaign_id, row.campaignId),
            eq(submissions.user_id, row.userId),
            eq(submissions.verified_user_id, row.verifiedUserId),
            eq(submissions.status, "approved"),
            isNull(submissions.deleted_at)
          )
        );

      const views = Number(totals?.views ?? 0);
      // 0 is the right answer for an account with no approved views — leave it.
      if (views <= 0) {
        leftAtZero += 1;
        continue;
      }

      await db
        .update(demographics_verification_v2)
        .set({ views_from_submissions_snapshot: views })
        .where(eq(demographics_verification_v2.id, row.id));
      repaired += 1;
    }

    return { scanned: candidates.length, repaired, leftAtZero };
  }),

  setCampaignDemographicsMethod: protectedProcedure
    .input(
      z.object({
        campaignId: z.string(),
        useOldMethod: z.boolean(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      assertUsDemographicsOwner(ctx);
      const [campaign] = await db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(eq(campaigns.id, input.campaignId))
        .limit(1);
      if (!campaign) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
      }

      // Persist the flag, then re-run the rollup so the stored demographics_json
      // (what the client dashboard + admin stats display) reflects the choice
      // immediately.
      await db
        .update(campaigns)
        .set({ demographics_use_old_method: input.useOldMethod })
        .where(eq(campaigns.id, input.campaignId));

      const rows = await getApprovedDemographics(input.campaignId);
      const breakdown = computeDemographicsBreakdown(rows, {
        excludeOther: input.useOldMethod,
      });
      await db
        .update(campaigns)
        .set({ demographics_json: breakdown })
        .where(eq(campaigns.id, input.campaignId));

      return { useOldMethod: input.useOldMethod, usPct: usPercent(breakdown) };
    }),
});

// The US Demographics panel is locked to ONE person — @channelprnv. Because
// it can flip campaigns to the inflated (client-facing) method, no role
// grants access; only this exact Discord id does.
const US_DEMOGRAPHICS_OWNER_DISCORD_ID = "296884557972504577";

const isUsDemographicsOwner = (ctx: { user: { id: string; discordId?: string | null } }) =>
  (ctx.user.discordId ?? ctx.user.id) === US_DEMOGRAPHICS_OWNER_DISCORD_ID;

const assertUsDemographicsOwner = (ctx: { user: { id: string; discordId?: string | null } }) => {
  if (!isUsDemographicsOwner(ctx)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This panel is restricted.",
    });
  }
};

// Approved demographic rows for a campaign (the rollup source).
const getApprovedDemographics = (campaignId: string) =>
  db
    .select()
    .from(demographics_verification_v2)
    .where(
      and(
        eq(demographics_verification_v2.campaign_id, campaignId),
        eq(demographics_verification_v2.status, "approved")
      )
    );

// Pure rollup: view-weighted (by views_from_submissions_snapshot, unchanged
// from the original) country breakdown. When excludeOther is true, the
// "Other" bucket is dropped from BOTH the per-country sums and the
// denominator — i.e. the named countries are re-normalized to 100% (the OLD,
// inflating method). "Other" is a normal enum member of parsed_data.countries.
const computeDemographicsBreakdown = (
  approvedRows: Awaited<ReturnType<typeof getApprovedDemographics>>,
  { excludeOther }: { excludeOther: boolean }
) => {
  const countries: Record<string, number> = {};
  let totalViews = 0;
  for (const demographics of approvedRows) {
    // Video-flow rows lack parsed_data — skip (parse would throw).
    if (!demographics.parsed_data) continue;
    const parsed = demographicSchema.parse(demographics.parsed_data);
    for (const country of parsed.countries) {
      if (excludeOther && country.country === "Other") continue;
      const approxNumOfSubmissions =
        (country.percentage / 100) *
        demographics.views_from_submissions_snapshot;
      totalViews += approxNumOfSubmissions;
      countries[country.country] =
        (countries[country.country] || 0) + approxNumOfSubmissions;
    }
  }
  return {
    version: "v1" as const,
    countries: Object.entries(countries).map(([country, submissionCount]) => ({
      country,
      percentage:
        totalViews > 0
          ? Number(((submissionCount / totalViews) * 100).toFixed(2))
          : 0,
    })),
  };
};

// US share (%) from a computed breakdown. The enum stores the US as
// "United States" (backend/src/lib/zod-schemas/demographic.ts:109).
const usPercent = (
  breakdown: ReturnType<typeof computeDemographicsBreakdown>
) => {
  const us = breakdown.countries.find((c) => c.country === "United States");
  return us ? us.percentage : 0;
};

// Recompute one campaign's cached demographics_json from its approved rows,
// honoring that campaign's old/new-method toggle. Shared by the manual admin
// recompute button and the approve/reject fan-out — so when one review approves
// an account across several campaigns, each of those campaigns' client-facing
// numbers refresh instead of silently going stale on the cached json.
export const recomputeCampaignDemographics = async (campaignId: string) => {
  const [campaign] = await db
    .select({ useOldMethod: campaigns.demographics_use_old_method })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  const rows = await getApprovedDemographics(campaignId);
  const breakdown = computeDemographicsBreakdown(rows, {
    excludeOther: Boolean(campaign?.useOldMethod),
  });
  await db
    .update(campaigns)
    .set({ demographics_json: breakdown })
    .where(eq(campaigns.id, campaignId));
};
