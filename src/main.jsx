import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { SuiteProvider } from './store/SuiteContext.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <SuiteProvider>
        <App />
      </SuiteProvider>
    </HashRouter>
  </StrictMode>,
);
