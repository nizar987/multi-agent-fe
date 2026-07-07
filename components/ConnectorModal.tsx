"use client";
import ConnectionsManager from "@/components/ConnectionsManager";

interface ConnectorModalProps {
  open: boolean;
  onClose: () => void;
}

/** Quick add/switch connections without leaving the chat. */
export default function ConnectorModal({ open, onClose }: ConnectorModalProps) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
          <h3 style={{ margin: 0 }}>Connectors</h3>
          <button className="btn btn-icon" onClick={onClose} title="Close">✕</button>
        </div>
        <p className="muted small" style={{ marginTop: 0 }}>
          Add multiple connections per type and pick which one is active. The active one is what your agents use.
        </p>
        <ConnectionsManager onChanged={() => { /* status refresh handled via event */ }} />
      </div>
    </div>
  );
}
