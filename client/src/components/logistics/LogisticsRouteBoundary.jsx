import { useAuth } from '../../context/AuthContext';
import { useLocation } from 'react-router-dom';
import ErrorBoundary from '../ErrorBoundary';
// Dispose page state and in-flight read callbacks when its account or record
// changes. List filters keep the same instance so typing retains focus.
export default function LogisticsRouteBoundary({ children }) {
    const { user } = useAuth();
    const location = useLocation();
    const key = location.pathname.startsWith('/logistics')
        ? `${user?.id || 'guest'}:${user?.default_mode || ''}:${location.pathname}:${location.pathname === '/logistics/checkout' ? location.search : ''}` : 'route';
    return <ErrorBoundary key={key}>{children}</ErrorBoundary>;
}
