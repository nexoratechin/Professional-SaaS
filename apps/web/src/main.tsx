import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfirmProvider, GlobalStyles, ToastProvider } from '@college-erp/ui';
import { App } from './App';
import { PwaProvider } from './features/pwa/pwa-context';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

createRoot(container).render(
  <React.StrictMode>
    <GlobalStyles />
    <PwaProvider>
      <ToastProvider>
        <ConfirmProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ConfirmProvider>
      </ToastProvider>
    </PwaProvider>
  </React.StrictMode>,
);
