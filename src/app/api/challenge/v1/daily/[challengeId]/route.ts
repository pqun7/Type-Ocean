// api/challenge/v1/daily/[challengeId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { calculateChallengeStatus } from "@/features/level/utils/challengeHelpers";
import { DailyChallenge } from "@/features/level/types/level";
import { v4 as uuidv4 } from "uuid";
import {
  redis,
  connectIfNeeded,
  getCacheKey,
  getCacheTTL,
  authorizeRequest,
  logRequestStart,
  logRequestSuccess,
  logRequestError,
} from "@/app/api/challenge/v1/shared";
import { getTodayDate } from "@/app/api/challenge/v1/shared";

const SERVICE_TYPE = "DAILY-CHALLENGE-UPDATE";
const CACHE_TTL = getCacheTTL();
const FILE_PATH = "src/app/api/challenge/v1/daily/[challengeId]/route.ts";

interface RouteParams {
  params: {
    challengeId: string;
  };
}

// PUT - Update specific challenge by ID
export async function PUT(req: NextRequest, { params }: RouteParams) {
  const requestId = uuidv4();
  const userId = authorizeRequest(req);
  const { challengeId } = params;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!challengeId) {
    return NextResponse.json({ error: "Challenge ID is required" }, { status: 400 });
  }

  try {
    logRequestStart(requestId, SERVICE_TYPE, "PUT", FILE_PATH, userId);
    await connectIfNeeded();

    const today = getTodayDate();
    const cacheKey = getCacheKey(userId);

    // Get current challenge and request body in parallel
    const [existing, body] = await Promise.all([
      redis.get(cacheKey),
      req.json().catch(() => null),
    ]);

    if (!body || !body.session) {
      return NextResponse.json(
        { error: "Invalid request body. Expected 'session' data." },
        { status: 400 }
      );
    }

    const { session } = body;

    // Validate session data
    if (!session || typeof session.wpm !== 'number' || typeof session.accuracy !== 'number') {
      return NextResponse.json(
        { error: "Invalid session data. WPM and accuracy are required." },
        { status: 400 }
      );
    }

    if (!existing) {
      return NextResponse.json(
        { error: "Challenge not found" },
        { status: 404 }
      );
    }

    const challenge = JSON.parse(existing) as DailyChallenge;

    // Verify challenge ID matches
    if (challenge.id !== challengeId) {
      return NextResponse.json(
        { error: "Challenge ID mismatch" },
        { status: 400 }
      );
    }

    // Check if challenge is expired
    if (challenge.date !== today) {
      return NextResponse.json(
        { error: "Challenge has expired" },
        { status: 410 }
      );
    }

    // Update challenge based on type
    let updatedChallenge: DailyChallenge;
    
    switch (challenge.type) {
      case "marathon":
        updatedChallenge = {
          ...challenge,
          data: {
            ...challenge.data,
            charactersTyped: (challenge.data?.charactersTyped || 0) + session.textLength,
          },
          status: calculateChallengeStatus(challenge, {
            charactersTyped: (challenge.data?.charactersTyped || 0) + session.textLength,
          }),
        };
        break;
        
      case "timeAttack":
        updatedChallenge = {
          ...challenge,
          data: {
            ...challenge.data,
            timeSpent: (challenge.data?.timeSpent || 0) + session.timeSpent,
          },
          status: calculateChallengeStatus(challenge, {
            timeSpent: (challenge.data?.timeSpent || 0) + session.timeSpent,
          }),
        };
        break;
        
      case "speedCombo":
        // For speed combo, check if current session meets the requirements
        const target = challenge.target as { wpm: number; accuracy: number };
        if (session.wpm >= target.wpm && session.accuracy >= target.accuracy) {
          updatedChallenge = {
            ...challenge,
            status: 1, // Completed
            data: {
              ...challenge.data,
              completedAt: new Date().toISOString(),
              finalWpm: session.wpm,
              finalAccuracy: session.accuracy,
            },
          };
        } else {
          updatedChallenge = {
            ...challenge,
            data: {
              ...challenge.data,
              bestWpm: Math.max(challenge.data?.bestWpm || 0, session.wpm),
              bestAccuracy: Math.max(challenge.data?.bestAccuracy || 0, session.accuracy),
              attempts: (challenge.data?.attempts || 0) + 1,
            },
            status: -1, // In progress
          };
        }
        break;
        
      default:
        return NextResponse.json(
          { error: "Unknown challenge type" },
          { status: 400 }
        );
    }

    // Save updated challenge to cache
    await redis.setEx(cacheKey, CACHE_TTL, JSON.stringify(updatedChallenge));

    logRequestSuccess(requestId, SERVICE_TYPE, "PUT", FILE_PATH, {
      userId,
      challengeId,
      challengeType: challenge.type,
      newStatus: updatedChallenge.status,
      completed: updatedChallenge.status === 1,
    });

    return NextResponse.json(updatedChallenge);
  } catch (error) {
    logRequestError(requestId, SERVICE_TYPE, error, FILE_PATH, {
      userId,
      challengeId,
      operationPhase: "challenge_update",
    });

    return NextResponse.json(
      { error: "Failed to update challenge", referenceId: requestId },
      { status: 500 }
    );
  }
}

// GET - Fetch specific challenge by ID (optional, for completeness)
export async function GET(req: NextRequest, { params }: RouteParams) {
  const requestId = uuidv4();
  const userId = authorizeRequest(req);
  const { challengeId } = params;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    logRequestStart(requestId, SERVICE_TYPE, "GET", FILE_PATH, userId);
    await connectIfNeeded();

    const cacheKey = getCacheKey(userId);
    const existing = await redis.get(cacheKey);

    if (!existing) {
      return NextResponse.json(
        { error: "Challenge not found" },
        { status: 404 }
      );
    }

    const challenge = JSON.parse(existing) as DailyChallenge;

    if (challenge.id !== challengeId) {
      return NextResponse.json(
        { error: "Challenge ID mismatch" },
        { status: 404 }
      );
    }

    logRequestSuccess(requestId, SERVICE_TYPE, "GET", FILE_PATH, {
      userId,
      challengeId,
    });

    return NextResponse.json(challenge);
  } catch (error) {
    logRequestError(requestId, SERVICE_TYPE, error, FILE_PATH, {
      userId,
      challengeId,
      operationPhase: "challenge_fetch",
    });

    return NextResponse.json(
      { error: "Failed to fetch challenge", referenceId: requestId },
      { status: 500 }
    );
  }
}