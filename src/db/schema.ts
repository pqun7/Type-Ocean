import { relations, sql } from "drizzle-orm";
import {
	boolean,
	doublePrecision,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uuid,
	jsonb,
} from "drizzle-orm/pg-core";

export const users = pgTable("User", {
	id: uuid("id").defaultRandom().primaryKey(),
	username: text("username").notNull().unique(),
	usernameLastChangedAt: timestamp("usernameLastChangedAt", { withTimezone: false, mode: "date" }),
	passwordHash: text("passwordHash"),
	email: text("email").notNull().unique(),
	pendingEmail: text("pendingEmail").unique(),
	pendingEmailRequestedAt: timestamp("pendingEmailRequestedAt", { withTimezone: false, mode: "date" }),
	emailVerified: timestamp("emailVerified", { withTimezone: false, mode: "date" }),
	verificationReminderShownAt: timestamp("verificationReminderShownAt", { withTimezone: false, mode: "date" }),
	image: text("image"),
	role: text("role").notNull().default("user"),
	banned: boolean("banned").notNull().default(false),
	isPrimaryAdmin: boolean("isPrimaryAdmin").notNull().default(false),
	resetToken: text("resetToken"),
	resetTokenExpiry: timestamp("resetTokenExpiry", { withTimezone: false, mode: "date" }),
	passwordResetRequests: integer("passwordResetRequests").notNull().default(0),
	emailVerifyToken: text("emailVerifyToken").unique(),
	emailVerifyTokenExpiry: timestamp("emailVerifyTokenExpiry", { withTimezone: false, mode: "date" }),
	emailVerificationAttempts: integer("emailVerificationAttempts").default(0),
	emailVerifyOtpHash: text("emailVerifyOtpHash"),
	emailVerifyOtpExpiry: timestamp("emailVerifyOtpExpiry", { withTimezone: false, mode: "date" }),
	emailVerifyOtpSentAt: timestamp("emailVerifyOtpSentAt", { withTimezone: false, mode: "date" }),
	emailVerifyOtpFailedAttempts: integer("emailVerifyOtpFailedAttempts").notNull().default(0),
	pvpWsTokenVersion: integer("pvpWsTokenVersion").notNull().default(0),
	pvpWsTokensValidAfter: timestamp("pvpWsTokensValidAfter", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
	createdAt: timestamp("createdAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
	updatedAt: timestamp("updatedAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
});

export const playerProfiles = pgTable("player_profile", {
	id: uuid("id").defaultRandom().primaryKey(),
	userId: uuid("userId").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
	username: text("username").notNull(),
	level: integer("level").notNull().default(1),
	xp: integer("xp").notNull().default(0),
	rating: integer("rating").notNull().default(1000),
	ratingDeviation: integer("ratingDeviation").notNull().default(350),
	ratingUpdatedAt: timestamp("ratingUpdatedAt", { withTimezone: false, mode: "date" }),
	achievements: jsonb("achievements").notNull().default(sql`'[]'::jsonb`),
	longTermStats: jsonb("longTermStats"),
	avatar: text("avatar"),
	hideFromLeaderboard: boolean("hideFromLeaderboard").notNull().default(false),
	createdAt: timestamp("createdAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
	updatedAt: timestamp("updatedAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
});

export const sessionStats = pgTable("SessionStat", {
	id: uuid("id").defaultRandom().primaryKey(),
	userId: uuid("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
	n: integer("n").notNull(),
	avgWpm: integer("avgWpm").notNull(),
	avgAcc: doublePrecision("avgAcc").notNull(),
	date: timestamp("date", { withTimezone: false, mode: "date" }).notNull(),
	createdAt: timestamp("createdAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
	updatedAt: timestamp("updatedAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
});

export const dailyTypingActivity = pgTable("daily_typing_activity", {
	id: uuid("id").defaultRandom().primaryKey(),
	userId: uuid("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
	localDate: text("localDate").notNull(),
	sessionsCount: integer("sessionsCount").notNull().default(0),
	totalTimeSpentSec: integer("totalTimeSpentSec").notNull().default(0),
	sumWpm: doublePrecision("sumWpm").notNull().default(0),
	sumWpmTime: doublePrecision("sumWpmTime").notNull().default(0),
	sumAccuracy: doublePrecision("sumAccuracy").notNull().default(0),
	createdAt: timestamp("createdAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
	updatedAt: timestamp("updatedAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
});

export const leaderboardSnapshots = pgTable("leaderboard_snapshot", {
	id: uuid("id").defaultRandom().primaryKey(),
	snapshotKey: text("snapshotKey").notNull().default("global"),
	userId: uuid("userId").notNull(),
	position: integer("position").notNull(),
	username: text("username").notNull(),
	avatar: text("avatar"),
	rating: integer("rating").notNull(),
	updatedAt: timestamp("updatedAt", { withTimezone: false, mode: "date" }).notNull(),
	refreshedAt: timestamp("refreshedAt", { withTimezone: false, mode: "date" }).notNull(),
	createdAt: timestamp("createdAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
});

export const leaderboardSnapshotMeta = pgTable("leaderboard_snapshot_meta", {
	snapshotKey: text("snapshotKey").primaryKey(),
	refreshedAt: timestamp("refreshedAt", { withTimezone: false, mode: "date" }),
	rowCount: integer("rowCount").notNull().default(0),
	stale: boolean("stale").notNull().default(true),
	createdAt: timestamp("createdAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
	updatedAt: timestamp("updatedAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
});

export const userFeedback = pgTable("UserFeedback", {
	id: uuid("id").defaultRandom().primaryKey(),
	userId: uuid("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
	category: text("category").notNull(),
	status: text("status").notNull().default("OPEN"),
	subject: text("subject").notNull(),
	body: text("body").notNull(),
	rating: integer("rating"),
	imageUrl: text("imageUrl"),
	adminReplyTitle: text("adminReplyTitle"),
	adminReplyBody: text("adminReplyBody"),
	respondedByUserId: uuid("respondedByUserId").references(() => users.id, { onDelete: "set null" }),
	respondedAt: timestamp("respondedAt", { withTimezone: false, mode: "date" }),
	createdAt: timestamp("createdAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
	updatedAt: timestamp("updatedAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
});

export const adminActionLogs = pgTable("AdminActionLog", {
	id: uuid("id").defaultRandom().primaryKey(),
	actorUserId: uuid("actorUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
	targetUserId: uuid("targetUserId").references(() => users.id, { onDelete: "set null" }),
	action: text("action").notNull(),
	entityType: text("entityType").notNull(),
	entityId: text("entityId"),
	summary: text("summary").notNull(),
	metadata: jsonb("metadata"),
	createdAt: timestamp("createdAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
});

export const pvpRooms = pgTable("pvp_room", {
	id: uuid("id").defaultRandom().primaryKey(),
	code: text("code").notNull().unique(),
	status: text("status").notNull().default("OPEN"),
	visibility: text("visibility").notNull().default("PRIVATE"),
	createdByUserId: uuid("createdByUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
	hostUserId: uuid("hostUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
	minPlayers: integer("minPlayers").notNull().default(2),
	maxPlayers: integer("maxPlayers").notNull().default(6),
	textSnapshot: text("textSnapshot"),
	autoStartAt: timestamp("autoStartAt", { withTimezone: false, mode: "date" }),
	expiresAt: timestamp("expiresAt", { withTimezone: false, mode: "date" }),
	createdAt: timestamp("createdAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
	updatedAt: timestamp("updatedAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
});

export const pvpMatchmakingPreferences = pgTable("pvp_matchmaking_preferences", {
	id: uuid("id").defaultRandom().primaryKey(),
	userId: uuid("userId").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
	preferredMode: text("preferredMode").notNull().default("ranked_1v1"),
	textDifficulty: text("textDifficulty").notNull().default("normal"),
	createdAt: timestamp("createdAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
	updatedAt: timestamp("updatedAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
});

export const pvpRoomMembers = pgTable(
	"pvp_room_member",
	{
		roomId: uuid("roomId").notNull().references(() => pvpRooms.id, { onDelete: "cascade" }),
		userId: uuid("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
		colorSlot: integer("colorSlot").notNull(),
		readyAt: timestamp("readyAt", { withTimezone: false, mode: "date" }),
		joinedAt: timestamp("joinedAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
		leftAt: timestamp("leftAt", { withTimezone: false, mode: "date" }),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.roomId, table.userId] }),
	}),
);

export const pvpMatches = pgTable(
	"pvp_match",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		status: text("status").notNull().default("PENDING"),
		roomId: uuid("roomId").references(() => pvpRooms.id, { onDelete: "set null" }),
		liveState: jsonb("liveState"),
		revision: integer("revision").notNull().default(0),
		instanceId: text("instanceId"),
		textSnapshot: text("textSnapshot").notNull(),
		textId: text("textId"),
		inputNonce: text("inputNonce"),
		serverStartAt: timestamp("serverStartAt", { withTimezone: false, mode: "date" }),
		startedAt: timestamp("startedAt", { withTimezone: false, mode: "date" }),
		endedAt: timestamp("endedAt", { withTimezone: false, mode: "date" }),
		createdAt: timestamp("createdAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
		updatedAt: timestamp("updatedAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
	},
	(table) => ({
		roomIdIdx: index("idx_pvp_matches_roomId").on(table.roomId),
		statusIdx: index("idx_pvp_matches_status").on(table.status),
	}),
);

export const pvpParticipants = pgTable(
	"pvp_participant",
	{
		matchId: uuid("matchId").notNull().references(() => pvpMatches.id, { onDelete: "cascade" }),
		userId: uuid("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
		slot: integer("slot").notNull(),
		finalWpm: integer("finalWpm"),
		finalAccuracy: doublePrecision("finalAccuracy"),
		finalErrors: integer("finalErrors"),
		timeSpentSec: integer("timeSpentSec"),
		completedAt: timestamp("completedAt", { withTimezone: false, mode: "date" }),
		disconnectCount: integer("disconnectCount").notNull().default(0),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.matchId, table.userId] }),
		matchUserIdx: index("idx_pvp_participants_matchId_userId").on(table.matchId, table.userId),
	}),
);

export const pvpEvents = pgTable("pvp_event", {
	id: uuid("id").defaultRandom().primaryKey(),
	matchId: uuid("matchId").notNull().references(() => pvpMatches.id, { onDelete: "cascade" }),
	seq: integer("seq").notNull(),
	type: text("type").notNull(),
	payload: jsonb("payload").notNull(),
	createdAt: timestamp("createdAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
});

export const pvpRatings = pgTable("pvp_rating", {
	id: uuid("id").defaultRandom().primaryKey(),
	userId: uuid("userId").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
	rating: integer("rating").notNull().default(1500),
	deviation: integer("deviation").notNull().default(350),
	gamesPlayed: integer("gamesPlayed").notNull().default(0),
	createdAt: timestamp("createdAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
	updatedAt: timestamp("updatedAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
});

export const pvpRatingChanges = pgTable("pvp_rating_change", {
	id: uuid("id").defaultRandom().primaryKey(),
	matchId: uuid("matchId").notNull().references(() => pvpMatches.id, { onDelete: "cascade" }),
	userId: uuid("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
	beforeRating: integer("beforeRating").notNull(),
	afterRating: integer("afterRating").notNull(),
	delta: integer("delta").notNull(),
	createdAt: timestamp("createdAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
});

export const cheatFlags = pgTable("cheat_flag", {
	id: uuid("id").defaultRandom().primaryKey(),
	userId: uuid("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
	matchId: uuid("matchId").notNull().references(() => pvpMatches.id, { onDelete: "cascade" }),
	confidence: doublePrecision("confidence").notNull(),
	flags: text("flags").array().notNull(),
	reviewed: boolean("reviewed").notNull().default(false),
	wouldSanction: boolean("wouldSanction").notNull().default(false),
	metadata: jsonb("metadata"),
	createdAt: timestamp("createdAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
	updatedAt: timestamp("updatedAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
});

export const pendingSignups = pgTable("pending_signup", {
	id: uuid("id").defaultRandom().primaryKey(),
	email: text("email").notNull().unique(),
	username: text("username").notNull().unique(),
	passwordHash: text("passwordHash").notNull(),
	emailVerifyToken: text("emailVerifyToken").notNull().unique(),
	emailVerifyTokenExpiry: timestamp("emailVerifyTokenExpiry", { withTimezone: false, mode: "date" }).notNull(),
	emailVerificationAttempts: integer("emailVerificationAttempts").notNull().default(1),
	createdAt: timestamp("createdAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
	updatedAt: timestamp("updatedAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
});

export const accounts = pgTable(
	"Account",
	{
		userId: uuid("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
		type: text("type").notNull(),
		provider: text("provider").notNull(),
		providerAccountId: text("providerAccountId").notNull(),
		refreshToken: text("refresh_token"),
		accessToken: text("access_token"),
		expiresAt: integer("expires_at"),
		tokenType: text("token_type"),
		scope: text("scope"),
		idToken: text("id_token"),
		sessionState: text("session_state"),
		createdAt: timestamp("createdAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
		updatedAt: timestamp("updatedAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.provider, table.providerAccountId] }),
	}),
);

export const sessions = pgTable("Session", {
	sessionToken: text("sessionToken").primaryKey(),
	userId: uuid("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
	expires: timestamp("expires", { withTimezone: false, mode: "date" }).notNull(),
	createdAt: timestamp("createdAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
	updatedAt: timestamp("updatedAt", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
});

export const verificationTokens = pgTable(
	"VerificationToken",
	{
		identifier: text("identifier").notNull(),
		token: text("token").notNull(),
		expires: timestamp("expires", { withTimezone: false, mode: "date" }).notNull(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.identifier, table.token] }),
	}),
);

export const authenticators = pgTable(
	"Authenticator",
	{
		credentialID: text("credentialID").notNull().unique(),
		userId: uuid("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
		providerAccountId: text("providerAccountId").notNull(),
		credentialPublicKey: text("credentialPublicKey").notNull(),
		counter: integer("counter").notNull(),
		credentialDeviceType: text("credentialDeviceType").notNull(),
		credentialBackedUp: boolean("credentialBackedUp").notNull(),
		transports: text("transports"),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.userId, table.credentialID] }),
	}),
);

export const rateLimits = pgTable("RateLimit", {
	ip: text("ip").primaryKey(),
	count: integer("count").notNull(),
	lastUpdated: timestamp("lastUpdated", { withTimezone: false, mode: "date" }).notNull().defaultNow(),
});

export const usersRelations = relations(users, ({ one, many }) => ({
	profile: one(playerProfiles, {
		fields: [users.id],
		references: [playerProfiles.userId],
	}),
	accounts: many(accounts),
	sessions: many(sessions),
	sessionStats: many(sessionStats),
	dailyTypingActivity: many(dailyTypingActivity),
	pvpRoomMemberships: many(pvpRoomMembers),
	createdPvpRooms: many(pvpRooms, { relationName: "pvpRoomCreator" }),
	hostedPvpRooms: many(pvpRooms, { relationName: "pvpRoomHost" }),
	pvpParticipants: many(pvpParticipants),
	pvpRating: one(pvpRatings, {
		fields: [users.id],
		references: [pvpRatings.userId],
	}),
	pvpMatchmakingPreference: one(pvpMatchmakingPreferences, {
		fields: [users.id],
		references: [pvpMatchmakingPreferences.userId],
	}),
	pvpRatingChanges: many(pvpRatingChanges),
	cheatFlags: many(cheatFlags),
}));

export const playerProfilesRelations = relations(playerProfiles, ({ one }) => ({
	user: one(users, {
		fields: [playerProfiles.userId],
		references: [users.id],
	}),
}));

export const pvpRoomsRelations = relations(pvpRooms, ({ one, many }) => ({
	createdBy: one(users, {
		fields: [pvpRooms.createdByUserId],
		references: [users.id],
		relationName: "pvpRoomCreator",
	}),
	hostUser: one(users, {
		fields: [pvpRooms.hostUserId],
		references: [users.id],
		relationName: "pvpRoomHost",
	}),
	members: many(pvpRoomMembers),
	matches: many(pvpMatches),
}));

export const pvpRoomMembersRelations = relations(pvpRoomMembers, ({ one }) => ({
	room: one(pvpRooms, {
		fields: [pvpRoomMembers.roomId],
		references: [pvpRooms.id],
	}),
	user: one(users, {
		fields: [pvpRoomMembers.userId],
		references: [users.id],
	}),
}));

export const pvpMatchesRelations = relations(pvpMatches, ({ one, many }) => ({
	room: one(pvpRooms, {
		fields: [pvpMatches.roomId],
		references: [pvpRooms.id],
	}),
	participants: many(pvpParticipants),
	events: many(pvpEvents),
	ratingChanges: many(pvpRatingChanges),
	cheatFlags: many(cheatFlags),
}));

export const pvpParticipantsRelations = relations(pvpParticipants, ({ one }) => ({
	match: one(pvpMatches, {
		fields: [pvpParticipants.matchId],
		references: [pvpMatches.id],
	}),
	user: one(users, {
		fields: [pvpParticipants.userId],
		references: [users.id],
	}),
}));

export const pvpEventsRelations = relations(pvpEvents, ({ one }) => ({
	match: one(pvpMatches, {
		fields: [pvpEvents.matchId],
		references: [pvpMatches.id],
	}),
}));

export const pvpRatingsRelations = relations(pvpRatings, ({ one }) => ({
	user: one(users, {
		fields: [pvpRatings.userId],
		references: [users.id],
	}),
}));

export const pvpMatchmakingPreferencesRelations = relations(pvpMatchmakingPreferences, ({ one }) => ({
	user: one(users, {
		fields: [pvpMatchmakingPreferences.userId],
		references: [users.id],
	}),
}));

export const pvpRatingChangesRelations = relations(pvpRatingChanges, ({ one }) => ({
	match: one(pvpMatches, {
		fields: [pvpRatingChanges.matchId],
		references: [pvpMatches.id],
	}),
	user: one(users, {
		fields: [pvpRatingChanges.userId],
		references: [users.id],
	}),
}));

export const cheatFlagsRelations = relations(cheatFlags, ({ one }) => ({
	user: one(users, {
		fields: [cheatFlags.userId],
		references: [users.id],
	}),
	match: one(pvpMatches, {
		fields: [cheatFlags.matchId],
		references: [pvpMatches.id],
	}),
}));
