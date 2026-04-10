"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { getAvatarFallbackText, resolveAvatarUrl } from "@/features/auth/avatar";
import { cn } from "@/lib/utils";

type UserAvatarProps = {
  username?: string | null;
  avatarUrl?: string | null;
  alt?: string;
  className?: string;
  fallbackClassName?: string;
  imageClassName?: string;
  style?: CSSProperties;
  fallbackStyle?: CSSProperties;
  imageStyle?: CSSProperties;
  fallbackCharacterCount?: number;
  emptyFallback?: string;
  loading?: "eager" | "lazy";
  decorative?: boolean;
  draggable?: boolean;
  referrerPolicy?: React.ImgHTMLAttributes<HTMLImageElement>["referrerPolicy"];
};

export function UserAvatar({
  username,
  avatarUrl,
  alt,
  className,
  fallbackClassName,
  imageClassName,
  style,
  fallbackStyle,
  imageStyle,
  fallbackCharacterCount = 1,
  emptyFallback = "U",
  loading = "lazy",
  decorative = false,
  draggable = false,
  referrerPolicy = "no-referrer",
}: UserAvatarProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const resolvedAvatarUrl = useMemo(
    () => resolveAvatarUrl(avatarUrl),
    [avatarUrl],
  );

  useEffect(() => {
    setImageLoaded(false);
    setImageFailed(false);
  }, [resolvedAvatarUrl]);

  const fallbackText = useMemo(
    () =>
      getAvatarFallbackText(username, fallbackCharacterCount, emptyFallback),
    [emptyFallback, fallbackCharacterCount, username],
  );

  const showImage = Boolean(resolvedAvatarUrl) && !imageFailed;

  return (
    <div
      aria-hidden={decorative || undefined}
      className={cn("relative overflow-hidden rounded-full", className)}
      style={style}
    >
      <div
        className={cn(
          "flex h-full w-full select-none items-center justify-center",
          fallbackClassName,
        )}
        style={fallbackStyle}
      >
        {fallbackText}
      </div>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolvedAvatarUrl ?? undefined}
          alt={decorative ? "" : (alt ?? `${username ?? "User"} avatar`)}
          draggable={draggable}
          loading={loading}
          decoding="async"
          referrerPolicy={referrerPolicy}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-200",
            imageClassName,
          )}
          style={{
            opacity: imageLoaded ? 1 : 0,
            ...imageStyle,
          }}
          onLoad={() => setImageLoaded(true)}
          onError={() => {
            setImageLoaded(false);
            setImageFailed(true);
          }}
        />
      ) : null}
    </div>
  );
}