// Keep keyboard navigation inside the currently open Media dialog, including
// controls rendered later by a lazy legal page or a successful form response.
export function trapMediaDialogFocus(event, dialog) {
  if (event.key !== 'Tab' || !dialog) return;
  const controls = [...dialog.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
    .filter(control => !control.hidden && control.getClientRects().length > 0 && control.getAttribute('aria-hidden') !== 'true');
  const first = controls[0];
  const last = controls.at(-1);
  if (!first) { event.preventDefault(); dialog.focus(); return; }
  if (!dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
    event.preventDefault(); (event.shiftKey ? last : first).focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first.focus();
  }
}
