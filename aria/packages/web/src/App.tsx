import { CommandLog } from './ui/CommandLog';

const USER_ID = import.meta.env.VITE_USER_ID ?? 'dev-user-1';

// On localhost Vite proxies /api → :4000 so apiBase stays empty.
// From any other host (phone, external IP) we call the backend directly.
const { hostname } = window.location;
const API_BASE =
  hostname === 'localhost' || hostname === '127.0.0.1'
    ? ''
    : `http://${hostname}:4000`;

export function App() {
  return <CommandLog userId={USER_ID} apiBase={API_BASE} />;
}
