import { createClient } from 'redis';

async function diagnoseRedis() {
  console.log('🔍 Redis Diagnostic Tool');
  console.log('=======================\n');

  const configs = [
    { name: 'Local Redis', host: '127.0.0.1', port: 6379 },
    { name: 'WSL Localhost', host: 'localhost', port: 6379 },
    { name: 'Problematic IP', host: '172.23.100.97', port: 6379 }
  ];

  for (const config of configs) {
    console.log(`Testing: ${config.name} (${config.host}:${config.port})`);
    
    const client = createClient({
      socket: {
        host: config.host,
        port: config.port,
        connectTimeout: 3000
      }
    });

    try {
      await client.connect();
      console.log('✅ SUCCESS: Connected successfully');
      await client.quit();
    } catch (error) {
      console.log('❌ FAILED:', error.message);
    }
    
    console.log('---');
  }
}

diagnoseRedis().catch(console.error);