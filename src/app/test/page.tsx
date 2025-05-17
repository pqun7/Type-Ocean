'use server';

import { connectIfNeeded } from '@/lib/redis';

export default async function Page() {
  let status = 'Not tested';
  try {
    await connectIfNeeded();
    status = '✅ redis connected!';
  } catch (err) {
    status = '❌ redis failed to connect: ' + (err instanceof Error ? err.message : String(err));
  }
  return (
    <div>
      <h1>Redis Test</h1>
      <p>{status}</p>
    </div>
  );
}
