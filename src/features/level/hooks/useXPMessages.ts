
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
  const timeoutsRef = useRef<Record<string, NodeJS.Timeout>>({});

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      Object.values(timeoutsRef.current).forEach(clearTimeout);
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

      setXPMessages((prev) => [...prev, message]);

      // Configure automatic message expiration
      const timeoutId = setTimeout(() => {
        setXPMessages((prev) => prev.filter((m) => m.id !== message.id));
        delete timeoutsRef.current[message.id];
      }, XP_MESSAGE_TIMEOUT[type.toUpperCase() as keyof typeof XP_MESSAGE_TIMEOUT] || XP_MESSAGE_TIMEOUT.BASE);

      timeoutsRef.current[message.id] = timeoutId;
    },
    []
  );

  // Manual message removal
  const clearMessage = useCallback((messageId: string) => {
    setXPMessages((prev) => prev.filter((m) => m.id !== messageId));
    if (timeoutsRef.current[messageId]) {
      clearTimeout(timeoutsRef.current[messageId]);
      delete timeoutsRef.current[messageId];
    }
  }, []);

  return {
    xpMessages,
    addXPMessage,
    clearMessage,
    clearAllMessages: useCallback(() => setXPMessages([]), [])
  };
};