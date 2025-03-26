import { useState, useEffect } from 'react';

export function useWpmHistory() {
  // تهيئة wpmHistory مع استرجاع البيانات من localStorage إذا كانت موجودة
  const [wpmHistory, setWpmHistory] = useState<{ 
    time: number; 
    wpm: number; 
    prevWpm: number 
  }[][]>(() => {
    const savedHistory = localStorage.getItem('wpmHistory');
    return savedHistory ? JSON.parse(savedHistory) : [];
  });
  
  const [errorTimes, setErrorTimes] = useState<number[]>([]);

  useEffect(() => {
    localStorage.setItem('wpmHistory', JSON.stringify(wpmHistory));
  }, [wpmHistory]);

  const startNewSession = () => {
    setWpmHistory(prev => [prev.slice(-1)[0] || [], []]);
  };
  
  const addWpmPoint = (time: number, wpm: number, prevWpm: number) => {
    setWpmHistory(prev => {
      if (prev.length === 0) {
        return [[{ time, wpm, prevWpm }]];
      }
      const lastSession = prev[prev.length - 1];
      return [...prev.slice(0, -1), [...lastSession, { time, wpm, prevWpm }]];
    });
  };

  const recordError = (time: number) => {
    setErrorTimes(prev => [...prev, time]);
  };

  const resetHistory = () => {
    setWpmHistory([]);
    setErrorTimes([]);
    // localStorage.removeItem('wpmHistory'); // إزالة البيانات من localStorage
  };

  return { wpmHistory, errorTimes, startNewSession, addWpmPoint, recordError, resetHistory };
}