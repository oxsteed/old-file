import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import HelperProfileEditPage from './pages/HelperProfileEditPage';
import HelperPublicProfilePage from './pages/HelperPublicProfilePage';
import BusinessProfileEditPage from './pages/BusinessProfileEditPage';
import BusinessPublicProfilePage from './pages/BusinessPublicProfilePage';

export default function Router() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Helper Profile Routes */}
        <Route path="/dashboard/edit-profile" element={<HelperProfileEditPage />} />
        <Route path="/helpers/:helperId" element={<HelperPublicProfilePage />} />

        {/* Business Profile Routes */}
        <Route path="/business/edit-profile" element={<BusinessProfileEditPage />} />
        <Route path="/business/:businessId" element={<BusinessPublicProfilePage />} />

        {/* Default */}
        <Route path="/" element={<Navigate to="/dashboard" />} />
      </Routes>
    </BrowserRouter>
  );
}
