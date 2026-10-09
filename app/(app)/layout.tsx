import Sidebar from "@/components/Sidebar";
import OnboardingGate from "@/components/OnboardingGate";
import ApprovalNotifier from "@/components/ApprovalNotifier";
import KeyboardShortcuts from "@/components/KeyboardShortcuts";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="app-shell">
        <Sidebar />
        <main className="main-content" id="main-content">{children}</main>
      </div>
      <OnboardingGate />
      <ApprovalNotifier />
      <KeyboardShortcuts />
    </>
  );
}
