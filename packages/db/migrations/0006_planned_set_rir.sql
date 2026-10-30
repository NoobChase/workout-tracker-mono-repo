ALTER TABLE "planned_sets" ADD COLUMN "target_rir" numeric(3, 1);--> statement-breakpoint
ALTER TABLE "planned_sets" ADD CONSTRAINT "planned_sets_target_rir_check" CHECK ("planned_sets"."target_rir" BETWEEN 0 AND 10);--> statement-breakpoint
ALTER TABLE "planned_sets" ADD CONSTRAINT "planned_sets_rpe_or_rir_check" CHECK (num_nonnulls("planned_sets"."target_rpe", "planned_sets"."target_rir") <= 1);