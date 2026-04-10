CREATE TABLE "pvp_failed_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"matchId" text NOT NULL,
	"userId" text NOT NULL,
	"wpm" integer NOT NULL,
	"accuracy" double precision NOT NULL,
	"timeMs" integer NOT NULL,
	"textLength" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"completedAt" timestamp NOT NULL,
	"retryCount" integer DEFAULT 0 NOT NULL,
	"nextRetryAt" timestamp DEFAULT now() NOT NULL,
	"lastError" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_pvp_failed_stats_drain" ON "pvp_failed_stats" USING btree ("nextRetryAt","retryCount");
--> statement-breakpoint
CREATE INDEX "idx_pvp_failed_stats_match_user" ON "pvp_failed_stats" USING btree ("matchId","userId");
