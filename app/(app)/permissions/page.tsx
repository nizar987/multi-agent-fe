"use client";
import AllowlistManager from "@/components/AllowlistManager";
import PageHeader from "@/components/PageHeader";

export default function PermissionsPage() {
  return (
    <div className="page-narrow">
      <PageHeader
        title="Permissions"
        subtitle={
          <>
            Actions on this list run <strong>without asking for approval</strong>. Entries are added when you
            pick “Always allow” on an approval card, or manually below. Matching is exact.
          </>
        }
      />
      <AllowlistManager />
    </div>
  );
}
