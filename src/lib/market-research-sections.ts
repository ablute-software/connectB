// Prompt 373 §D — the 7 research sections, extracted to their own module
// (not exported from the route.ts files that use them) because Next.js
// route files may only export the handful of reserved names (GET, POST,
// config, ...) — any other export fails the build's own route type check.
export type Section = 'definition' | 'sizing' | 'growth' | 'players' | 'rounds' | 'trends' | 'regulatory';
export const SECTIONS: Section[] = ['definition', 'sizing', 'growth', 'players', 'rounds', 'trends', 'regulatory'];
