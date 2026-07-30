import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import './styles/global.css';
// The prototype's component layer (docs/prototypes/mobile-builder.html).
import './styles/shell.css';
import './styles/battle.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
