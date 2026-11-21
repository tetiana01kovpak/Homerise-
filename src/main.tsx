import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';
import { useStore } from './state/store';

// Test / debugging hook (used by tests/e2e.mjs).
(window as unknown as { __homerise: typeof useStore }).__homerise = useStore;

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
