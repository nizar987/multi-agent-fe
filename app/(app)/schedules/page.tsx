"use client";
import CronManager from "@/components/CronManager";
import PageHeader from "@/components/PageHeader";

export default function SchedulesPage() {
  return (
    <div className="page-narrow">
      <PageHeader
        title="Schedules"
        subtitle="Run an agent automatically on a recurring schedule."
      />
      <CronManager />
    </div>
  );
}
