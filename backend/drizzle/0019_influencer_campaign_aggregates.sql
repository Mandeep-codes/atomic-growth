ALTER TABLE `influencer_campaigns`
  ADD COLUMN `twitter_total_replies` int NOT NULL DEFAULT 0,
  ADD COLUMN `twitter_total_quotes` int NOT NULL DEFAULT 0,
  ADD COLUMN `twitter_total_retweets` int NOT NULL DEFAULT 0,
  ADD COLUMN `twitter_total_bookmarks` int NOT NULL DEFAULT 0,
  ADD COLUMN `linkedin_total_likes` int NOT NULL DEFAULT 0,
  ADD COLUMN `linkedin_total_comments` int NOT NULL DEFAULT 0,
  ADD COLUMN `linkedin_total_reposts` int NOT NULL DEFAULT 0;
