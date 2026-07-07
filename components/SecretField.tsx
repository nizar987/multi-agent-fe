"use client";
import { useState } from "react";

/**
 * Secret field pattern (DESIGN 2.1): always masked (last 4 chars),
 * reveal only while 👁 is held, a Delete button, and a storage-location
 * row (Keychain/DPAPI/libsecret/file).
 */
export default function SecretField({
  label, name, tail, isSet, backend, onChanged, placeholder,
}: {
  label: string;
  name: string;
  tail: string | null;
  isSet: boolean;
  backend: { label: string; secure: boolean };
  onChanged: () => void;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(!isSet);
  const [value, setValue] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!value.trim()) return;
    setSaving(true);
    await fetch("/api/settings/secret", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, value }),
    });
    setSaving(false);
    setValue("");
    setEditing(false);
    onChanged();
    window.dispatchEvent(new Event("settings-changed"));
  };

  const remove = async () => {
    if (!confirm(`Delete ${label}? Tools that use it will stop working.`)) return;
    await fetch("/api/settings/secret", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setEditing(true);
    onChanged();
    window.dispatchEvent(new Event("settings-changed"));
  };

  const reveal = async () => {
    const r = await fetch("/api/settings/secret", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, action: "reveal" }),
    }).then((r) => r.json());
    setRevealed(r.value ?? "(failed to read)");
  };

  return (
    <div className="field">
      <label>{label}</label>
      {isSet && !editing ? (
        <div className="secret-row">
          <input
            className="input"
            readOnly
            value={revealed ?? `••••••••••••${tail ?? ""}`}
          />
          <button
            className="btn"
            title="Show while held"
            onMouseDown={reveal}
            onMouseUp={() => setRevealed(null)}
            onMouseLeave={() => setRevealed(null)}
          >👁</button>
          <button className="btn" onClick={() => setEditing(true)}>Replace</button>
          <button className="btn btn-danger-ghost" onClick={remove}>Delete</button>
        </div>
      ) : (
        <div className="secret-row">
          <input
            className="input"
            type="password"
            placeholder={placeholder ?? "paste here"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <button className="btn btn-primary" onClick={save} disabled={saving || !value.trim()} data-loading={saving}>
            {saving && <span className="spinner" />} Save
          </button>
          {isSet && <button className="btn" onClick={() => { setEditing(false); setValue(""); }}>Cancel</button>}
        </div>
      )}
      <div className={`secret-store-note${backend.secure ? "" : " warn"}`}>
        {backend.secure ? "✓" : "⚠"} Stored {backend.secure ? "securely" : ""} in {backend.label}
      </div>
    </div>
  );
}
