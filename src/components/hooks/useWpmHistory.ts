import { useState } from 'react';

export function useWpmHistory() {
  const [wpmHistory, setWpmHistory] = useState<{ 
    time: number; 
    wpm: number; 
    prevWpm: number 
  }[]>([]);
  
  const [errorTimes, setErrorTimes] = useState<number[]>([]);

  // تحديث الدالة لقبول 3 معاملات
  const addWpmPoint = (time: number, wpm: number, prevWpm: number) => {
    setWpmHistory(prev => [...prev, { time, wpm, prevWpm }]);
  };

  const recordError = (time: number) => {
    setErrorTimes(prev => [...prev, time]);
  };

  // تصحيح اسم الدالة إلى reset
  const resetHistory = () => {
    setWpmHistory([]);
    setErrorTimes([]);
  };

  return { wpmHistory, errorTimes, addWpmPoint, recordError, resetHistory };
}