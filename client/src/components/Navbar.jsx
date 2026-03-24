import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { user, logout } = useAuth();
  return (
    <nav className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
      <Link to="/" className="text-2xl font-bold text-orange-500">OxSteed</Link>
      <div className="flex items-center gap-4">
        {user ? (
          <>
            <Link to="/dashboard" className="text-gray-300 hover:text-white transition">Dashboard</Link>
            <Link to="/settings" className="text-gray-300 hover:text-white transition">Settings</Link>
            <button onClick={logout} className="text-gray-400 hover:text-white transition">Sign Out</button>
          </>
        ) : (
          <>
            <Link to="/login" className="text-gray-300 hover:text-white transition">Sign in</Link>
            <Link to="/jobs" className="px-4 py-2 border border-orange-500 text-orange-500 rounded-lg hover:bg-orange-500 hover:text-white transition">Find Help</Link>
            <Link to="/register/helper" className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition">List Your Skills</Link>
          </>
        )}
      </div>
    </nav>
  );
}
