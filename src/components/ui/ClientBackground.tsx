"use client";

import { usePathname } from "next/navigation";
import Background from "@/components/ui/Background";
import { BackgroundGradientAnimation } from "@/components/ui/background-gradient-animation";

export default function ClientBackground() {
  const pathname = usePathname();

  if (pathname === "/") {
    return <BackgroundGradientAnimation className="fixed inset-0 pointer-events-none -z-10" />;
  } else {
    return <Background className="fixed inset-0 pointer-events-none -z-10" />;
  }
}
