import PvpMatchClient from "@/components/pvp/PvpMatchClient";

const TEST_MATCH_ID = "test-match-local";

export default function PvpMatchTestPage() {

  return (
    <main className="px-4 py-6 md:px-6">
      <div className="mx-auto w-full max-w-6xl space-y-3">
        <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-slate-200">
          Test page only: PvpMatchClient is running in local test mode.
          <div className="mt-1 text-xs text-slate-400">This page does not require matchId from URL.</div>
        </div>
        <PvpMatchClient matchId={TEST_MATCH_ID} />
      </div>
    </main>
  );
}
