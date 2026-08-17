CREATE TABLE `amm_operations` (
	`id` varchar(64) NOT NULL,
	`organization_id` varchar(64) NOT NULL,
	`org_membership_id` varchar(64) NOT NULL,
	`operation_key` varchar(128) NOT NULL,
	`operation` varchar(128) NOT NULL,
	`request_digest` varchar(255) NOT NULL,
	`amm_run_id` varchar(128),
	`state` enum('reserved','running','completed','cancelled') NOT NULL DEFAULT 'reserved',
	`reserved_units` bigint NOT NULL,
	`actual_units` bigint NOT NULL DEFAULT 0,
	`provider_calls` int NOT NULL DEFAULT 0,
	`upstream_cost_usd` decimal(20,8) NOT NULL DEFAULT '0',
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`completed_at` timestamp(3),
	CONSTRAINT `amm_operations_id` PRIMARY KEY(`id`),
	CONSTRAINT `amm_operations_organization_key` UNIQUE(`organization_id`,`operation_key`)
);
--> statement-breakpoint
CREATE TABLE `amm_usage_buckets` (
	`id` varchar(64) NOT NULL,
	`organization_id` varchar(64) NOT NULL,
	`limit_units` bigint NOT NULL,
	`reserved_units` bigint NOT NULL DEFAULT 0,
	`used_units` bigint NOT NULL DEFAULT 0,
	`window_start_at` timestamp(3) NOT NULL,
	`window_end_at` timestamp(3) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `amm_usage_buckets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `amm_usage_ledger_entries` (
	`id` varchar(64) NOT NULL,
	`organization_id` varchar(64) NOT NULL,
	`org_membership_id` varchar(64) NOT NULL,
	`operation_id` varchar(64) NOT NULL,
	`event` varchar(32) NOT NULL,
	`capability` varchar(128) NOT NULL,
	`quantity_units` bigint NOT NULL,
	`provider_calls` int NOT NULL,
	`upstream_cost_usd` decimal(20,8) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `amm_usage_ledger_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `amm_usage_ledger_entries_operation_event` UNIQUE(`operation_id`,`event`)
);
--> statement-breakpoint
CREATE INDEX `amm_operations_organization_id` ON `amm_operations` (`organization_id`);--> statement-breakpoint
CREATE INDEX `amm_operations_org_membership_id` ON `amm_operations` (`org_membership_id`);--> statement-breakpoint
CREATE INDEX `amm_operations_amm_run_id` ON `amm_operations` (`amm_run_id`);--> statement-breakpoint
CREATE INDEX `amm_usage_buckets_organization_window` ON `amm_usage_buckets` (`organization_id`,`window_start_at`,`window_end_at`);--> statement-breakpoint
CREATE INDEX `amm_usage_ledger_entries_organization_id` ON `amm_usage_ledger_entries` (`organization_id`);--> statement-breakpoint
CREATE INDEX `amm_usage_ledger_entries_org_membership_id` ON `amm_usage_ledger_entries` (`org_membership_id`);