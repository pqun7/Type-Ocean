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
CREATE TABLE "User" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"usernameLastChangedAt" timestamp,
	"passwordHash" text,
	"email" text NOT NULL,
	"pendingEmail" text,
	"pendingEmailRequestedAt" timestamp,
	"emailVerified" timestamp,
	"verificationReminderShownAt" timestamp,
	"image" text,
	"role" text DEFAULT 'user' NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"isPrimaryAdmin" boolean DEFAULT false NOT NULL,
	"resetToken" text,
	"resetTokenExpiry" timestamp,
	"passwordResetRequests" integer DEFAULT 0 NOT NULL,
	"emailVerifyToken" text,
	"emailVerifyTokenExpiry" timestamp,
	"emailVerificationAttempts" integer DEFAULT 0,
	"emailVerifyOtpHash" text,
	"emailVerifyOtpExpiry" timestamp,
	"emailVerifyOtpSentAt" timestamp,
	"emailVerifyOtpFailedAttempts" integer DEFAULT 0 NOT NULL,
	"pvpWsTokenVersion" integer DEFAULT 0 NOT NULL,
	"pvpWsTokensValidAfter" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "User_username_unique" UNIQUE("username"),
	CONSTRAINT "User_email_unique" UNIQUE("email"),
	CONSTRAINT "User_pendingEmail_unique" UNIQUE("pendingEmail"),
	CONSTRAINT "User_emailVerifyToken_unique" UNIQUE("emailVerifyToken")
);
--> statement-breakpoint
ALTER TABLE "user" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "user" CASCADE;--> statement-breakpoint
ALTER TABLE "Account" DROP CONSTRAINT "Account_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "AdminActionLog" DROP CONSTRAINT "AdminActionLog_actorUserId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "AdminActionLog" DROP CONSTRAINT "AdminActionLog_targetUserId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "Authenticator" DROP CONSTRAINT "Authenticator_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "cheat_flag" DROP CONSTRAINT "cheat_flag_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "daily_typing_activity" DROP CONSTRAINT "daily_typing_activity_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "player_profile" DROP CONSTRAINT "player_profile_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "pvp_matchmaking_preferences" DROP CONSTRAINT "pvp_matchmaking_preferences_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "pvp_participant" DROP CONSTRAINT "pvp_participant_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "pvp_rating_change" DROP CONSTRAINT "pvp_rating_change_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "pvp_rating" DROP CONSTRAINT "pvp_rating_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "pvp_room_member" DROP CONSTRAINT "pvp_room_member_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "pvp_room" DROP CONSTRAINT "pvp_room_createdByUserId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "pvp_room" DROP CONSTRAINT "pvp_room_hostUserId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "SessionStat" DROP CONSTRAINT "SessionStat_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "Session" DROP CONSTRAINT "Session_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "UserFeedback" DROP CONSTRAINT "UserFeedback_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "UserFeedback" DROP CONSTRAINT "UserFeedback_respondedByUserId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "player_profile" ADD COLUMN "appSettings" jsonb;--> statement-breakpoint
ALTER TABLE "pvp_rating" ADD COLUMN "currentStreak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pvp_rating" ADD COLUMN "longestStreak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pvp_rating" ADD COLUMN "lastStreakMatchId" uuid;--> statement-breakpoint
CREATE INDEX "idx_pvp_failed_stats_drain" ON "pvp_failed_stats" USING btree ("nextRetryAt","retryCount");--> statement-breakpoint
CREATE INDEX "idx_pvp_failed_stats_match_user" ON "pvp_failed_stats" USING btree ("matchId","userId");--> statement-breakpoint
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AdminActionLog" ADD CONSTRAINT "AdminActionLog_actorUserId_User_id_fk" FOREIGN KEY ("actorUserId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AdminActionLog" ADD CONSTRAINT "AdminActionLog_targetUserId_User_id_fk" FOREIGN KEY ("targetUserId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Authenticator" ADD CONSTRAINT "Authenticator_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheat_flag" ADD CONSTRAINT "cheat_flag_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_typing_activity" ADD CONSTRAINT "daily_typing_activity_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_profile" ADD CONSTRAINT "player_profile_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvp_matchmaking_preferences" ADD CONSTRAINT "pvp_matchmaking_preferences_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvp_participant" ADD CONSTRAINT "pvp_participant_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvp_rating_change" ADD CONSTRAINT "pvp_rating_change_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvp_rating" ADD CONSTRAINT "pvp_rating_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvp_room_member" ADD CONSTRAINT "pvp_room_member_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvp_room" ADD CONSTRAINT "pvp_room_createdByUserId_User_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvp_room" ADD CONSTRAINT "pvp_room_hostUserId_User_id_fk" FOREIGN KEY ("hostUserId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SessionStat" ADD CONSTRAINT "SessionStat_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UserFeedback" ADD CONSTRAINT "UserFeedback_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UserFeedback" ADD CONSTRAINT "UserFeedback_respondedByUserId_User_id_fk" FOREIGN KEY ("respondedByUserId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;