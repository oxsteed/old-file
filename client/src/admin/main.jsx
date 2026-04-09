import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthProvider }  from '../context/AuthContext';
import { ThemeProvider } from '../context/ThemeContext';
import AdminApp from './AdminApp';
import '../index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <AdminApp />
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);
