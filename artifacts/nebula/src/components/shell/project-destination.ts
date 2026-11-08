import { isServerMode } from '@nebula/local';

// Keep the route and the investor/browser-only catalog compatible.
export const projectDestination = (role?: string) => isServerMode() && role !== 'investor' ? 'Home' : 'Explore';
