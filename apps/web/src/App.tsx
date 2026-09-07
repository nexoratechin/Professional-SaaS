import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './features/auth/auth-context';
import { DashboardPage } from './routes/dashboard';
import { LoginPage } from './routes/login';
import { ProtectedRoute } from './routes/protected-route';

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
