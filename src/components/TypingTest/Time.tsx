'use client';
import { SlidingNumber } from '@/components/core/sliding-number';
import { useEffect, useState } from 'react';

interface TimeProps {
  gameState: 'start' | 'running' | 'end';
  onTimeUpdate?: (time: number) => void;
}

export function Time({ gameState, onTimeUpdate }: TimeProps) {
  const [totalSeconds, setTotalSeconds] = useState(0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (gameState === 'running') {
      interval = setInterval(() => {
        setTotalSeconds(prev => {
          const newTime = prev + 1;
          onTimeUpdate?.(newTime);
          return newTime;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [gameState, onTimeUpdate]);

  useEffect(() => {
    if (gameState === 'start') {
      setTotalSeconds(0);
      onTimeUpdate?.(0);
    }
  }, [gameState, onTimeUpdate]);

  return (
    <div className='flex items-center gap-0.5 font-mono'>
      <SlidingNumber value={minutes} padStart={true} />
      <span className='text-zinc-500'>:</span>
      <SlidingNumber value={seconds} padStart={true} />
    </div>
  );
}