"use client";

import Link from "next/link";
import useSWR from "swr";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getRankIconForTier } from "@/features/ranking/rank-visuals";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function PvpCards() {
  const { data } = useSWR("/api/pvp/me", fetcher);

  return (
    <div className="w-full max-w-5xl mx-auto px-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link href="/pvp/1v1" className="block">
          <Card className="border border-[rgba(160,220,255,0.15)] bg-[rgba(20,50,80,0.3)] backdrop-blur-sm shadow-xl overflow-hidden hover:border-[rgba(160,220,255,0.3)] transition-all">
            <CardHeader className="pb-2">
              <CardTitle className="text-[#E0E7FF]">Ranked 1v1</CardTitle>
              <CardDescription className="text-[#8A8FB5]">Skill-based matchmaking. Affects your 1v1 rank.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-[#E0E7FF]/90">
              <div className="flex items-center justify-between">
                <span>Rating</span>
                <span>{data?.rating?.rating ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span>Rank</span>
                <span>
                  {data?.rank?.tier ? (
                    (() => {
                      const RankIcon = getRankIconForTier(data.rank.tier);
                      return (
                        <span className="inline-flex items-center gap-1.5">
                          <RankIcon className="h-4 w-4 text-cyan-300" />
                          <span>{data.rank.tier}</span>
                          {data?.classified ? (
                            <span className="ml-1 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cyan-200">
                              Top 1%
                            </span>
                          ) : null}
                        </span>
                      );
                    })()
                  ) : (
                    "—"
                  )}
                </span>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/pvp/room" className="block">
          <Card className="border border-[rgba(160,220,255,0.15)] bg-[rgba(20,50,80,0.3)] backdrop-blur-sm shadow-xl overflow-hidden hover:border-[rgba(160,220,255,0.3)] transition-all">
            <CardHeader className="pb-2">
              <CardTitle className="text-[#E0E7FF]">Private Room</CardTitle>
              <CardDescription className="text-[#8A8FB5]">Create a room code and race with 2–6 friends.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-[#E0E7FF]/90">
              <div>Colored carets per player.</div>
              <div className="mt-1">Longer text snapshot per match.</div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
