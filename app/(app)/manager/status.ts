/** Human-readable label for a task event type. */
export function eventLabel(type: string): string {
  switch (type) {
    case "clarification_asked":     return "❓ Clarification asked";
    case "clarification_answered":  return "💬 Clarification answered";
    case "assigned":                return "📋 Assigned";
    case "dispatched":              return "🚀 Dispatched";
    case "submitted":               return "📤 Submitted";
    case "completion_check_failed": return "🔄 Not complete yet";
    case "review_passed":           return "✅ Review passed";
    case "review_failed":           return "❌ Review failed";
    case "revision_requested":      return "✏️ Revision requested";
    case "assignment_approved":     return "🎉 Approved";
    case "task_completed":          return "✅ Task completed";
    case "task_failed":             return "💥 Task failed";
    default:                        return type;
  }
}

/** Shared status → badge mapping for the manager UI. */
export function statusBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case "clarifying":
      return { label: "Needs your answer", cls: "badge-warn" };
    case "planning":
      return { label: "Planning", cls: "badge-info" };
    case "in_progress":
      return { label: "In progress", cls: "badge-info" };
    case "reviewing":
    case "revising":
    case "reporting":
      return { label: "Working", cls: "badge-info" };
    case "done":
      return { label: "Done", cls: "badge-success" };
    case "failed":
      return { label: "Failed", cls: "badge-danger" };
    default:
      return { label: status, cls: "badge-neutral" };
  }
}

/** Status → badge for a single assignment. */
export function assignmentBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case "pending":
      return { label: "Pending", cls: "badge-neutral" };
    case "in_progress":
      return { label: "In progress", cls: "badge-info" };
    case "submitted":
      return { label: "Submitted", cls: "badge-info" };
    case "needs_revision":
      return { label: "Needs revision", cls: "badge-warn" };
    case "approved":
      return { label: "Approved", cls: "badge-success" };
    case "failed":
      return { label: "Failed", cls: "badge-danger" };
    default:
      return { label: status, cls: "badge-neutral" };
  }
}
