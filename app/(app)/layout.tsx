import Sidebar from "@/components/Sidebar";
import MainContent from "@/components/MainContent";
import OnboardingGate from "@/components/OnboardingGate";
import ApprovalNotifier from "@/components/ApprovalNotifier";
import KeyboardShortcuts from "@/components/KeyboardShortcuts";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="app-shell">
        <Sidebar />
        <MainContent>{children}</MainContent>
      </div>
      <OnboardingGate />
      <ApprovalNotifier />
      <KeyboardShortcuts />
    </>
  );
}
