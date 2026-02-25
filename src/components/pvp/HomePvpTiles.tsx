"use client";

import Link from "next/link";
import { Swords, Users } from "lucide-react";

import { StatTile } from "@/components/ui/stat-tile";

export default function HomePvpTiles() {
  return (
    <div className="w-full max-w-5xl mx-auto px-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link href="/pvp/1v1" className="block">
          <StatTile
            label="Ranked 1v1"
            value="Play ranked"
            subValue="Skill-based matchmaking"
            icon={<Swords className="h-4 w-4" />}
            gradient="bg-gradient-to-r from-cyan-200 to-blue-300"
            className="shadow-xl"
          />
        </Link>

        <Link href="/pvp/room" className="block">
          <StatTile
            label="Private Room"
            value="Create or join"
            subValue="Race with 2–6 friends"
            icon={<Users className="h-4 w-4" />}
            gradient="bg-gradient-to-r from-violet-200 to-fuchsia-300"
            className="shadow-xl"
          />
        </Link>
      </div>
    </div>
  );
}
