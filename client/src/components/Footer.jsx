import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="border-t border-gray-800 bg-gray-950 text-gray-400 px-6 py-10">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-wrap justify-between items-start mb-6">
          <div>
            <p>&copy; {new Date().getFullYear()} OxSteed LLC &middot; support@oxsteed.com</p>
          </div>
          <div className="flex gap-4 flex-wrap">
            <Link to="/login" className="hover:text-white transition">Sign In</Link>
            <Link to="/jobs" className="hover:text-white transition">Find Help</Link>
            <Link to="/register/helper" className="hover:text-white transition">List Your Skills</Link>
            <Link to="/about" className="hover:text-white transition">About</Link>
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-sm mb-6">
          <Link to="/terms" className="hover:text-white transition">Terms of Service</Link>
          <Link to="/privacy" className="hover:text-white transition">Privacy Policy</Link>
          <Link to="/security" className="hover:text-white transition">Security</Link>
          <Link to="/cookie-policy" className="hover:text-white transition">Cookie Policy</Link>
          <Link to="/do-not-sell" className="hover:text-white transition">Do Not Sell My Info</Link>
          <Link to="/accessibility" className="hover:text-white transition">Accessibility</Link>
        </div>
      </div>
    </footer>
  );
}
