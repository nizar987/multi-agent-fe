"use client";

import React, { useEffect, useState, useCallback } from "react";
import Icon from "@/components/Icon";

interface TaskItem {
  id: number;
  title: string;
  description: string;
  project: string;
  priority: "low" | "medium" | "high";
  due_date: string | null;
  calendar_event_id: string | null;
  completed: boolean;
  created_at: string;
  updated_at: string;
}

type ViewMode = "today" | "week" | "all";

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("today");
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [title, setTitle] = useState("");
  const [project, setProject] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [dueDate, setDueDate] = useState("");

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let url = "/api/tasks";
      if (viewMode !== "all") url = `/api/tasks?view=${viewMode}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.ok) {
        setTasks(json.data || []);
      } else {
        setError(json.error || "failed_to_load");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [viewMode]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !project.trim()) return;

    const payload: Record<string, any> = {
      title: title.trim(),
      project: project.trim(),
      priority,
      due_date: dueDate || null,
    };

    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const json = await res.json();
    if (json.ok) {
      setTitle("");
      setProject("");
      setPriority("medium");
      setDueDate("");
      setShowForm(false);
      await loadTasks();
    } else {
      setError(json.error || "failed_to_create");
    }
  };

  const handleToggle = async (id: number) => {
    const res = await fetch(`/api/tasks/${id}/toggle`, { method: "POST" });
    const json = await res.json();
    if (json.ok) {
      setTasks((prev) => prev.map((t) => (t.id === id ? json.data : t)));
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this task?")) return;
    const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.ok) {
      setTasks((prev) => prev.filter((t) => t.id !== id));
    }
  };

  const priorityColor: Record<string, string> = {
    high: "var(--error, #dc2626)",
    medium: "var(--warning, #f59e0b)",
    low: "var(--success, #16a34a)",
  };

  return (
    <div style={{ padding: 20, maxWidth: 800, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>Task Manager</h1>

      {/* View toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {(["today", "week", "all"] as ViewMode[]).map((v) => (
          <button
            key={v}
            onClick={() => setViewMode(v)}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid var(--border, #ddd)",
              background: viewMode === v ? "var(--primary, #2563eb)" : "white",
              color: viewMode === v ? "white" : "black",
              cursor: "pointer",
              fontWeight: viewMode === v ? 600 : 400,
            }}
          >
            {v === "today" ? "Hari Ini" : v === "week" ? "Minggu Ini" : "Semua"}
          </button>
        ))}
        <button
          onClick={() => setShowForm((v) => !v)}
          style={{
            marginLeft: "auto",
            padding: "6px 14px",
            borderRadius: 6,
            background: "var(--primary, #2563eb)",
            color: "white",
            border: "none",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          + Add Task
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          style={{
            border: "1px solid var(--border, #ddd)",
            borderRadius: 10,
            padding: 16,
            marginBottom: 20,
            background: "#f9fafb",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Judul task"
              style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd" }}
              required
            />
            <input
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="Project"
              style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd" }}
              required
            />
            <div style={{ display: "flex", gap: 8 }}>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
                style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd", flex: 1 }}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd", flex: 1 }}
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="submit"
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  background: "var(--primary, #2563eb)",
                  color: "white",
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 600,
                  flex: 1,
                }}
              >
                Simpan
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  background: "#e5e7eb",
                  border: "none",
                  cursor: "pointer",
                  flex: 1,
                }}
              >
                Batal
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Content */}
      {loading ? (
        <p>Memuat...</p>
      ) : error ? (
        <div>
          <p style={{ color: "red" }}>Error: {error}</p>
          <button onClick={loadTasks} style={{ marginTop: 8 }}>
            Retry
          </button>
        </div>
      ) : tasks.length === 0 ? (
        <p style={{ color: "#777" }}>Tidak ada task. Klik "Add Task" untuk membuat.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {tasks.map((task) => (
            <div
              key={task.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                padding: "10px 14px",
                background: task.completed ? "#f3f4f6" : "white",
                opacity: task.completed ? 0.7 : 1,
              }}
            >
              <button
                onClick={() => handleToggle(task.id)}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  border: task.completed ? "none" : "1.5px solid #999",
                  background: task.completed ? "var(--success, #16a34a)" : "transparent",
                  color: "white",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {task.completed ? "✓" : ""}
              </button>

              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontWeight: 600,
                    textDecoration: task.completed ? "line-through" : "none",
                  }}
                >
                  {task.title}
                </div>
                <div style={{ fontSize: 12, color: "#666", display: "flex", gap: 10, marginTop: 2 }}>
                  <span style={{ color: "var(--info)", display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="folder" size={12} /> {task.project}</span>
                  <span style={{ color: priorityColor[task.priority] }}>● {task.priority}</span>
                  {task.due_date && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="calendar" size={12} /> {task.due_date}</span>}
                </div>
              </div>

              <button
                onClick={() => handleDelete(task.id)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#dc2626",
                  cursor: "pointer",
                  display: "inline-flex",
                }}
                aria-label="Delete task"
              >
                <Icon name="trash" size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
