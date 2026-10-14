import { createContext, useCallback, useContext, useState } from 'react';

// Tracks whether the currently open attention workflow has unsaved edits.
// Workflows rendered inside the attention modal call useDirtyForm().setDirty
// as the user types/selects; the modal confirms before Close/Back/task-change
// when dirty. Nothing is ever auto-saved: discarding is explicit.
const DirtyFormContext = createContext({
  isDirty: false,
  setDirty: () => {},
  clearDirty: () => {},
});

export function DirtyFormProvider({ children }) {
  const [isDirty, setIsDirty] = useState(false);
  const setDirty = useCallback((dirty) => setIsDirty(Boolean(dirty)), []);
  const clearDirty = useCallback(() => setIsDirty(false), []);
  return (
    <DirtyFormContext.Provider value={{ isDirty, setDirty, clearDirty }}>
      {children}
    </DirtyFormContext.Provider>
  );
}

export function useDirtyForm() {
  return useContext(DirtyFormContext);
}
