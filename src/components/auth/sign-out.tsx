"use client";
import { signOutAction } from "./sign-out.action";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SignOutProps = {
  label?: string;
  redirectTo?: string;
  className?: string;
};

export function SignOut({ label = "Sign Out", redirectTo = "/auth", className }: SignOutProps) {
  return (
    <form action={signOutAction}>
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <Button type="submit" variant="destructive" className={cn("w-full", className)}>
        {label}
      </Button>
    </form>
  );
}
