import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

// expose the store for end-to-end tests and debugging from the devtools console
import { useStore } from './state/store';
(window as any).__nxStore = useStore;
