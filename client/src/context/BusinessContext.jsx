import { createContext, useContext, useMemo } from 'react';

const BusinessContext = createContext(null);

export function BusinessProvider({ children, currentBusinessId, businessName, businessRole }) {
  const value = useMemo(() => ({
    businessId: currentBusinessId,
    businessName,
    businessRole,
  }), [currentBusinessId, businessName, businessRole]);

  return (
    <BusinessContext.Provider value={value}>
      {children}
    </BusinessContext.Provider>
  );
}

export function useBusinessContext() {
  const context = useContext(BusinessContext);
  if (!context) {
    return { businessId: null, businessName: null, businessRole: null };
  }
  return context;
}
