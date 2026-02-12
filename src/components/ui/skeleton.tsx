import { cn } from "@/lib/utils"

/**
 * Modern, accessible skeleton loader.
 *
 * Design goal:
 * - Match the header auth-loading placeholders (subtle slate background + border).
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

        // ----- EYE‑FRIENDLY NEUTRAL GRAYS (light + dark) -----
        "bg-slate-800/40 border border-slate-700/40",

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