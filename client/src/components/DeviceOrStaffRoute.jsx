import { Navigate, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Kitchen route guard (Track B): a paired display needs no staff login.
// Renders children when a staff user is signed in, OR when this restaurant
// has a stored display pairing token (same key as DisplayPairingCode).
// Otherwise redirects to sign-in, like ProtectedRoute.
const tokenKey = (restaurantId) => `oxsteed:display:token:${restaurantId}`;

function hasDisplayToken(restaurantId) {
  try {
    return Boolean(restaurantId && localStorage.getItem(tokenKey(restaurantId)));
  } catch (_) {
    return false;
  }
}

export default function DeviceOrStaffRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const { restaurantId } = useParams();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (user || hasDisplayToken(restaurantId)) {
    return children;
  }

  return <Navigate to="/login" state={{ from: location }} replace />;
}
