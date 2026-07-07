/** Right-panel icon (preview toggle) — follows currentColor. */
export default function PanelIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="14.5" y1="4" x2="14.5" y2="20" />
    </svg>
  );
}
