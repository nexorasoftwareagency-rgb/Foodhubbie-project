// === src/components/notifications/ClearAllButton.tsx ===
export function ClearAllButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-[11px] font-bold text-primary disabled:opacity-40 disabled:pointer-events-none"
    >
      Clear All
    </button>
  );
}
