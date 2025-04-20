"use client";

import { createContext, useContext, useState } from "react";

type AuthContextType = {
  isLogin: boolean;
  toggleForm: (newState: boolean) => void;
};

const AuthContext = createContext<AuthContextType>({
  isLogin: true,
  toggleForm: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLogin, setIsLogin] = useState(true);
  
  const toggleForm = (newState: boolean) => {
    setIsLogin(newState);
  };

  return (
    <AuthContext.Provider value={{ isLogin, toggleForm }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);