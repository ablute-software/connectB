'use client';
// Prompt 927 (D) — the language of the call, for whatever formats an amount: the entity's preview and test, and the applicant's form, wrap their questions in this, so every amount (a Number question, an Amount
// cell of a table, a group's entry) shows its currency the way the readers of that language expect. Without a provider an amount keeps the plain layout ("500 000 €").
import { createContext, useContext } from 'react';

const CallLanguageContext = createContext<string | null>(null);
export const CallLanguageProvider = CallLanguageContext.Provider;
export const useCallLanguage = (): string | null => useContext(CallLanguageContext);
