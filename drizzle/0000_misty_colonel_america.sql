CREATE TABLE "activities" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"pack_version" text NOT NULL,
	"level" text NOT NULL,
	"format" text NOT NULL,
	"prompt" text NOT NULL,
	"starter_assets" jsonb NOT NULL,
	"rubric" jsonb NOT NULL,
	"status" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment_items" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"blueprint_id" text NOT NULL,
	"blueprint_version" text NOT NULL,
	"generated_question" jsonb NOT NULL,
	"difficulty_factors" jsonb NOT NULL,
	"validation_evidence" jsonb NOT NULL,
	"answer_rules" jsonb NOT NULL,
	"review_snapshot" jsonb NOT NULL,
	"owner_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"session_id" text NOT NULL,
	"selected_answers" jsonb NOT NULL,
	"justification" text NOT NULL,
	"response_time_ms" integer NOT NULL,
	"partial_credit" numeric NOT NULL,
	"feedback" jsonb NOT NULL,
	"challenge_state" text NOT NULL,
	"mastery_evidence" jsonb NOT NULL,
	"owner_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"topic_coverage" jsonb NOT NULL,
	"timing_policy" jsonb NOT NULL,
	"score" numeric NOT NULL,
	"confidence" numeric NOT NULL,
	"mastery_impact" jsonb NOT NULL,
	"status" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"response" jsonb NOT NULL,
	"execution_result" jsonb NOT NULL,
	"score" numeric NOT NULL,
	"hint_count" integer NOT NULL,
	"feedback" jsonb NOT NULL,
	"completion_state" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learner_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"preferences" jsonb NOT NULL,
	"onboarding_state" jsonb NOT NULL,
	"owner_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"domain_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"score_delta" numeric NOT NULL,
	"confidence_delta" numeric NOT NULL,
	"owner_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"activity_metadata" jsonb NOT NULL,
	"rationale" text NOT NULL,
	"status" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"duration_seconds" integer NOT NULL,
	"outcomes" jsonb NOT NULL,
	"recap" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_mastery" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"pack_version" text NOT NULL,
	"score" numeric NOT NULL,
	"level_band" text NOT NULL,
	"confidence" numeric NOT NULL,
	"evidence_summary" jsonb NOT NULL,
	"owner_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "_users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "activities_owner_idx" ON "activities" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "assessment_items_owner_idx" ON "assessment_items" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "assessment_responses_owner_idx" ON "assessment_responses" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "assessment_sessions_owner_idx" ON "assessment_sessions" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "attempts_owner_idx" ON "attempts" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "learner_profiles_owner_idx" ON "learner_profiles" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "learning_events_owner_idx" ON "learning_events" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "recommendations_owner_idx" ON "recommendations" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "study_sessions_owner_idx" ON "study_sessions" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "topic_mastery_owner_idx" ON "topic_mastery" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "_users_email_unique" ON "_users" USING btree ("email");