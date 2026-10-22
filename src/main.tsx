import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// UI fonts are bundled so the desktop app looks the same offline
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';
import { installErrorReporting } from './state/errors';
import { preloadWorkers } from './workers';
import { ErrorBoundary } from './ui/ErrorBoundary';

installErrorReporting();
createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>);
// keep this version's worker scripts in memory so a redeploy of the web app cannot break this tab
preloadWorkers();

// expose the store for end-to-end tests and debugging from the devtools console
import { useStore } from './state/store';
(window as any).__nxStore = useStore;
