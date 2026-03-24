import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthProvider } from '../context/AuthContext';
import AdminApp from './AdminApp';
import '../index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <AdminApp />
    </AuthProvider>
  </React.StrictMode>
);
