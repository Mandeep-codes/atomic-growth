CREATE TABLE IF NOT EXISTS `audit_log` (
  `id` bigint AUTO_INCREMENT PRIMARY KEY,
  `ts` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `db_user` varchar(128) NOT NULL,
  `action` varchar(10) NOT NULL,
  `table_name` varchar(64) NOT NULL,
  `row_id` varchar(255) NULL,
  `old_data` json NULL,
  `new_data` json NULL,
  INDEX `audit_ts_idx` (`ts`),
  INDEX `audit_user_idx` (`db_user`),
  INDEX `audit_table_idx` (`table_name`)
);
