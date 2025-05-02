// src/contexts/alert-context.tsx
"use client";

import { createContext, useState, useCallback, useContext } from "react";

export const AlertContext = createContext<{
  alert: { message: string; type: "success" | "error" } | null;
  showAlert: (message: string, type: "success" | "error") => void;
}>({
  alert: null,
  showAlert: () => {},
  
});

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const [alert, setAlert] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const showAlert = useCallback(
    (message: string, type: "success" | "error") => {
      setAlert({ message, type });
      setTimeout(() => setAlert(null), 5000); 
    },
    []
  );

  return (
    <AlertContext.Provider value={{ alert, showAlert }}>
      {children}
    </AlertContext.Provider>
  );
}

export const useAlert = () => useContext(AlertContext);