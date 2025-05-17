// pages/api/ping-redis.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import  redis  from '@/lib/redis';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const pong = await redis.ping();
    return res.status(200).json({ status: pong });
  } catch {
    return res.status(500).json({ status: 'error' });
  }
}
