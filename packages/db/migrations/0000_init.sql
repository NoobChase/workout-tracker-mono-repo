CREATE TYPE "public"."distance_unit" AS ENUM('MI', 'KM', 'M', 'FT');--> statement-breakpoint
CREATE TYPE "public"."metric_kind" AS ENUM('REPS', 'WEIGHT', 'DURATION', 'DISTANCE', 'COMPLETED', 'RPE');--> statement-breakpoint
CREATE TYPE "public"."program_status" AS ENUM('DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('IN_PROGRESS', 'COMPLETED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."set_type" AS ENUM('NORMAL', 'WARMUP', 'DROP');--> statement-breakpoint
CREATE TYPE "public"."sub_status" AS ENUM('NONE', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."weight_unit" AS ENUM('LB', 'KG');--> statement-breakpoint
CREATE TABLE "exercise_metrics" (
	"exercise_id" uuid NOT NULL,
	"metric" "metric_kind" NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	CONSTRAINT "exercise_metrics_pkey" PRIMARY KEY("exercise_id","metric")
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid,
	"name" text NOT NULL,
	"muscle_group" text,
	"equipment" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planned_exercises" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workout_id" uuid NOT NULL,
	"exercise_id" uuid,
	"placeholder_label" text,
	"position" smallint NOT NULL,
	"target_sets" smallint,
	"group_key" smallint,
	"notes" text,
	CONSTRAINT "planned_exercises_workout_id_position_key" UNIQUE("workout_id","position"),
	CONSTRAINT "planned_exercises_position_check" CHECK ("planned_exercises"."position" >= 0),
	CONSTRAINT "planned_exercises_target_sets_check" CHECK ("planned_exercises"."target_sets" > 0),
	CONSTRAINT "planned_exercises_exercise_or_placeholder_check" CHECK (num_nonnulls("planned_exercises"."exercise_id", "planned_exercises"."placeholder_label") = 1)
);
--> statement-breakpoint
CREATE TABLE "planned_sets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"planned_exercise_id" uuid NOT NULL,
	"set_number" smallint NOT NULL,
	"target_reps_min" smallint,
	"target_reps_max" smallint,
	"target_weight" numeric(7, 2),
	"weight_unit" "weight_unit",
	"target_weight_kg" numeric(10, 4) GENERATED ALWAYS AS (target_weight * CASE weight_unit WHEN 'KG' THEN 1 WHEN 'LB' THEN 0.45359237 END) STORED,
	"target_duration_seconds" integer,
	"target_distance" numeric(9, 3),
	"distance_unit" "distance_unit",
	"target_rpe" numeric(3, 1),
	"notes" text,
	CONSTRAINT "planned_sets_planned_exercise_id_set_number_key" UNIQUE("planned_exercise_id","set_number"),
	CONSTRAINT "planned_sets_set_number_check" CHECK ("planned_sets"."set_number" >= 1),
	CONSTRAINT "planned_sets_target_reps_min_check" CHECK ("planned_sets"."target_reps_min" >= 0),
	CONSTRAINT "planned_sets_target_reps_max_check" CHECK ("planned_sets"."target_reps_max" >= 0),
	CONSTRAINT "planned_sets_target_weight_check" CHECK ("planned_sets"."target_weight" >= 0),
	CONSTRAINT "planned_sets_target_duration_seconds_check" CHECK ("planned_sets"."target_duration_seconds" >= 0),
	CONSTRAINT "planned_sets_target_distance_check" CHECK ("planned_sets"."target_distance" >= 0),
	CONSTRAINT "planned_sets_target_rpe_check" CHECK ("planned_sets"."target_rpe" BETWEEN 0 AND 10),
	CONSTRAINT "planned_sets_reps_range_check" CHECK ("planned_sets"."target_reps_min" IS NULL OR "planned_sets"."target_reps_max" IS NULL OR "planned_sets"."target_reps_min" <= "planned_sets"."target_reps_max"),
	CONSTRAINT "planned_sets_weight_unit_check" CHECK ("planned_sets"."target_weight" IS NULL OR "planned_sets"."weight_unit" IS NOT NULL),
	CONSTRAINT "planned_sets_distance_unit_check" CHECK ("planned_sets"."target_distance" IS NULL OR "planned_sets"."distance_unit" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "user_exercise_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"setup" text,
	"cues" text,
	"default_weight_unit" "weight_unit",
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_exercise_settings_user_id_exercise_id_key" UNIQUE("user_id","exercise_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"default_weight_unit" "weight_unit" DEFAULT 'LB' NOT NULL,
	"sub_status" "sub_status" DEFAULT 'NONE' NOT NULL,
	"sub_current_period_end" timestamp with time zone,
	"stripe_customer_id" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_user_id_key" UNIQUE("clerk_user_id"),
	CONSTRAINT "users_stripe_customer_id_key" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
CREATE TABLE "workout_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"program_id" uuid NOT NULL,
	"cycle_number" smallint NOT NULL,
	"name" text,
	"notes" text,
	CONSTRAINT "workout_plans_program_id_cycle_number_key" UNIQUE("program_id","cycle_number"),
	CONSTRAINT "workout_plans_cycle_number_check" CHECK ("workout_plans"."cycle_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "workout_programs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"status" "program_status" DEFAULT 'DRAFT' NOT NULL,
	"target_cycles" smallint,
	"start_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_programs_user_id_name_key" UNIQUE("user_id","name"),
	CONSTRAINT "workout_programs_target_cycles_check" CHECK ("workout_programs"."target_cycles" >= 1)
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" smallint NOT NULL,
	"notes" text,
	CONSTRAINT "workouts_plan_id_position_key" UNIQUE("plan_id","position"),
	CONSTRAINT "workouts_position_check" CHECK ("workouts"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "exercise_metrics" ADD CONSTRAINT "exercise_metrics_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_exercises" ADD CONSTRAINT "planned_exercises_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_exercises" ADD CONSTRAINT "planned_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_sets" ADD CONSTRAINT "planned_sets_planned_exercise_id_planned_exercises_id_fk" FOREIGN KEY ("planned_exercise_id") REFERENCES "public"."planned_exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_exercise_settings" ADD CONSTRAINT "user_exercise_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_exercise_settings" ADD CONSTRAINT "user_exercise_settings_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_plans" ADD CONSTRAINT "workout_plans_program_id_workout_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."workout_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_programs" ADD CONSTRAINT "workout_programs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_plan_id_workout_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."workout_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exercises_standard_name_key" ON "exercises" USING btree (lower("name")) WHERE "exercises"."owner_user_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "exercises_user_name_key" ON "exercises" USING btree ("owner_user_id",lower("name")) WHERE "exercises"."owner_user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "users_pending_purge_idx" ON "users" USING btree ("deleted_at") WHERE "users"."deleted_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_program_per_user" ON "workout_programs" USING btree ("user_id") WHERE "workout_programs"."status" = 'ACTIVE';