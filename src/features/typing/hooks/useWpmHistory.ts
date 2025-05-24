// import { useState, useEffect } from 'react';

// export function useWpmHistory() {
//   const [wpmHistory, setWpmHistory] = useState<{ 
//     time: number; 
//     wpm: number; 
//     prevWpm: number 
//   }[][]>(() => {
//     // Check if window is defined (client-side)
//     if (typeof window === 'undefined') {
//       return [];
//     }
//     const savedHistory = localStorage.getItem('wpmHistory');
//     return savedHistory ? JSON.parse(savedHistory).slice(-2) : [];
//   });

//   const [tempSession, setTempSession] = useState<{ 
//     time: number; 
//     wpm: number; 
//     prevWpm: number 
//   }[]>([]);
 
//   useEffect(() => {
//     localStorage.setItem('wpmHistory', JSON.stringify(wpmHistory.slice(-2)));
//   }, [wpmHistory]);

//   // Rest of the code remains the same
//   const startNewSession = () => {
//     setTempSession([]); 
//   };

//   const addTempPoints = (points: { time: number; wpm: number; prevWpm: number }[]) => {
//     setTempSession(prev => [...prev, ...points]);
//   };

//   const commitSession = () => {
//     if (tempSession.length > 0) {
//       setWpmHistory(prev => {
//         const newHistory = [...prev, tempSession];
//         return newHistory.slice(-2);
//       });
//       setTempSession([]);
//     }
//   };

  

//   return { 
//     wpmHistory, 
//     startNewSession, 
//     addTempPoints, 
//     commitSession, 
//   };
// }


import { useState, useEffect } from 'react';

type WpmPoint = { 
  time: number; 
  wpm: number; 
  prevWpm: number;
};

type Session = WpmPoint[];
type HistoryState = {
  current: Session[];
  previous: Session[] | null;
  temp: Session;
};

export function useWpmHistory() {
  const [history, setHistory] = useState<HistoryState>(() => {
    // Initialize with fallback for SSR
    const initialHistory = typeof window !== 'undefined' 
      ? JSON.parse(localStorage.getItem('wpmHistory') || '[]').slice(-2)
      : [];

    return {
      current: initialHistory,
      previous: null,
      temp: []
    };
  });

  // Sync to localStorage with error handling
  useEffect(() => {
    try {
      localStorage.setItem('wpmHistory', JSON.stringify(history.current));
    } catch (error) {
      console.error('Failed to persist WPM history:', error);
    }
  }, [history.current]);

  const startNewSession = () => {
    setHistory(prev => ({
      ...prev,
      temp: []
    }));
  };

  const addTempPoints = (points: WpmPoint[]) => {
    setHistory(prev => ({
      ...prev,
      temp: [...prev.temp, ...points]
    }));
  };

  const commitSession = () => {
    if (history.temp.length === 0) return;

    setHistory(prev => ({
      current: [...prev.current, prev.temp].slice(-2),
      previous: prev.current,
      temp: []
    }));
  };

  const rollback = () => {
    if (!history.previous) return;

    setHistory(prev => ({
      current: prev.previous || prev.current,
      previous: null,
      temp: prev.temp
    }));
  };

  return {
    wpmHistory: history.current,
    tempSession: history.temp,
    startNewSession,
    addTempPoints,
    commitSession,
    rollback
  };
}