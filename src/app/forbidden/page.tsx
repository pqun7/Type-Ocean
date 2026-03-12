import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type ForbiddenPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const getSourceLabel = (from: string | string[] | undefined) => {
  const value = Array.isArray(from) ? from[0] : from;

  if (value === "admin") {
    return "the admin area";
  }

  return "this page";
};

export default async function ForbiddenPage({ searchParams }: ForbiddenPageProps) {
  const params = searchParams ? await searchParams : undefined;
  const sourceLabel = getSourceLabel(params?.from);

  return (
    <main className="flex min-h-svh items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),_transparent_32%),linear-gradient(180deg,_rgba(15,23,42,1)_0%,_rgba(2,6,23,1)_100%)] px-6 py-16 text-slate-100">
      <Card className="w-full max-w-2xl border-white/15 bg-slate-950/60 shadow-[0_24px_80px_rgba(15,23,42,0.45)]">
        <CardHeader className="space-y-3">
          <div className="inline-flex w-fit items-center rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-amber-200">
            403 Access Denied
          </div>
          <CardTitle className="text-3xl font-semibold text-white sm:text-4xl">
            You are signed in, but you do not have access to {sourceLabel}.
          </CardTitle>
          <CardDescription className="max-w-xl text-sm leading-6 text-slate-300">
            This route exists and is working. Your account just does not have the required role to open it.
            If you expected admin access, verify your account role in the database before trying again.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-slate-300">
            Anonymous users are redirected to sign-in. Authenticated non-admin users are sent here so the app returns the correct authorization outcome instead of a misleading not-found response.
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild className="bg-sky-500 text-slate-950 hover:bg-sky-400">
              <Link href="/home">Go To Home</Link>
            </Button>
            <Button asChild variant="outline" className="border-white/15 bg-transparent text-slate-100 hover:bg-white/10 hover:text-white">
              <Link href="/profile">Open Profile</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}