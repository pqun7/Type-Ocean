// components/auth/reset-password-form.tsx
"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { updatePassword, PasswordState } from "@/actions/reset-password";
import { Loader } from "@/assets";
import dynamic from "next/dynamic";
const Lottie = dynamic(() => import("lottie-react"), { ssr: false });

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();

  const [state, formAction] = useFormState<PasswordState, FormData>(
    updatePassword,
    {
      success: false,
      error: null,
    }
  );

  useEffect(() => {
    if (state.success) {
      setTimeout(() => {
        router.push('/auth/login');
      }, 3000);
    }
  }, [state.success]);

  if (!token) {
    return (
      <div className="text-center text-red-500">
        Invalid reset link. Please request a new password reset.
      </div>
    );
  }
  return (
    <div className="w-full max-w-md space-y-6 p-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Set New Password</h1>
        <p className="text-muted-foreground">
          {state.success
            ? "Password updated successfully!"
            : "Please enter your new password"}
        </p>
      </div>

      {!state.success && (
        <form action={formAction} className="space-y-4">
          <input
            type="hidden"
            name="token"
            value={encodeURIComponent(token)} // أضف encoding إضافي
          />

          <div className="space-y-2">
            <Label htmlFor="password">New Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              minLength={8}
            />
          </div>

          {state.error && (
            <p className="text-sm text-red-500 text-center">{state.error}</p>
          )}

          <SubmitButton />
        </form>
      )}

      {state.success && (
        <Button asChild className="w-full">
          <Link href="/auth/login">Log in Now</Link>
        </Button>
      )}
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full gap-2" disabled={pending}>
      {pending ? (
        <>
          <Lottie animationData={Loader} loop className="w-15 h-15" />{" "}
          {/* Sending... */}
        </>
      ) : (
        "Send Reset Link"
      )}
    </Button>
  );
}

