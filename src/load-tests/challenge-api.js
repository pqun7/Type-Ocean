// load-tests/challenge-api.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const updateLatency = new Trend('update_latency');

export const options = {
  stages: [
    { duration: '2m', target: 100 },  // Ramp up
    { duration: '5m', target: 500 },  // Load test
    { duration: '2m', target: 1000 }, // Stress test
    { duration: '2m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% under 500ms
    errors: ['rate<0.01'],            // Error rate < 1%
    update_latency: ['p(95)<300']     // Updates under 300ms
  }
};

export default function () {
  const baseUrl = __ENV.API_URL || 'http://localhost:3000';
  const headers = {
    'Content-Type': 'application/json',
    'Cookie': `session=${__ENV.SESSION_TOKEN}`
  };

  // Test GET challenge
  const getRes = http.get(`${baseUrl}/api/challenge/v1/daily`, { headers });
  const getOk = check(getRes, {
    'GET challenge status 200': (r) => r.status === 200,
    'GET challenge has data': (r) => r.json('id') !== undefined,
  });

  if (!getOk) {
    errorRate.add(1);
    sleep(1);
    return;
  }

  // Test PATCH update
  const updatePayload = JSON.stringify({
    progress: {
      wpm: Math.round(Math.random() * 100 + 20),
      accuracy: Math.round(Math.random() * 20 + 80),
      textLength: 500,
      timeSpent: 60,
      errors: 2
    }
  });

  const updateRes = http.patch(`${baseUrl}/api/challenge/v1/daily`, updatePayload, { headers });
  const updateSuccess = check(updateRes, {
    'UPDATE challenge status 200': (r) => r.status === 200,
    'UPDATE returns valid data': (r) => r.json('status') !== undefined,
  });

  errorRate.add(!updateSuccess);
  updateLatency.add(updateRes.timings.duration);

  sleep(1);
}