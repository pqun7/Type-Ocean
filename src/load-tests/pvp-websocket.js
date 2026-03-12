import ws from 'k6/ws';
import exec from 'k6/execution';
import { check, fail, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const connectErrors = new Rate('pvp_ws_connect_errors');
const helloLatency = new Trend('pvp_ws_hello_latency');
const queueToMatchLatency = new Trend('pvp_ws_queue_to_match_latency');
const matchDuration = new Trend('pvp_ws_match_duration');
const resultsRate = new Rate('pvp_ws_results_rate');
const protocolErrors = new Counter('pvp_ws_protocol_errors');

export const options = {
  scenarios: {
    pvp_ws: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    pvp_ws_connect_errors: ['rate<0.05'],
    pvp_ws_results_rate: ['rate>0.80'],
    pvp_ws_hello_latency: ['p(95)<1000'],
    pvp_ws_queue_to_match_latency: ['p(95)<5000'],
  },
};

function randomHex(byteLength) {
  const chars = '0123456789abcdef';
  let output = '';
  for (let index = 0; index < byteLength * 2; index += 1) {
    output += chars[Math.floor(Math.random() * chars.length)];
  }
  return output;
}

function loadTokens() {
  const raw = __ENV.PVP_WS_TOKENS_JSON || __ENV.PVP_WS_TOKENS || '';
  if (!raw) {
    fail('Missing PVP_WS_TOKENS_JSON (JSON array of websocket tokens)');
  }

  try {
    if (raw.trim().startsWith('[')) {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        fail('PVP_WS_TOKENS_JSON must be a non-empty JSON array');
      }
      return parsed;
    }

    const tokens = raw.split(',').map((token) => token.trim()).filter(Boolean);
    if (tokens.length === 0) {
      fail('PVP_WS_TOKENS must contain at least one token');
    }
    return tokens;
  } catch (error) {
    fail(`Unable to parse websocket tokens: ${String(error)}`);
  }
}

const TOKENS = loadTokens();
const INPUT_INTERVAL_MS = Number(__ENV.PVP_INPUT_INTERVAL_MS || 75);
const THINK_TIME_SECONDS = Number(__ENV.PVP_THINK_TIME_SECONDS || 1);

export default function () {
  const url = __ENV.PVP_WS_URL;
  if (!url) {
    fail('Missing PVP_WS_URL');
  }

  const vuIndex = Math.max(0, exec.vu.idInTest - 1);
  const token = TOKENS[vuIndex % TOKENS.length];
  const clientSecret = randomHex(32);
  const startedAt = Date.now();

  let helloSentAt = 0;
  let queueJoinedAt = 0;
  let matchStartedAt = 0;
  let lastSeq = 0;
  let activeMatchId = null;
  let textSnapshot = '';
  let input = '';
  let live = false;
  let closed = false;

  const response = ws.connect(url, {}, function (socket) {
    socket.on('open', () => {
      helloSentAt = Date.now();
      socket.send(JSON.stringify({
        type: 'HELLO',
        payload: {
          token,
          clientSecret,
        },
      }));
    });

    socket.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        protocolErrors.add(1);
        return;
      }

      switch (message.type) {
        case 'HELLO_OK': {
          helloLatency.add(Date.now() - helloSentAt);
          queueJoinedAt = Date.now();
          socket.send(JSON.stringify({ type: 'QUEUE_JOIN', payload: {} }));
          return;
        }
        case 'MATCH_FOUND': {
          queueToMatchLatency.add(Date.now() - queueJoinedAt);
          activeMatchId = message.payload.matchId;
          textSnapshot = message.payload.textSnapshot;
          socket.send(JSON.stringify({ type: 'MATCH_JOIN', payload: { matchId: activeMatchId } }));
          return;
        }
        case 'MATCH_STATE': {
          activeMatchId = message.payload.matchId;
          textSnapshot = message.payload.textSnapshot;
          input = '';
          lastSeq = 0;
          live = message.payload.status === 'RUNNING';
          if (matchStartedAt === 0) {
            matchStartedAt = Date.now();
          }
          return;
        }
        case 'PROGRESS': {
          if (message.payload.userId) {
            live = message.payload.status === 'RUNNING';
          }
          return;
        }
        case 'MATCH_ENDED': {
          live = false;
          return;
        }
        case 'RESULTS': {
          resultsRate.add(1);
          if (matchStartedAt > 0) {
            matchDuration.add(Date.now() - matchStartedAt);
          }
          socket.close();
          return;
        }
        case 'ERROR': {
          protocolErrors.add(1);
          socket.close();
          return;
        }
        default:
          return;
      }
    });

    socket.setInterval(() => {
      if (!activeMatchId || !textSnapshot || !live || closed) return;
      if (input.length >= textSnapshot.length) return;

      const nextLength = Math.min(textSnapshot.length, input.length + 2);
      input = textSnapshot.slice(0, nextLength);
      lastSeq += 1;
      const now = Date.now();
      socket.send(JSON.stringify({
        type: 'INPUT_UPDATE',
        payload: {
          matchId: activeMatchId,
          input,
          seq: lastSeq,
          clientTs: now,
        },
      }));

      if (input.length >= textSnapshot.length) {
        socket.send(JSON.stringify({
          type: 'FINISH',
          payload: {
            matchId: activeMatchId,
            clientTs: now,
          },
        }));
      }
    }, INPUT_INTERVAL_MS);

    socket.setTimeout(() => {
      if (!closed) {
        connectErrors.add(1);
        socket.close();
      }
    }, Number(__ENV.PVP_SESSION_TIMEOUT_MS || 30000));

    socket.on('close', () => {
      closed = true;
      if (matchStartedAt === 0 && Date.now() - startedAt > 5000) {
        connectErrors.add(1);
      }
    });

    socket.on('error', () => {
      connectErrors.add(1);
    });
  });

  check(response, {
    'websocket handshake status is 101': (res) => res && res.status === 101,
  });

  sleep(THINK_TIME_SECONDS);
}
