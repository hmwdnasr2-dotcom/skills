import { CommandLog } from './ui/CommandLog';

// In a real app, userId comes from your auth system.
// For development, use a stable test user.
const USER_ID = import.meta.env.VITE_USER_ID ?? 'dev-user-1';

export function App() {
  return <CommandLog userId={USER_ID} />;
}
