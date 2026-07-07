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
