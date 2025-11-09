import { redisManager } from '../src/lib/redis';

async function testRedis() {
  try {
    await redisManager.connectIfNeeded();
    
    // Test set/get via redisManager
    await redisManager.set('test', 'Hello Redis');
    const value = await redisManager.get('test');
    
    console.log('✅ Redis test successful:', value);
    await redisManager.disconnect();
  } catch (error) {
    console.error('❌ Redis test failed:', error.message);
  }
}

testRedis();