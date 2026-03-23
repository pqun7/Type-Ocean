/**
 * PVP WebSocket Load Test — Production-Grade Hardened Script
 *
 * This is the canonical websocket load-test entrypoint for the repo.
 * Artifacts are written under load-tests/pvp-websocket/artifacts/latest.
 *
 * Usage:
 *   k6 run load-tests/pvp-websocket/pvp-websocket.js
 */

import ws from 'k6/ws';
import exec from 'k6/execution';
import { check, fail, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const connectErrors = new Rate('pvp_ws_connect_errors');
const sessionFailures = new Rate('pvp_ws_session_failures');
const helloLatency = new Trend('pvp_ws_hello_latency');
const queueToMatchLatency = new Trend('pvp_ws_queue_to_match_latency');
const matchDuration = new Trend('pvp_ws_match_duration');
const resultsRate = new Rate('pvp_ws_results_rate');
const noErrorsReceived = new Rate('pvp_ws_no_errors_received');
const protocolErrors = new Counter('pvp_ws_protocol_errors');
const protocolViolations = new Counter('pvp_ws_protocol_violations');
const connectRetries = new Counter('pvp_ws_connect_retries');
const inputRtt = new Trend('pvp_input_rtt');
const authErrors = new Rate('pvp_ws_auth_errors');

const TEST_MODE = String(__ENV.PVP_WS_MODE || 'default').toLowerCase();
const IS_AI_STRESS = TEST_MODE === 'ai-stress';
const STRICT_THRESHOLDS = String(__ENV.PVP_STRICT_THRESHOLDS || 'false').toLowerCase() === 'true';
const SUMMARY_PATH = 'load-tests/pvp-websocket/artifacts/latest/ai-stress-summary.json';

const AI_STRESS_TARGET_VUS = Number(__ENV.PVP_AI_STRESS_TARGET_VUS || 500);
const AI_STRESS_PEAK_VUS = Number(__ENV.PVP_AI_STRESS_PEAK_VUS || 1000);
const AI_STAGE1_DUR = String(__ENV.PVP_AI_STRESS_STAGE1_DURATION || '1m');
const AI_STAGE2_DUR = String(__ENV.PVP_AI_STRESS_STAGE2_DURATION || '2m');
const AI_STAGE3_DUR = String(__ENV.PVP_AI_STRESS_STAGE3_DURATION || '1m');

const STAGE1_VUS = Number(__ENV.PVP_DEFAULT_STAGE1_VUS || 12);
const STAGE2_VUS = Number(__ENV.PVP_DEFAULT_STAGE2_VUS || 24);
const STAGE1_DUR = String(__ENV.PVP_DEFAULT_STAGE1_DURATION || '10s');
const STAGE2_DUR = String(__ENV.PVP_DEFAULT_STAGE2_DURATION || '30s');
const STAGE3_DUR = String(__ENV.PVP_DEFAULT_STAGE3_DURATION || '10s');

const MAX_CONNECT_RETRIES = 3;
const RETRY_BASE_MS = 500;

const SESSION_TIMEOUT_MS = Number(__ENV.PVP_SESSION_TIMEOUT_MS || (IS_AI_STRESS ? 120000 : 60000));
const THINK_TIME_SECONDS = Number(__ENV.PVP_THINK_TIME_SECONDS || 1);
const TYPING_DELAY_SCALE = Math.max(0.05, Number(__ENV.PVP_TYPING_DELAY_SCALE || 1));
const TYPING_MIN_DELAY_MS = Math.max(1, Number(__ENV.PVP_TYPING_MIN_DELAY_MS || 1));
const TYPING_FORCE_DELAY_MS = Number(__ENV.PVP_TYPING_FORCE_DELAY_MS || 0);
const TYPING_TYPO_RATE = Math.max(0, Math.min(1, Number(__ENV.PVP_TYPING_TYPO_RATE || 0.05)));
const TYPING_PAUSE_RATE = Math.max(0, Math.min(1, Number(__ENV.PVP_TYPING_PAUSE_RATE || 0.02)));

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'p(99.9)'],
  scenarios: {
    pvp_ws: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: IS_AI_STRESS
        ? [
            { duration: AI_STAGE1_DUR, target: AI_STRESS_TARGET_VUS },
            { duration: AI_STAGE2_DUR, target: AI_STRESS_PEAK_VUS },
            { duration: AI_STAGE3_DUR, target: 0 },
          ]
        : [
            { duration: STAGE1_DUR, target: STAGE1_VUS },
            { duration: STAGE2_DUR, target: STAGE2_VUS },
            { duration: STAGE3_DUR, target: 0 },
          ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    pvp_ws_connect_errors: STRICT_THRESHOLDS ? ['rate==0'] : ['rate<0.05'],
    pvp_ws_session_failures: STRICT_THRESHOLDS ? ['rate<=0.10'] : ['rate<0.35'],
    pvp_ws_results_rate: IS_AI_STRESS ? ['rate>=0'] : ['rate>=0.85'],
    pvp_ws_hello_latency: ['p(95)<1000', 'p(99)<2000', 'p(99.9)<5000', 'max<10000'],
    pvp_ws_queue_to_match_latency: ['p(95)<5000', 'p(99)<10000'],
    pvp_input_rtt: ['p(95)<500', 'p(99)<1500'],
    pvp_ws_no_errors_received: STRICT_THRESHOLDS ? ['rate==1'] : ['rate>=0.95'],
  },
};

export function handleSummary(data) {
  return {
    [SUMMARY_PATH]: JSON.stringify(data, null, 2),
    stdout: `\n[PVP-K6] Summary written -> ${SUMMARY_PATH}\n`,
  };
}

function getFixedClientSecret() {
  const value = String(__ENV.PVP_FIXED_CLIENT_SECRET || '').trim();
  if (!value) {
    fail('Missing PVP_FIXED_CLIENT_SECRET (must match the token minting secret)');
  }
  if (value.length < 32 || value.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    fail('PVP_FIXED_CLIENT_SECRET must be 32-128 chars, only [A-Za-z0-9_-]');
  }
  return value;
}

function loadTokens() {
  const filePath = __ENV.PVP_WS_TOKENS_FILE || '';
  if (filePath) {
    const isAbsolutePath = /^([A-Za-z]:[\\/]|\/)/.test(filePath);
    const candidates = isAbsolutePath
      ? [filePath]
      : [filePath, `../../${filePath.replace(/^\.\//, '')}`];

    let lastError = null;
    for (const candidate of candidates) {
      try {
        const fileRaw = open(candidate);
        const parsed = JSON.parse(fileRaw);
        if (!Array.isArray(parsed) || parsed.length === 0) {
          fail('PVP_WS_TOKENS_FILE must contain a non-empty JSON array');
        }
        return parsed;
      } catch (error) {
        lastError = error;
      }
    }
    fail(`Unable to read PVP_WS_TOKENS_FILE (${candidates.join(', ')}): ${String(lastError)}`);
  }

  const raw = __ENV.PVP_WS_TOKENS_JSON || __ENV.PVP_WS_TOKENS || '';
  if (!raw) {
    fail('Missing PVP_WS_TOKENS_JSON or PVP_WS_TOKENS_FILE (JSON array of tokens)');
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
    if (tokens.length === 0) fail('PVP_WS_TOKENS must contain at least one token');
    return tokens;
  } catch (error) {
    fail(`Unable to parse websocket tokens: ${String(error)}`);
  }
}

const TOKENS = loadTokens();

function randMs(minMs, maxMs) {
  return minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
}

const SPEED_TIERS = [
  { minMs: 30, maxMs: 70 },
  { minMs: 80, maxMs: 150 },
  { minMs: 200, maxMs: 350 },
];

const STATUS_RANK = { WAITING: 0, COUNTDOWN: 1, RUNNING: 2, FINISHED: 3 };

function isValidStatusTransition(prev, next) {
  if (prev === null || prev === undefined) return true;
  const prevRank = STATUS_RANK[prev] ?? -1;
  const nextRank = STATUS_RANK[next] ?? -1;
  return nextRank >= prevRank;
}

export default function pvpWebsocketScenario() {
  const url = __ENV.PVP_WS_URL;
  if (!url) fail('Missing PVP_WS_URL');

  const vuId = exec.vu.idInTest;
  const clientSecret = getFixedClientSecret();
  const userAgentHeader = __ENV.PVP_WS_USER_AGENT || 'k6-ai-stress/1.0';
  const originHeader = __ENV.PVP_WS_ORIGIN || 'http://localhost:3000';

  let tokenIndex = Math.max(0, vuId - 1) % TOKENS.length;
  let sessionCompleted = false;
  let finalErrorReceived = false;
  let finalAuthError = false;

  for (let attempt = 0; attempt < MAX_CONNECT_RETRIES; attempt += 1) {
    if (attempt > 0) {
      connectRetries.add(1);
      sleep((RETRY_BASE_MS * Math.pow(2, attempt - 1)) / 1000);
    }

    const token = TOKENS[tokenIndex % TOKENS.length];

    let helloSentAt = 0;
    let queueJoinedAt = 0;
    let matchStartedAt = 0;
    let lastSeenRevision = 0;
    let lastSeq = 0;
    let activeMatchId = null;
    let textSnapshot = '';
    let inputStr = '';
    let inputNonce = null;
    let live = false;
    let closed = false;
    let errorReceived = false;
    let authError = false;
    let isRetryable = false;
    let typingStarted = false;
    let lastSeenStatus = null;

    const inputSentAt = {};
    let speedTierIdx = Math.floor(Math.random() * SPEED_TIERS.length);
    let charsInTier = 0;
    let tierLength = randMs(5, 15);

    function scheduleNextInput(socket) {
      if (!live || !activeMatchId || !textSnapshot || closed) return;

      if (inputStr.length >= textSnapshot.length) {
        socket.send(JSON.stringify({
          type: 'FINISH',
          payload: { matchId: activeMatchId, clientTs: Date.now() },
        }));
        return;
      }

      charsInTier += 1;
      if (charsInTier >= tierLength) {
        speedTierIdx = Math.floor(Math.random() * SPEED_TIERS.length);
        tierLength = randMs(5, 15);
        charsInTier = 0;
      }

      let delay;
      if (TYPING_FORCE_DELAY_MS > 0) {
        delay = Math.max(TYPING_MIN_DELAY_MS, TYPING_FORCE_DELAY_MS);
      } else {
        const tier = SPEED_TIERS[speedTierIdx];
        delay = randMs(tier.minMs, tier.maxMs);
        if (Math.random() < TYPING_PAUSE_RATE) {
          delay += randMs(500, 1500);
        }
        delay = Math.max(TYPING_MIN_DELAY_MS, Math.round(delay * TYPING_DELAY_SCALE));
      }

      socket.setTimeout(function () {
        if (!live || closed) return;

        const isTypo = Math.random() < TYPING_TYPO_RATE && inputStr.length > 0;

        if (isTypo) {
          const wrongChar = inputStr.length % 2 === 0 ? 'X' : 'Z';
          inputStr = inputStr + wrongChar;
          lastSeq += 1;
          const typoTs = Date.now();
          inputSentAt[lastSeq] = typoTs;
          socket.send(JSON.stringify({
            type: 'INPUT_UPDATE',
            payload: {
              matchId: activeMatchId,
              input: inputStr,
              seq: lastSeq,
              clientTs: typoTs,
              ...(inputNonce ? { inputNonce } : {}),
            },
          }));

          socket.setTimeout(function () {
            if (!live || closed) return;
            inputStr = inputStr.slice(0, -1);
            lastSeq += 1;
            const corrTs = Date.now();
            inputSentAt[lastSeq] = corrTs;
            socket.send(JSON.stringify({
              type: 'INPUT_UPDATE',
              payload: {
                matchId: activeMatchId,
                input: inputStr,
                seq: lastSeq,
                clientTs: corrTs,
                ...(inputNonce ? { inputNonce } : {}),
              },
            }));
            scheduleNextInput(socket);
          }, TYPING_FORCE_DELAY_MS > 0
            ? Math.max(TYPING_MIN_DELAY_MS, TYPING_FORCE_DELAY_MS)
            : Math.max(TYPING_MIN_DELAY_MS, Math.round(randMs(30, 80) * TYPING_DELAY_SCALE)));
        } else {
          inputStr = textSnapshot.slice(0, inputStr.length + 1);
          lastSeq += 1;
          const now = Date.now();
          inputSentAt[lastSeq] = now;
          socket.send(JSON.stringify({
            type: 'INPUT_UPDATE',
            payload: {
              matchId: activeMatchId,
              input: inputStr,
              seq: lastSeq,
              clientTs: now,
              ...(inputNonce ? { inputNonce } : {}),
            },
          }));
          scheduleNextInput(socket);
        }
      }, delay);
    }

    const response = ws.connect(url, {
      headers: {
        'User-Agent': userAgentHeader,
        Origin: originHeader,
      },
    }, function (socket) {
      socket.on('open', function () {
        helloSentAt = Date.now();
        socket.send(JSON.stringify({
          type: 'HELLO',
          payload: { token, clientSecret },
        }));
      });

      socket.on('message', function (raw) {
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
            break;
          }

          case 'MATCH_FOUND': {
            queueToMatchLatency.add(Date.now() - queueJoinedAt);
            activeMatchId = message.payload.matchId;
            textSnapshot = message.payload.textSnapshot;
            inputNonce = message.payload.inputNonce || null;

            const hasNonce = check(message, {
              'MATCH_FOUND contains inputNonce': (msg) => !!msg.payload.inputNonce,
            });
            if (!hasNonce) {
              protocolErrors.add(1);
              console.log(`[PVP-K6][WARN][vu=${vuId}] MATCH_FOUND missing inputNonce matchId=${String(activeMatchId || '')}`);
            }

            socket.send(JSON.stringify({
              type: 'MATCH_JOIN',
              payload: { matchId: activeMatchId, lastSeenRevision },
            }));
            break;
          }

          case 'MATCH_STATE': {
            const revision = Number(message.payload.revision || 0);
            const status = String(message.payload.status || '');
            if (revision < lastSeenRevision) {
              protocolViolations.add(1);
              console.log(`[PVP-K6][VIOLATION][vu=${vuId}] MATCH_STATE revision backward: ${lastSeenRevision} -> ${revision} matchId=${String(activeMatchId || '')}`);
            }
            lastSeenRevision = Math.max(lastSeenRevision, revision);

            if (status && !isValidStatusTransition(lastSeenStatus, status)) {
              protocolViolations.add(1);
              console.log(`[PVP-K6][VIOLATION][vu=${vuId}] invalid MATCH_STATE transition: ${lastSeenStatus} -> ${status}`);
            }
            if (status) lastSeenStatus = status;

            activeMatchId = message.payload.matchId;
            textSnapshot = message.payload.textSnapshot;
            inputStr = '';
            lastSeq = 0;
            live = status === 'RUNNING';
            if (matchStartedAt === 0) matchStartedAt = Date.now();
            if (live && !typingStarted) {
              typingStarted = true;
              scheduleNextInput(socket);
            }
            break;
          }

          case 'PROGRESS': {
            const revision = Number(message.payload.revision || 0);
            if (revision < lastSeenRevision) {
              protocolViolations.add(1);
            }
            lastSeenRevision = Math.max(lastSeenRevision, revision);

            const responseSeq = message.payload.seq;
            if (responseSeq !== undefined && inputSentAt[responseSeq] !== undefined) {
              inputRtt.add(Date.now() - inputSentAt[responseSeq]);
              delete inputSentAt[responseSeq];
            }

            if (message.payload.userId) {
              const newStatus = String(message.payload.status || '');
              if (newStatus && !isValidStatusTransition(lastSeenStatus, newStatus)) {
                protocolViolations.add(1);
              }
              if (newStatus) lastSeenStatus = newStatus;
              live = newStatus === 'RUNNING';
              if (live && !typingStarted) {
                typingStarted = true;
                scheduleNextInput(socket);
              }
            }
            break;
          }

          case 'MATCH_ENDED': {
            live = false;
            break;
          }

          case 'RESULTS': {
            resultsRate.add(1);
            sessionCompleted = true;
            if (matchStartedAt > 0) matchDuration.add(Date.now() - matchStartedAt);
            socket.close();
            break;
          }

          case 'ERROR': {
            errorReceived = true;
            protocolErrors.add(1);
            const payload = message.payload || {};
            const code = String(payload.code || 'UNKNOWN');
            const messageText = String(payload.message || 'Unknown error');
            const retryable = payload.retryable === true;
            const phase = String((payload.details && payload.details.phase) || 'unknown');
            const requestId = String((payload.details && payload.details.requestId) || 'none');

            isRetryable = retryable;

            const isAuthCode = code === 'AUTH_ERROR_TOKEN' || code === 'AUTH_RATE_LIMITED';
            console.log(`[PVP-K6][ERROR][vu=${vuId}][attempt=${attempt}] code=${code} retryable=${retryable} auth=${isAuthCode} phase=${phase} requestId=${requestId} message=${messageText}`);

            if (code === 'AUTH_ERROR_TOKEN') {
              authError = true;
              tokenIndex = (tokenIndex + 1) % TOKENS.length;
            }

            socket.close();
            break;
          }

          default:
            break;
        }
      });

      socket.setTimeout(function () {
        if (!closed) socket.close();
      }, SESSION_TIMEOUT_MS);

      socket.on('close', function (closeCode, closeReason) {
        closed = true;
        if (closeCode >= 4000) {
          console.log(`[PVP-K6][CLOSE][vu=${vuId}][attempt=${attempt}] code=${closeCode} reason=${String(closeReason || 'none')}`);
        }
      });

      socket.on('error', function (error) {
        connectErrors.add(1);
        console.log(`[PVP-K6][TRANSPORT_ERR][vu=${vuId}][attempt=${attempt}] ${String(error)}`);
      });
    });

    check(response, {
      'websocket handshake status is 101': (res) => res && res.status === 101,
    });

    if (!response || response.status !== 101) {
      connectErrors.add(1);
    }

    finalErrorReceived = errorReceived;
    finalAuthError = authError;

    if (sessionCompleted) break;
    if (!errorReceived) break;
    if (authError) continue;
    if (isRetryable) continue;
    break;
  }

  noErrorsReceived.add(finalErrorReceived ? 0 : 1);
  sessionFailures.add(sessionCompleted ? 0 : 1);
  authErrors.add(finalAuthError ? 1 : 0);

  sleep(THINK_TIME_SECONDS);
}
