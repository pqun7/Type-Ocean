/**
 * Clamps a number between min and max.
 */
function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Writes a string into a DataView at the given offset.
 */
function writeString(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

/**
 * Converts a Uint8Array to a base64 string efficiently.
 */
function toBase64(bytes: Uint8Array): string {
  const chunkSize = 32768;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Creates a deep, thocky mechanical keyboard sound as a WAV data URL.
 * Optimized for bass‑heavy, muted resonance with a satisfying, quiet feel.
 */
export type KeyboardSfxKind = "key" | "space" | "enter" | "tab";

type SfxProfile = {
  durationMs: number;
  // Time constants (seconds)
  tauThock: number;
  tauHarm: number;
  tauBody: number;
  tauClick: number;
  tauNoise: number;
  // Frequencies (Hz)
  fThock: number;
  fHarm: number;
  fBody: number;
  fClick: number;
  // Gains
  gThock: number;
  gHarm: number;
  gBody: number;
  gClick: number;
  gNoise: number;
  // Filter
  fc: number;
  Q: number;
};

function profileFor(kind: KeyboardSfxKind): SfxProfile {
  // هدفنا: ASMR "thock" هادئ، مع اختلاف بسيط للأزرار الخاصة.
  switch (kind) {
    case "space":
      return {
        durationMs: 32,
        tauThock: 0.030,
        tauHarm: 0.020,
        tauBody: 0.015,
        tauClick: 0.007,
        tauNoise: 0.012,
        fThock: 95,
        fHarm: 190,
        fBody: 380,
        fClick: 760,
        gThock: 0.70,
        gHarm: 0.22,
        gBody: 0.12,
        gClick: 0.025,
        gNoise: 0.070,
        fc: 700,
        Q: 2.2,
      };
    case "enter":
      return {
        durationMs: 28,
        tauThock: 0.028,
        tauHarm: 0.018,
        tauBody: 0.013,
        tauClick: 0.006,
        tauNoise: 0.010,
        fThock: 120,
        fHarm: 240,
        fBody: 480,
        fClick: 920,
        gThock: 0.62,
        gHarm: 0.23,
        gBody: 0.13,
        gClick: 0.040,
        gNoise: 0.085,
        fc: 900,
        Q: 1.9,
      };
    case "tab":
      return {
        durationMs: 26,
        tauThock: 0.024,
        tauHarm: 0.017,
        tauBody: 0.012,
        tauClick: 0.006,
        tauNoise: 0.010,
        fThock: 140,
        fHarm: 280,
        fBody: 560,
        fClick: 1100,
        gThock: 0.58,
        gHarm: 0.24,
        gBody: 0.12,
        gClick: 0.045,
        gNoise: 0.090,
        fc: 1100,
        Q: 1.7,
      };
    case "key":
    default:
      return {
        durationMs: 25,
        tauThock: 0.025,
        tauHarm: 0.018,
        tauBody: 0.012,
        tauClick: 0.006,
        tauNoise: 0.010,
        fThock: 110,
        fHarm: 220,
        fBody: 440,
        fClick: 880,
        gThock: 0.60,
        gHarm: 0.25,
        gBody: 0.12,
        gClick: 0.03,
        gNoise: 0.08,
        fc: 800,
        Q: 2.0,
      };
  }
}

function createKeyboardClickWavUrlWithProfile(profile: SfxProfile): string {
  const sampleRate = 44100;

  const {
    durationMs,
    tauThock,
    tauHarm,
    tauBody,
    tauClick,
    tauNoise,
    fThock,
    fHarm,
    fBody,
    fClick,
    gThock,
    gHarm,
    gBody,
    gClick,
    gNoise,
    fc,
    Q,
  } = profile;

  const sampleCount = (sampleRate * durationMs) / 1000 | 0; // ~1102 samples

  // Time constants (in seconds) for exponential decays
  // Pre‑compute decay factors: exp(-1 / (sampleRate * tau))
  const decayThock   = Math.exp(-1 / (sampleRate * tauThock));
  const decayHarm    = Math.exp(-1 / (sampleRate * tauHarm));
  const decayBody    = Math.exp(-1 / (sampleRate * tauBody));
  const decayClick   = Math.exp(-1 / (sampleRate * tauClick));
  const decayNoise   = Math.exp(-1 / (sampleRate * tauNoise));

  // Phase increments per sample
  const twoPiOverSampleRate = 2 * Math.PI / sampleRate;
  const ωThock = twoPiOverSampleRate * fThock;
  const ωHarm  = twoPiOverSampleRate * fHarm;
  const ωBody  = twoPiOverSampleRate * fBody;
  const ωClick = twoPiOverSampleRate * fClick;

  // Biquad low‑pass filter coefficients (cutoff 800 Hz, Q = 2.0)
  const ω0 = 2 * Math.PI * fc / sampleRate;
  const cosω0 = Math.cos(ω0);
  const sinω0 = Math.sin(ω0);
  const alpha = sinω0 / (2 * Q);

  // Low‑pass biquad coefficients (normalized by a0)
  const b0 = (1 - cosω0) / 2;
  const b1 = 1 - cosω0;
  const b2 = b0;
  const a0 = 1 + alpha;
  const a1 = -2 * cosω0;
  const a2 = 1 - alpha;

  // Normalize
  const normB0 = b0 / a0;
  const normB1 = b1 / a0;
  const normB2 = b2 / a0;
  const normA1 = a1 / a0;
  const normA2 = a2 / a0;

  // Sample buffer
  const samples = new Float32Array(sampleCount);

  // Phase accumulators
  let phaseThock = 0;
  let phaseHarm  = 0;
  let phaseBody  = 0;
  let phaseClick = 0;

  // Envelope states (start at 1.0)
  let envThock = 1.0;
  let envHarm  = 1.0;
  let envBody  = 1.0;
  let envClick = 1.0;
  let envNoise = 1.0;

  // Filter state (Direct Form I)
  let x1 = 0, x2 = 0; // previous two inputs
  let y1 = 0, y2 = 0; // previous two outputs

  let maxAbs = 0;

  for (let i = 0; i < sampleCount; i++) {
    // Sine waves with envelopes
    const sThock = Math.sin(phaseThock) * envThock * gThock;
    const sHarm  = Math.sin(phaseHarm)  * envHarm  * gHarm;
    const sBody  = Math.sin(phaseBody)  * envBody  * gBody;
    const sClick = Math.sin(phaseClick) * envClick * gClick;

    // Filtered noise (white noise shaped by the same low‑pass filter)
    const noise = (Math.random() * 2 - 1) * envNoise * gNoise;

    // Sum of all sources
    const input = sThock + sHarm + sBody + sClick + noise;

    // Apply biquad low‑pass filter
    const output = normB0 * input + normB1 * x1 + normB2 * x2 - normA1 * y1 - normA2 * y2;

    // Update filter state
    x2 = x1;
    x1 = input;
    y2 = y1;
    y1 = output;

    samples[i] = output;

    // Track peak for normalization
    const absVal = Math.abs(output);
    if (absVal > maxAbs) maxAbs = absVal;

    // Update phases
    phaseThock += ωThock;
    phaseHarm  += ωHarm;
    phaseBody  += ωBody;
    phaseClick += ωClick;

    // Update envelopes (exponential decay)
    envThock *= decayThock;
    envHarm  *= decayHarm;
    envBody  *= decayBody;
    envClick *= decayClick;
    envNoise *= decayNoise;
  }

  // Normalize to 0.85 to leave headroom and keep the sound quiet yet present
  if (maxAbs > 0) {
    const scale = 0.85 / maxAbs;
    for (let i = 0; i < sampleCount; i++) {
      samples[i] *= scale;
    }
  }

  // ────────────────────────────────────────────────
  // Build WAV header (16-bit mono PCM)
  // ────────────────────────────────────────────────
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = numChannels * (bitsPerSample >> 3);
  const byteRate = sampleRate * blockAlign;
  const dataSize = sampleCount * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < sampleCount; i++) {
    const s = clamp(samples[i], -1, 1);
    view.setInt16(offset, s * 32767 | 0, true);
    offset += 2;
  }

  const base64 = toBase64(new Uint8Array(buffer));
  return `data:audio/wav;base64,${base64}`;
}

export function createKeyboardSfxWavUrl(kind: KeyboardSfxKind): string {
  return createKeyboardClickWavUrlWithProfile(profileFor(kind));
}

export function createKeyboardClickWavUrl(): string {
  return createKeyboardSfxWavUrl("key");
}