"use client";

import { useEffect, useRef } from "react";

import { useAlert } from "@/contexts/alert-context";
import { PVP_ERROR_CODES, isPvpErrorCode, type PvpErrorPayload } from "@/features/pvp/shared/error-codes";

const GENERIC_PVP_ERROR_MESSAGE = "We couldn't complete the PvP action right now. Please try again.";

function normalizeRawError(error: string | PvpErrorPayload | null | undefined): PvpErrorPayload | null {
  if (!error) return null;

  if (typeof error === "string") {
    const raw = error.trim();
    return raw
      ? {
          message: raw,
          code: undefined,
          retryable: undefined,
          details: undefined,
        }
      : null;
  }

  const message = error.message?.trim();
  if (!message) return null;

  return {
    ...error,
    message,
    code: isPvpErrorCode(error.code) ? error.code : undefined,
  };
}

export function toSafePvpErrorMessage(error: string | PvpErrorPayload | null | undefined) {
  const normalizedError = normalizeRawError(error);
  if (!normalizedError) return null;

  if (normalizedError.code === PVP_ERROR_CODES.QUEUE_SOCKET_NOT_READY) {
    return "The ranked queue is still connecting. Wait a moment and try again.";
  }

  if (normalizedError.code === PVP_ERROR_CODES.QUEUE_CONNECTION_CLOSED) {
    return "The PvP connection was interrupted. Please refresh and try again.";
  }

  if (normalizedError.code === PVP_ERROR_CODES.QUEUE_GATEWAY_DRAINING) {
    return "Ranked matchmaking is restarting. Please retry in a moment.";
  }

  if (normalizedError.code === PVP_ERROR_CODES.QUEUE_USER_UNAVAILABLE) {
    return "Your PvP session is no longer available. Refresh and rejoin the queue.";
  }

  if (normalizedError.code === PVP_ERROR_CODES.QUEUE_ALREADY_SEARCHING) {
    return "You are already in the ranked queue. Wait for matchmaking or cancel the current search first.";
  }

  if (
    normalizedError.code === PVP_ERROR_CODES.QUEUE_MATCH_CREATION_FAILED ||
    normalizedError.code === PVP_ERROR_CODES.QUEUE_AI_FALLBACK_FAILED
  ) {
    return "Matchmaking hit a server issue. Please retry in a moment.";
  }

  const raw = normalizedError.message;

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

  if (normalized.includes("room expired")) {
    return "This room expired from inactivity. Refresh or create a new room to continue.";
  }

  if (normalized.includes("host only")) {
    return "Only the current room host can do that. Wait for host transfer or ask the host to continue.";
  }

  if (normalized.includes("kicked from room")) {
    return "You were removed from the room by the host. Rejoin with a new invite if needed.";
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
