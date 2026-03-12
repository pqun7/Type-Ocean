import { PvpSocketProvider } from "@/features/pvp/client/usePvpSocket";

export default function PvpLayout({ children }: { children: React.ReactNode }) {
  return <PvpSocketProvider>{children}</PvpSocketProvider>;
}
