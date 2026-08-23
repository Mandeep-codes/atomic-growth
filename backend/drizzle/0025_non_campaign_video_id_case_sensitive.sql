-- video_id must use a case-sensitive collation because YouTube IDs and
-- Instagram shortcodes are case-sensitive — "dQw4w9WgXcQ" and "dqw4w9wgxcq"
-- are two completely different videos. The default utf8mb4_0900_ai_ci
-- collation would falsely treat them as duplicates.
-- Drizzle doesn't expose per-column collation in its schema declaration,
-- so this is hand-written and lives outside the auto-generated migrations.
ALTER TABLE `non_campaign_clips`
  MODIFY `video_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
