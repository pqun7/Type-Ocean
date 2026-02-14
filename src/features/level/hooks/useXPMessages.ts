
// useXpMessages.ts
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { XPMessage, XPMessageType } from "../types/level";
import { XP_MESSAGE_TIMEOUT } from "../constants/level";
import { v4 as uuidv4 } from "uuid";

/**
 * Manages XP notification messages with automatic expiration
 * @returns Message queue and control methods
 */
export const useXPMessages = () => {
  // Message queue state
  const [xpMessages, setXPMessages] = useState<XPMessage[]>([]);
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const MAX_XP_MESSAGES = 4;

  // Cleanup timers on unmount
  useEffect(() => {
    const timeouts = timeoutsRef.current;
    return () => {
      for (const timeout of timeouts.values()) clearTimeout(timeout);
      timeouts.clear();
    };
  }, []);

  /**
   * Adds new XP message with auto-removal timer
   * @param text - Display text
   * @param value - XP amount
   * @param type - Message category
   */
  const addXPMessage = useCallback(
    (text: string, value: number, type: XPMessageType) => {
      if (value <= 0) return;

      const message: XPMessage = {
        id: uuidv4(),
        text,
        value,
        type,
      };

      setXPMessages((prev) => {
        const next = [message, ...prev];
        if (next.length <= MAX_XP_MESSAGES) return next;

        for (const removed of next.slice(MAX_XP_MESSAGES)) {
          const timeout = timeoutsRef.current.get(removed.id);
          if (timeout) clearTimeout(timeout);
          timeoutsRef.current.delete(removed.id);
        }

        return next.slice(0, MAX_XP_MESSAGES);
      });

      // Configure automatic message expiration
      const timeoutId = setTimeout(() => {
        setXPMessages((prev) => prev.filter((m) => m.id !== message.id));
        timeoutsRef.current.delete(message.id);
      }, XP_MESSAGE_TIMEOUT[type.toUpperCase() as keyof typeof XP_MESSAGE_TIMEOUT] || XP_MESSAGE_TIMEOUT.BASE);

      timeoutsRef.current.set(message.id, timeoutId);
    },
    []
  );

  // Manual message removal
  const clearMessage = useCallback((messageId: string) => {
    setXPMessages((prev) => prev.filter((m) => m.id !== messageId));
    const timeout = timeoutsRef.current.get(messageId);
    if (timeout) clearTimeout(timeout);
    timeoutsRef.current.delete(messageId);
  }, []);

  return {
    xpMessages,
    addXPMessage,
    clearMessage,
    clearAllMessages: useCallback(() => {
      for (const timeout of timeoutsRef.current.values()) clearTimeout(timeout);
      timeoutsRef.current.clear();
      setXPMessages([]);
    }, [])
  };
};