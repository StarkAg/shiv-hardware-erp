import { ConvexReactClient } from 'convex/react';

const url = import.meta.env.VITE_CONVEX_URL;
if (!url) throw new Error('Missing VITE_CONVEX_URL. Run `npx convex dev` once to create it.');

export const convex = new ConvexReactClient(url);
