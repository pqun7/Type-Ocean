"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";

type AuthFormType = "login" | "signup";

interface AuthContextType {
  formType: AuthFormType;
  toggleForm: () => void;
  setFormType: (type: AuthFormType) => void;
}

const AuthContext = createContext<AuthContextType>({
  formType: "login",
  toggleForm: () => console.warn("No auth provider"),
  setFormType: () => console.warn("No auth provider"),
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // Default to login on server; read actual query on client
  const [formType, setFormType] = useState<AuthFormType>("login");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setFormType(params.get("form") === "signup" ? "signup" : "login");
  }, []);

  const handleSetForm = useCallback(
    (type: AuthFormType) => {
      setFormType(type);
      const newUrl = `${pathname}?form=${type}`;
      router.replace(newUrl);
    },
    [router, pathname]
  );

  const toggleForm = useCallback(() => {
    const newType = formType === "login" ? "signup" : "login";
    handleSetForm(newType);
  }, [formType, handleSetForm]);

  return (
    <AuthContext.Provider
      value={{
        formType,
        toggleForm,
        setFormType: handleSetForm,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};