CREATE TABLE "topic_lessons" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"kind" text NOT NULL,
	"content" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "topic_lessons_topic_kind_idx" ON "topic_lessons" USING btree ("domain_id","topic_id","kind");