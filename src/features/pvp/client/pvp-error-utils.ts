"use client";

import { useEffect, useRef } from "react";

import { useAlert } from "@/contexts/alert-context";

const GENERIC_PVP_ERROR_MESSAGE = "We couldn't complete the PvP action right now. Please try again.";

export function toSafePvpErrorMessage(error: string | null | undefined) {
  const raw = error?.trim();
  if (!raw) return null;

  const normalized = raw.toLowerCase();

  if (
    normalized.includes("failed to get token") ||
    normalized.includes("missing next_public_pvp_ws_url") ||
    normalized.includes("ws-token")
  ) {
    return "We couldn't connect you to the PvP server right now. Please try again in a moment.";
  }

  if (
    normalized.includes("websocket error") ||
    normalized.includes("secure websocket required") ||
    normalized.includes("origin not allowed") ||
    normalized.includes("connection")
  ) {
    return "The PvP connection was interrupted. Please refresh and try again.";
  }

  if (normalized.includes("unauthenticated") || normalized.includes("unauthorized")) {
    return "Your session has expired. Please sign in again and retry.";
  }

  if (normalized.includes("too many")) {
    return "Too many PvP requests were sent. Please wait a moment and try again.";
  }

  if (normalized.includes("match not found") || normalized.includes("unknown match")) {
    return "This match is no longer available. Please return to the lobby and start again.";
  }

  if (normalized.includes("already open in another tab")) {
    return "This match is already active in another tab. Please continue there or close the other tab first.";
  }

  if (normalized.includes("not a participant") || normalized.includes("not joined")) {
    return "You are not currently joined to this match. Please return to the lobby and try again.";
  }

  if (normalized.includes("reconnect is not allowed") || normalized.includes("match not finished")) {
    return "This match can no longer be resumed. Please start a new one.";
  }

  if (normalized.includes("room") && normalized.includes("not")) {
    return "We couldn't complete the room action. Please verify the room and try again.";
  }

  return GENERIC_PVP_ERROR_MESSAGE;
}

export function usePvpErrorAlert(error: string | null, durationMs = 6000) {
  const { showAlert } = useAlert();
  const lastErrorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!error) {
      lastErrorRef.current = null;
      return;
    }

    if (lastErrorRef.current === error) {
      return;
    }

    lastErrorRef.current = error;
    showAlert(error, "error", { durationMs });
  }, [durationMs, error, showAlert]);
}