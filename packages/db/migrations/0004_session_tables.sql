CREATE TABLE "session_exercises" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"planned_exercise_id" uuid,
	"position" smallint NOT NULL,
	"group_key" smallint,
	"substitution_note" text,
	"notes" text,
	CONSTRAINT "session_exercises_session_id_position_key" UNIQUE("session_id","position"),
	CONSTRAINT "session_exercises_position_check" CHECK ("session_exercises"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "session_sets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_exercise_id" uuid NOT NULL,
	"set_number" smallint NOT NULL,
	"reps" smallint,
	"weight" numeric(7, 2),
	"weight_unit" "weight_unit",
	"weight_kg" numeric(10, 4) GENERATED ALWAYS AS (weight * CASE weight_unit WHEN 'KG' THEN 1 WHEN 'LB' THEN 0.45359237 END) STORED,
	"duration_seconds" integer,
	"distance" numeric(9, 3),
	"distance_unit" "distance_unit",
	"distance_m" numeric(12, 4) GENERATED ALWAYS AS (distance * CASE distance_unit WHEN 'M' THEN 1 WHEN 'KM' THEN 1000 WHEN 'MI' THEN 1609.344 WHEN 'FT' THEN 0.3048 END) STORED,
	"completed" boolean,
	"rpe" numeric(3, 1),
	"kind" "set_type" DEFAULT 'NORMAL' NOT NULL,
	"parent_set_id" uuid,
	"notes" text,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_sets_session_exercise_id_set_number_key" UNIQUE("session_exercise_id","set_number"),
	CONSTRAINT "session_sets_set_number_check" CHECK ("session_sets"."set_number" >= 1),
	CONSTRAINT "session_sets_reps_check" CHECK ("session_sets"."reps" >= 0),
	CONSTRAINT "session_sets_weight_check" CHECK ("session_sets"."weight" >= 0),
	CONSTRAINT "session_sets_duration_seconds_check" CHECK ("session_sets"."duration_seconds" >= 0),
	CONSTRAINT "session_sets_distance_check" CHECK ("session_sets"."distance" >= 0),
	CONSTRAINT "session_sets_rpe_check" CHECK ("session_sets"."rpe" BETWEEN 0 AND 10),
	CONSTRAINT "session_sets_weight_unit_check" CHECK ("session_sets"."weight" IS NULL OR "session_sets"."weight_unit" IS NOT NULL),
	CONSTRAINT "session_sets_distance_unit_check" CHECK ("session_sets"."distance" IS NULL OR "session_sets"."distance_unit" IS NOT NULL),
	CONSTRAINT "session_sets_has_value_check" CHECK (num_nonnulls("session_sets"."reps", "session_sets"."weight", "session_sets"."duration_seconds", "session_sets"."distance", "session_sets"."completed") > 0)
);
--> statement-breakpoint
CREATE TABLE "workout_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"workout_id" uuid,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "session_status" DEFAULT 'IN_PROGRESS' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_exercises" ADD CONSTRAINT "session_exercises_session_id_workout_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_exercises" ADD CONSTRAINT "session_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_exercises" ADD CONSTRAINT "session_exercises_planned_exercise_id_planned_exercises_id_fk" FOREIGN KEY ("planned_exercise_id") REFERENCES "public"."planned_exercises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_sets" ADD CONSTRAINT "session_sets_session_exercise_id_session_exercises_id_fk" FOREIGN KEY ("session_exercise_id") REFERENCES "public"."session_exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_sets" ADD CONSTRAINT "session_sets_parent_set_id_session_sets_id_fk" FOREIGN KEY ("parent_set_id") REFERENCES "public"."session_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_exercises_exercise_idx" ON "session_exercises" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "workout_sessions_user_date_idx" ON "workout_sessions" USING btree ("user_id","performed_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "workout_sessions_workout_idx" ON "workout_sessions" USING btree ("workout_id");