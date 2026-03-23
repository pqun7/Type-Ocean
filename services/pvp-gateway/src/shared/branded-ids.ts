/**
 * @module shared/branded-ids
 *
 * Nominal ("branded") primitive wrappers for PvP gateway domain identifiers.
 *
 * ## Why branded types?
 * Plain `string` parameters are structurally identical in TypeScript, so the
 * compiler cannot prevent accidentally passing a `matchId` where a `userId` is
 * expected.  Branding adds a zero-runtime type tag that catches these bugs at
 * compile time:
 *
 * ```ts
 * function broadcastMatch(matchId: MatchId) { … }
 * broadcastMatch(userId);   // TS error — good!
 * broadcastMatch(matchId);  // ok
 * ```
 *
 * ## Canonical import path
 * All gateway code should import from this module, not from `index.ts`.
 * `index.ts` re-exports every identifier here for legacy compatibility.
 */

// =============================================================================
// BRAND DECLARATIONS
// =============================================================================

/** @internal — do not use this symbol directly. */
declare const __UserIdBrand: unique symbol;
/** @internal — do not use this symbol directly. */
declare const __MatchIdBrand: unique symbol;
/** @internal — do not use this symbol directly. */
declare const __RoomCodeBrand: unique symbol;

// =============================================================================
// BRANDED TYPES
// =============================================================================

/**
 * A PvP participant's user identifier.
 *
 * Obtained from the verified JWT `sub` claim.  Must be treated as an opaque
 * string; never embed assumptions about its format.
 */
export type UserId = string & { readonly [__UserIdBrand]: true };

/**
 * A globally unique match identifier (UUID string).
 *
 * Derived from `pvp_match.id` in the database.  Always a lower-case UUID v4.
 */
export type MatchId = string & { readonly [__MatchIdBrand]: true };

/**
 * A human-readable custom-room join code.
 *
 * 6–12 alphanumeric characters, upper-cased.  Derived from `pvp_room.code`.
 */
export type RoomCode = string & { readonly [__RoomCodeBrand]: true };

// =============================================================================
// CONVERSION HELPERS
// =============================================================================

/**
 * Casts a raw string to the {@link UserId} branded type.
 *
 * ⚠️  Only call this after the value has been authenticated (e.g. extracted
 * from a verified JWT or a trusted database record).  This is a compile-time
 * narrowing cast — it performs **no** runtime validation.
 */
export function toUserId(value: string): UserId {
  return value as UserId;
}

/**
 * Casts a raw string to the {@link MatchId} branded type.
 *
 * ⚠️  Only call this with values taken directly from `pvp_match.id` or an
 * already-branded `MatchId`.  No runtime validation is performed.
 */
export function toMatchId(value: string): MatchId {
  return value as MatchId;
}

/**
 * Casts a raw string to the {@link RoomCode} branded type.
 *
 * ⚠️  Only call this after the value has been sanitised (see
 * `sanitizeRoomCode` in `src/lib/sanitize.ts`).
 */
export function toRoomCode(value: string): RoomCode {
  return value as RoomCode;
}
