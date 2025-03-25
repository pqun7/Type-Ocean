import { useState, useEffect } from 'react';

type WpmPoint = { time: number; wpm: number; prevWpm: number };
type StoredData = { wpmHistory: WpmPoint[]; errorTimes: number[] };

export function useWpmHistory() {
  const [wpmHistory, setWpmHistory] = useState<WpmPoint[]>([]);
  const [errorTimes, setErrorTimes] = useState<number[]>([]);

  // تحميل البيانات عند التهيئة
  useEffect(() => {
    const savedData = localStorage.getItem('typingStats');
    if (savedData) {
      try {
        const parsedData: StoredData = JSON.parse(savedData);
        setWpmHistory(parsedData.wpmHistory?.slice(-2) || []);
        setErrorTimes(parsedData.errorTimes || []);
      } catch (error) {
        console.error('Error loading data:', error);
      }
    }
  }, []);

  // حفظ البيانات عند التحديث
  useEffect(() => {
    const dataToSave: StoredData = {
      wpmHistory: wpmHistory.slice(-2), // حفظ آخر قيمتين فقط
      errorTimes: errorTimes
    };
    localStorage.setItem('typingStats', JSON.stringify(dataToSave));
  }, [wpmHistory, errorTimes]);

  const addWpmPoint = (time: number, wpm: number, prevWpm: number) => {
    setWpmHistory(prev => [...prev.slice(-1), { time, wpm, prevWpm }]);
  };

  const resetHistory = () => {
    setWpmHistory([]);
    setErrorTimes([]);
  };

  return { wpmHistory, errorTimes, addWpmPoint, resetHistory };
}