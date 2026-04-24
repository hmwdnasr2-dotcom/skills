import { CommandLog } from './ui/CommandLog';

const USER_ID = import.meta.env.VITE_USER_ID ?? 'dev-user-1';
const API_BASE = 'http://188.245.242.236:4000';

export function App() {
  return <CommandLog userId={USER_ID} apiBase={API_BASE} />;
}
