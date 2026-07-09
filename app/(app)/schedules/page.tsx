"use client";
import CronManager from "@/components/CronManager";

export default function SchedulesPage() {
  return (
    <div>
      <h1>Schedules</h1>
      <section className="settings-section">
        <CronManager />
      </section>
    </div>
  );
}
