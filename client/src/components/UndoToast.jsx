/**
 * UndoToast — custom react-hot-toast content for the useUndo undo window.
 * Shows the pending action message with an Undo button that runs onUndo.
 */
export default function UndoToast({ message, undoLabel, onUndo }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-neutral-900 px-4 py-3 text-white shadow-2xl ring-1 ring-white/10">
      <span className="text-sm font-medium">{message}</span>
      <button
        type="button"
        onClick={onUndo}
        className="shrink-0 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        {undoLabel}
      </button>
    </div>
  );
}
