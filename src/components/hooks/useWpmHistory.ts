import { useState, useEffect } from 'react';

export function useWpmHistory() {
  const [wpmHistory, setWpmHistory] = useState<{ 
    time: number; 
    wpm: number; 
    prevWpm: number 
  }[][]>(() => {
    // Check if window is defined (client-side)
    if (typeof window === 'undefined') {
      return [];
    }
    const savedHistory = localStorage.getItem('wpmHistory');
    return savedHistory ? JSON.parse(savedHistory).slice(-2) : [];
  });

  const [tempSession, setTempSession] = useState<{ 
    time: number; 
    wpm: number; 
    prevWpm: number 
  }[]>([]);
 
  useEffect(() => {
    localStorage.setItem('wpmHistory', JSON.stringify(wpmHistory.slice(-2)));
  }, [wpmHistory]);

  // Rest of the code remains the same
  const startNewSession = () => {
    setTempSession([]); 
  };

  const addTempPoints = (points: { time: number; wpm: number; prevWpm: number }[]) => {
    setTempSession(prev => [...prev, ...points]);
  };

  const commitSession = () => {
    if (tempSession.length > 0) {
      setWpmHistory(prev => {
        const newHistory = [...prev, tempSession];
        return newHistory.slice(-2);
      });
      setTempSession([]);
    }
  };

  return { 
    wpmHistory, 
    startNewSession, 
    addTempPoints, 
    commitSession, 
  };
}