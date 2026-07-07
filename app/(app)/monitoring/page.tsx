"use client";
import ConnectionsManager from "@/components/ConnectionsManager";

export default function MonitoringPage() {
  return (
    <div style={{ maxWidth: 720 }}>
      <h1>Monitoring</h1>
      <p className="muted" style={{ marginTop: 4 }}>
        Connect Grafana, Prometheus and Loki. Agents with the <strong>Monitoring</strong> tool
        enabled can then query metrics (PromQL), search logs (LogQL) and use Grafana
        (dashboards, datasources, alerts) via the official <code>mcp-grafana</code> server.
        Prometheus/Loki tools are read-only direct API calls.
      </p>
      <p className="muted small">
        Grafana requires the <code>mcp-grafana</code> binary:&nbsp;
        <code>go install github.com/grafana/mcp-grafana/cmd/mcp-grafana@latest</code> — or set
        its full path on the connection if it is not on PATH.
      </p>
      <ConnectionsManager kinds={["grafana", "prometheus", "loki"]} />
    </div>
  );
}
