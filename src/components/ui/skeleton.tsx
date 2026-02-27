import { cn } from "@/lib/utils"

/**
 * Modern, accessible skeleton loader.
 *
 * Design goal:
 * - Match the profile page aesthetic (dark blue‑transparent backgrounds, subtle cyan borders).
 * - Use **opacity pulse** only (no left/right shimmer movement).
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  // Preserve the exact same ARIA logic – skeleton is decorative unless consumer explicitly sets ARIA attributes
  const isDecorative =
    props.role == null &&
    props["aria-label"] == null &&
    props["aria-labelledby"] == null &&
    props["aria-describedby"] == null &&
    props["aria-busy"] == null

  return (
    <div
      role={isDecorative ? "presentation" : undefined}
      aria-hidden={isDecorative ? true : undefined}
      className={cn(
        // ----- LAYOUT (unchanged) -----
        "relative overflow-hidden rounded-md",

        // ----- PROFILE‑STYLE BACKGROUND & BORDER (dark transparent + cyan‑tinted border) -----
        "bg-[rgba(20,50,80,0.3)] border border-[rgba(160,220,255,0.15)]",

        // ----- PULSE ONLY (no shimmer movement) -----
        "animate-pulse motion-reduce:animate-none",

        // Preserve custom classes
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }