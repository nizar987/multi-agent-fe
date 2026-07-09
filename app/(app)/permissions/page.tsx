"use client";
import AllowlistManager from "@/components/AllowlistManager";

export default function PermissionsPage() {
  return (
    <div>
      <h1>Permissions</h1>
      <section className="settings-section">
        <h2>Always-Allowed Actions</h2>
        <AllowlistManager />
      </section>
    </div>
  );
}
