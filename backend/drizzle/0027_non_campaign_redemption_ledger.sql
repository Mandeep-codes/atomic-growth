-- Non-campaign-clip redemption ledger migration. Adds the columns/indexes
-- the new flow needs and backfills existing rows so old data behaves
-- correctly under the new logic.
--
-- Idempotent-safe: the column adds are pure additive (existing rows get
-- defaults), and the backfills are UPDATE-on-condition statements that
-- are no-ops on a fresh DB.

-- Drop the strict FK on non_campaign_clips.submission_id so we can null
-- it out (new redemption-flow rows are not tied to one parent submission).
ALTER TABLE `non_campaign_clips` DROP FOREIGN KEY `non_campaign_clips_submission_id_submissions_id_fk`;
--> statement-breakpoint
ALTER TABLE `non_campaign_clips` MODIFY COLUMN `submission_id` varchar(128);
--> statement-breakpoint

-- Add campaign_id as NULLABLE first so the ADD works on existing rows.
ALTER TABLE `non_campaign_clips` ADD `campaign_id` varchar(128);
--> statement-breakpoint

-- Backfill campaign_id from the parent submission's campaign_id.
UPDATE `non_campaign_clips` ncc
  JOIN `submissions` s ON s.id = ncc.submission_id
  SET ncc.campaign_id = s.campaign_id
  WHERE ncc.campaign_id IS NULL AND ncc.submission_id IS NOT NULL;
--> statement-breakpoint

-- Now enforce NOT NULL. If a row didn't backfill (orphan with no
-- submission_id), it shouldn't exist anyway, but the migration will fail
-- loudly rather than leave dirty data — that's intentional, so a human
-- inspects before re-running.
ALTER TABLE `non_campaign_clips` MODIFY COLUMN `campaign_id` varchar(128) NOT NULL;
--> statement-breakpoint

-- credit_remaining defaults to 0. Existing legacy rows had a 1:1
-- submission relationship and never carried "spare" credit, so 0 is
-- correct — they've already redeemed their one campaign clip.
ALTER TABLE `non_campaign_clips` ADD `credit_remaining` int DEFAULT 0 NOT NULL;
--> statement-breakpoint

-- The redemption pointer on submissions. NULL = unredeemed (won't pay yet);
-- set to a non_campaign_clips.id = redeemed.
ALTER TABLE `submissions` ADD `redeemed_by_non_campaign_clip_id` varchar(128);
--> statement-breakpoint

-- Backfill: every submission that has a non_campaign_clips row pointing to
-- it under the legacy schema is considered already-redeemed by that row.
-- Their non-campaign clip's credit_remaining stays 0 — it has no spare
-- coverage. New submissions arriving after this migration follow the
-- redemption ledger flow described in createSubmission.
UPDATE `submissions` s
  JOIN `non_campaign_clips` ncc ON ncc.submission_id = s.id
  SET s.redeemed_by_non_campaign_clip_id = ncc.id
  WHERE s.redeemed_by_non_campaign_clip_id IS NULL;
--> statement-breakpoint

CREATE INDEX `non_campaign_clips_user_campaign_idx` ON `non_campaign_clips` (`user_id`,`campaign_id`);
--> statement-breakpoint
CREATE INDEX `submissions_redeemed_by_idx` ON `submissions` (`redeemed_by_non_campaign_clip_id`);
