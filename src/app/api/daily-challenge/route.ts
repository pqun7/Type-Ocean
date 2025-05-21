import { NextRequest, NextResponse } from 'next/server';
import { generateDailyChallenge } from '@/features/level/utils/challengeHelpers';
import redis from '@/lib/redis';
import { getLocalMidnightTTL, getTodayDate } from '@/utils/timeUtils'; // تحديث دالة التاريخ
import { DailyChallenge } from '@/features/level/types/level';
import { v4 as uuidv4 } from 'uuid';
import { getUserLevel } from '@/features/level/server-utils/userCache'; // استيراد دالة المستوى
import { logging } from '@/log/ServerLogger'; 

const logRequest = (requestId: string, message: string, metadata?: object) => {
  logging.info(message, {
    type: 'DAILY-CHALLENGE',
    requestId,
    ...metadata
  });
};

const logError = (requestId: string, error: unknown, metadata?: object) => {
  const errorObj = error instanceof Error ? error : new Error(String(error));
  logging.error(errorObj.message, errorObj, {
    type: 'DAILY-CHALLENGE',
    requestId,
    ...metadata
  });
};


// ███ GET - جلب التحدي اليومي ███
export async function GET(req: NextRequest) {
  const requestId = uuidv4();
  const userId = req.headers.get('x-user-id');
  
  logRequest(requestId, 'GET request started', { userId });

  if (!userId) {
    logError(requestId, new Error('Unauthorized access attempt'), { status: 401 });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = getTodayDate();
  const cacheKey = `dailyChallenge:${userId}:${today}`; // إضافة التاريخ للمفتاح

  try {
    // 1. محاولة جلب التحدي من الكاش
    logRequest(requestId, 'Checking Redis cache', { cacheKey });
    const cached = await redis.get(cacheKey);

    if (cached) {
      const parsed = JSON.parse(cached) as DailyChallenge;
      logRequest(requestId, 'Cache hit', { challengeId: parsed.id });
      return NextResponse.json(parsed);
    }

    // 2. إذا لم يوجد في الكاش، إنشاء تحد جديد
    logRequest(requestId, 'Generating new daily challenge');
    
    // جلب مستوى المستخدم من قاعدة البيانات
    const userLevel = await getUserLevel(userId);
    logRequest(requestId, 'Fetched user level', { userLevel });

    // إنشاء التحدي مع مستوى المستخدم
    const newChallenge = await generateDailyChallenge(userId, userLevel);
    logRequest(requestId, 'Challenge generated', { challengeId: newChallenge.id });

    // 3. تخزين في الكاش حتى منتصف الليل
    const ttl = getLocalMidnightTTL();
    await redis.setEx(cacheKey, ttl, JSON.stringify(newChallenge));
    logRequest(requestId, 'Cache updated', { ttl });

    return NextResponse.json(newChallenge);
  } catch (error) {
    logError(requestId, error, { operation: 'GET', cacheKey, userId });
    return NextResponse.json({ 
      error: 'Failed to fetch challenge',
      referenceId: requestId
    }, { status: 500 });
  }
}

// █████████████████████████████████████████████████████████████████████████████████████
// ███ POST - تحديث تقدم التحدي ███
export async function POST(req: NextRequest) {
  const requestId = uuidv4();
  const userId = req.headers.get('x-user-id');
  
  logRequest(requestId, 'POST request started', { userId });

  if (!userId) {
    logError(requestId, new Error('Unauthorized access attempt'), { status: 401 });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = getTodayDate();
  const cacheKey = `dailyChallenge:${userId}:${today}`;

  try {
    // 1. التحقق من وجود التحدي
    const existing = await redis.get(cacheKey);
    if (!existing) {
      logError(requestId, new Error('Challenge not found'), { status: 404 });
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 });
    }

    // 2. التحقق من تاريخ التحدي
    const challenge = JSON.parse(existing) as DailyChallenge;
    if (challenge.date !== today) {
      logError(requestId, new Error('Expired challenge'), {
        challengeDate: challenge.date,
        currentDate: today
      });
      return NextResponse.json({ error: 'Challenge expired' }, { status: 400 });
    }

    // 3. معالجة التقدم
    const { progress } = await req.json();
    if (!progress || typeof progress !== 'object') {
      logError(requestId, new Error('Invalid progress data'), { status: 400 });
      return NextResponse.json({ error: 'Invalid progress data' }, { status: 400 });
    }

    // 4. تحديث حالة التحدي
    const updatedChallenge = {
      ...challenge,
      progress,
      status: calculateChallengeStatus(challenge, progress) // دالة جديدة
    };

    // 5. تحديث الكاش
    await redis.setEx(cacheKey, getLocalMidnightTTL(), JSON.stringify(updatedChallenge));
    logRequest(requestId, 'Progress updated', { 
      challengeId: updatedChallenge.id,
      newStatus: updatedChallenge.status
    });

    return NextResponse.json(updatedChallenge);
  } catch (error) {
    logError(requestId, error, { operation: 'POST', cacheKey, userId });
    return NextResponse.json({ 
      error: 'Failed to update challenge',
      referenceId: requestId
    }, { status: 500 });
  }
}

// █████████████████████████████████████████████████████████████████████████████████████
// ███ DELETE - حذف التحدي (لأغراض التطوير) ███
export async function DELETE(req: NextRequest) {
  const requestId = uuidv4();
  const userId = req.headers.get('x-user-id');
  
  logRequest(requestId, 'DELETE request started', { userId });

  if (!userId) {
    logError(requestId, new Error('Unauthorized access attempt'), { status: 401 });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = getTodayDate();
  const cacheKey = `dailyChallenge:${userId}:${today}`;

  try {
    const deletedCount = await redis.del(cacheKey);
    if (deletedCount === 0) {
      logRequest(requestId, 'No challenge to delete', { cacheKey });
      return NextResponse.json({ message: 'No challenge found' });
    }

    logRequest(requestId, 'Challenge deleted', { cacheKey });
    return NextResponse.json({ message: 'Challenge deleted successfully' });
  } catch (error) {
    logError(requestId, error, { operation: 'DELETE', cacheKey, userId });
    return NextResponse.json({ 
      error: 'Failed to delete challenge',
      referenceId: requestId
    }, { status: 500 });
  }
}

// █████████████████████████████████████████████████████████████████████████████████████
// ███ دوال مساعدة ███
const calculateChallengeStatus = (
  challenge: DailyChallenge,
  progress: any
): 0 | 1 | 2 => {
  // 0: لم يبدأ، 1: قيد التقدم، 2: مكتمل
  if (isChallengeCompleted(challenge, progress)) return 2;
  return Object.keys(progress).length > 0 ? 1 : 0;
};

const isChallengeCompleted = (challenge: DailyChallenge, progress: any): boolean => {
  switch (challenge.type) {
    case 'speedCombo':
      return typeof progress === 'object' &&
             typeof challenge.target === 'object' &&
             progress.wpm >= challenge.target.wpm &&
             progress.accuracy >= challenge.target.accuracy;

    case 'marathon':
      return typeof progress === 'object' &&
             typeof challenge.target === 'number' &&
             progress.charactersTyped >= challenge.target;

    case 'timeAttack':
      return typeof progress === 'object' &&
             typeof challenge.target === 'number' &&
             progress.timeSpent >= challenge.target;

    default:
      return false;
  }
};
