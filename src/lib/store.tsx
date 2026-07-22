'use client';
// Picks the store backend at mount time: the Supabase-backed adapter when the
// app is configured against a real project, the localStorage demo store
// otherwise. Both implement the identical StoreApi contract (store-context.tsx)
// so every consuming page is agnostic to which one is mounted.
import React from 'react';
import { authEnabled } from './supabase';
import { DemoStoreProvider } from './store-demo';
import { SupabaseStoreProvider } from './store-supabase';

export { useStore } from './store-context';

export function StoreProvider({ children }: { children: React.ReactNode }) {
  return authEnabled
    ? <SupabaseStoreProvider>{children}</SupabaseStoreProvider>
    : <DemoStoreProvider>{children}</DemoStoreProvider>;
}
