import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../ui/styles.css';
import { AdminRoot } from './AdminApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminRoot />
  </StrictMode>,
);
