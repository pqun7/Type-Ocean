import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRankImageSrc } from "@/features/ranking/rank-visuals";
import { getLeaderboardPage } from "@/features/pvp/server/leaderboard-cache";

export const revalidate = 30;

export default async function LeaderboardPage() {
  const top = await getLeaderboardPage({ limit: 50, offset: 0 });

  return (
    <div className="min-h-svh p-6 md:p-10">
      <div className="mx-auto max-w-4xl">
        <Card className="border-white/10 bg-white/5">
          <CardHeader>
            <CardTitle className="text-[#E0E7FF]">Leaderboard</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {top.entries.length === 0 ? (
              <div className="text-sm text-[#8A8FB5]">No ranked players yet.</div>
            ) : (
              <div className="divide-y divide-white/10 rounded-xl border border-white/10">
                {top.entries.map((p) => {
                  const rankSrc = getRankImageSrc(p.tier);
                  return (
                    <div
                      key={p.userId}
                      className="flex items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="w-10 text-sm font-semibold text-[#E0E7FF]">#{p.position}</div>
                        <div className="h-9 w-9 overflow-hidden rounded-full border border-white/10 bg-white/5">
                          {p.avatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={p.avatar}
                              alt={p.username}
                              className="h-full w-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : null}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-[#E0E7FF]">
                            {p.username}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <Image src={rankSrc} alt={p.tier} width={28} height={28} className="h-8 w-8 object-contain drop-shadow-[0_0_10px_rgba(100,200,255,0.5)]" />
                            <span className="text-xs text-[#8A8FB5]">{p.tier}</span>
                          </div>
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-sm font-semibold text-[#E0E7FF]">{p.rating}</div>
                        <div className="text-xs text-[#8A8FB5]">rating</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
