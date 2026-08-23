import { and, count, eq, isNull, sum } from "drizzle-orm";
import { db } from "../../lib/db";
import {
  campaigns,
  submissions,
  non_campaign_clips,
  snapshot_submission_count,
  snapshot_submission_views,
  snapshot_nc_count,
  snapshot_nc_views,
} from "../../lib/schema";

export const viewsSnapshot = async () => {
  const snapshotRows = await db
    .select({
      campaignId: submissions.campaign_id,
      totalViews: sum(submissions.views),
      totalSubmissions: count(submissions.id),
    })
    .from(submissions)
    .innerJoin(campaigns, eq(submissions.campaign_id, campaigns.id))
    .where(
      and(
        eq(submissions.status, "approved"),
        eq(submissions.active, true),
        eq(campaigns.active, true),
        // Deleted clips excluded from the views-over-time graph (going forward).
        isNull(submissions.deleted_at)
      )
    )
    .groupBy(submissions.campaign_id);

  // Non-campaign clips, grouped the same way (approved clips on active
  // campaigns). NC clips have no `active` column — status='approved' is the
  // live signal. Captured into separate tables so the NC stats dashboard gets
  // its own trend line without polluting the campaign-clip series.
  const ncSnapshotRows = await db
    .select({
      campaignId: non_campaign_clips.campaign_id,
      totalViews: sum(non_campaign_clips.views),
      totalClips: count(non_campaign_clips.id),
    })
    .from(non_campaign_clips)
    .innerJoin(campaigns, eq(non_campaign_clips.campaign_id, campaigns.id))
    .where(
      and(
        eq(non_campaign_clips.status, "approved"),
        eq(campaigns.active, true)
      )
    )
    .groupBy(non_campaign_clips.campaign_id);

  if (snapshotRows.length) {
    await db.insert(snapshot_submission_views).values(
      snapshotRows.map((row) => ({
        campaign_id: row.campaignId,
        views: Number(row.totalViews ?? 0),
      }))
    );

    await db.insert(snapshot_submission_count).values(
      snapshotRows.map((row) => ({
        campaign_id: row.campaignId,
        submission_count: Number(row.totalSubmissions ?? 0),
      }))
    );
  }

  if (ncSnapshotRows.length) {
    await db.insert(snapshot_nc_views).values(
      ncSnapshotRows.map((row) => ({
        campaign_id: row.campaignId,
        views: Number(row.totalViews ?? 0),
      }))
    );

    await db.insert(snapshot_nc_count).values(
      ncSnapshotRows.map((row) => ({
        campaign_id: row.campaignId,
        clip_count: Number(row.totalClips ?? 0),
      }))
    );
  }

  return {
    recordedCampaigns: snapshotRows.length,
    recordedNcCampaigns: ncSnapshotRows.length,
  };
};
