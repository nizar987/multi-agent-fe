"use client";
import ConnectionsManager from "@/components/ConnectionsManager";
import PageHeader from "@/components/PageHeader";

export default function MonitoringPage() {
  return (
    <div className="page-narrow">
      <PageHeader
        title="Monitoring"
        subtitle={
          <>
            Connect Grafana, Prometheus and Loki. Agents with the <strong>Monitoring</strong> tool
            enabled can then query metrics (PromQL), search logs (LogQL) and use Grafana
            (dashboards, datasources, alerts) via the official <code>mcp-grafana</code> server.
            Prometheus/Loki tools are read-only direct API calls.
          </>
        }
      />
      <div className="callout-info mb-4">
        Grafana requires the <code>mcp-grafana</code> binary:{" "}
        <code>go install github.com/grafana/mcp-grafana/cmd/mcp-grafana@latest</code> — or set
        its full path on the connection if it is not on PATH.
      </div>
      <ConnectionsManager kinds={["grafana", "prometheus", "loki"]} />
    </div>
  );
}
