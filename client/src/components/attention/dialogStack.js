// Coordinates nested dialogs inside the attention modal (e.g. a financial
// confirmation rendered by a workflow while the inbox dialog is open).
//
// The focus trap and Escape handling only apply to the topmost registered
// dialog, so an inner confirmation can capture keyboard focus without the
// outer dialog stealing it back. Background scroll stays locked until the
// last dialog unregisters.

const stack = [];
let previousOverflow = '';

function lockScroll() {
  if (typeof document === 'undefined') return;
  previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
}

function unlockScroll() {
  if (typeof document === 'undefined') return;
  document.body.style.overflow = previousOverflow;
}

export function registerDialog(id) {
  if (stack.length === 0) lockScroll();
  stack.push(id);
}

export function unregisterDialog(id) {
  const index = stack.lastIndexOf(id);
  if (index >= 0) stack.splice(index, 1);
  if (stack.length === 0) unlockScroll();
}

export function isTopDialog(id) {
  return stack.length > 0 && stack[stack.length - 1] === id;
}

export function openDialogCount() {
  return stack.length;
}
