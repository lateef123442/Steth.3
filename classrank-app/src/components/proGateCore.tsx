import React, { createContext, useContext } from "react";

/** Whether this student is locked out of features (no active Pro) and a way to ask them to subscribe / enter a code. */
export interface ProGate { locked: boolean; prompt: () => void }
export const ProGateContext = createContext<ProGate>({ locked: false, prompt: () => {} });
export const useProGate = () => useContext(ProGateContext);

/** Everything inside stays usable without Pro (Profile, Help & feedback, the payment screens). */
export function ProGateExempt({ children }: { children: React.ReactNode }) {
  const g = useProGate();
  return <ProGateContext.Provider value={{ ...g, locked: false }}>{children}</ProGateContext.Provider>;
}
