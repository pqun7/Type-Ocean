import prisma from "@/features/auth/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRankInfo } from "@/features/ranking/rating";

export const revalidate = 30;

export default async function LeaderboardPage() {
  const top = await prisma.playerProfile.findMany({
    orderBy: [{ rating: "desc" }, { updatedAt: "desc" }],
    take: 50,
    select: {
      userId: true,
      username: true,
      avatar: true,
      rating: true,
    },
  });

  return (
    <div className="min-h-svh p-6 md:p-10">
      <div className="mx-auto max-w-4xl">
        <Card className="border-white/10 bg-white/5">
          <CardHeader>
            <CardTitle className="text-[#E0E7FF]">Leaderboard</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {top.length === 0 ? (
              <div className="text-sm text-[#8A8FB5]">No ranked players yet.</div>
            ) : (
              <div className="divide-y divide-white/10 rounded-xl border border-white/10">
                {top.map((p, idx) => {
                  const rank = getRankInfo(p.rating);
                  return (
                    <div
                      key={p.userId}
                      className="flex items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="w-10 text-sm font-semibold text-[#E0E7FF]">#{idx + 1}</div>
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
                          <div className="text-xs text-[#8A8FB5]">
                            {rank.tier} {rank.division}
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
