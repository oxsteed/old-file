import { useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

// Native disclosure controls use Tab to reach links/buttons, without a custom
// ARIA menu keyboard model. Nested disclosures dismiss from the inside out.
export function useNavDisclosure(mode) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const panelId = useId();
  const location = useLocation();
  useEffect(() => { setOpen(false); }, [location.pathname, location.search, mode]);
  useEffect(() => {
    if (!open) return undefined;
    const onOutside = event => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (event.target.closest?.('[data-nav-disclosure]') !== containerRef.current) return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('focusin', onOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onOutside);
      document.removeEventListener('focusin', onOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, containerRef, triggerRef, panelId };
}
