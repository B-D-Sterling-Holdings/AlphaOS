import Navbar from "@/components/Navbar";
import CommandPalette from "@/components/CommandPalette";
import { CacheProvider } from "@/lib/CacheContext";
import AuthGate from "@/components/AuthGate";

export default function DashboardLayout({ children }) {
  return (
    <AuthGate>
      <CacheProvider>
        <div className="min-h-screen bg-white">
          <Navbar />
          <CommandPalette />
          <main className="pt-20">
            {children}
          </main>
        </div>
      </CacheProvider>
    </AuthGate>
  );
}
