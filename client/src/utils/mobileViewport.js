export function observeMobileViewport(win = window, doc = document) {
  const viewport = win.visualViewport,
    root = doc.documentElement;
  let frame;
  const update = () => {
    const height = viewport?.height || win.innerHeight;
    const editable = doc.activeElement?.matches?.(
      'input,textarea,select,[contenteditable="true"]',
    );
    const delta =
      editable && (!viewport || viewport.scale === 1)
        ? win.innerHeight - height - (viewport?.offsetTop || 0)
        : 0;
    const inset = delta > 120 ? Math.round(delta) : 0;
    root.style.setProperty('--pwa-viewport-height', `${Math.round(height)}px`);
    root.style.setProperty('--pwa-keyboard-inset', `${inset}px`);
    root.classList.toggle('pwa-keyboard-open', inset > 0);
    if (inset && editable) {
      const rect = doc.activeElement.getBoundingClientRect();
      if (
        rect.bottom > height + (viewport?.offsetTop || 0) - 32 ||
        rect.top < (viewport?.offsetTop || 0)
      )
        doc.activeElement.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
  };
  const schedule = () => {
    win.cancelAnimationFrame(frame);
    frame = win.requestAnimationFrame(update);
  };
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  win.addEventListener('resize', schedule);
  doc.addEventListener('focusin', schedule);
  doc.addEventListener('focusout', schedule);
  update();
  return () => {
    win.cancelAnimationFrame(frame);
    viewport?.removeEventListener('resize', schedule);
    viewport?.removeEventListener('scroll', schedule);
    win.removeEventListener('resize', schedule);
    doc.removeEventListener('focusin', schedule);
    doc.removeEventListener('focusout', schedule);
    root.style.removeProperty('--pwa-viewport-height');
    root.style.removeProperty('--pwa-keyboard-inset');
    root.classList.remove('pwa-keyboard-open');
  };
}
