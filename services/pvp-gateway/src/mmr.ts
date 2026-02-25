export type PvpRatingRow = {
  rating: number;
  deviation: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function expectedScore(ra: number, rb: number) {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

export function updateElo1v1(input: {
  a: PvpRatingRow;
  b: PvpRatingRow;
  aScore: 0 | 0.5 | 1;
}): { nextA: PvpRatingRow; nextB: PvpRatingRow; deltaA: number; deltaB: number } {
  const ra = clamp(Math.round(input.a.rating), 0, 3000);
  const rb = clamp(Math.round(input.b.rating), 0, 3000);

  const ea = expectedScore(ra, rb);
  const eb = expectedScore(rb, ra);

  const baseK = 32;
  const ka = clamp(baseK * clamp(input.a.deviation / 350, 0.25, 1), 8, 48);
  const kb = clamp(baseK * clamp(input.b.deviation / 350, 0.25, 1), 8, 48);

  const aScore = input.aScore;
  const bScore: 0 | 0.5 | 1 = aScore === 1 ? 0 : aScore === 0 ? 1 : 0.5;

  const nextRa = clamp(Math.round(ra + ka * (aScore - ea)), 0, 3000);
  const nextRb = clamp(Math.round(rb + kb * (bScore - eb)), 0, 3000);

  const nextADev = clamp(Math.round(input.a.deviation * 0.97), 60, 350);
  const nextBDev = clamp(Math.round(input.b.deviation * 0.97), 60, 350);

  return {
    nextA: { rating: nextRa, deviation: nextADev },
    nextB: { rating: nextRb, deviation: nextBDev },
    deltaA: nextRa - ra,
    deltaB: nextRb - rb,
  };
}
