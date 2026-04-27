import { AgentInterface } from './ui/AgentInterface';

const USER_ID  = import.meta.env.VITE_USER_ID ?? 'dev-user-1';
const API_BASE = import.meta.env.VITE_API_URL ?? '';

export function App() {
  return <AgentInterface userId={USER_ID} apiBase={API_BASE} />;
}
