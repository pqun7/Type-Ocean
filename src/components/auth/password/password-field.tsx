"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type PasswordFieldProps = Omit<React.ComponentProps<typeof Input>, "type"> & {
  wrapperClassName?: string;
  toggleClassName?: string;
  initiallyVisible?: boolean;
};

export const PasswordField = React.forwardRef<HTMLInputElement, PasswordFieldProps>(
  (
    {
      className,
      wrapperClassName,
      toggleClassName,
      initiallyVisible = false,
      ...props
    },
    ref
  ) => {
    const [visible, setVisible] = React.useState(initiallyVisible);

    return (
      <div className={cn("relative", wrapperClassName)}>
        <Input
          ref={ref}
          {...props}
          type={visible ? "text" : "password"}
          className={cn("pr-10", className)}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className={cn(
            "absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 transition-colors hover:text-slate-100",
            toggleClassName
          )}
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      </div>
    );
  }
);

PasswordField.displayName = "PasswordField";
