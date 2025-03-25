import { useState, useRef, useEffect } from 'react';

export function useIdleDetection(idleTimeout: number = 4000) {
  const [isIdle, setIsIdle] = useState<boolean>(false);
  const idleTimer = useRef<NodeJS.Timeout | null>(null);

  const resetIdleTimer = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      setIsIdle(true);
    }, idleTimeout);
    setIsIdle(false);
  };

  useEffect(() => {
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, []);

  return { isIdle, resetIdleTimer };
}