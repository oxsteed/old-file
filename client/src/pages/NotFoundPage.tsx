import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

export default function NotFoundPage() {
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <Navbar />
      <main className="flex-1 flex items-center justify-center px-5">
        <div style={styles.card}>
          <div style={styles.code}>404</div>
          <h1 style={styles.title}>Page Not Found</h1>
          <p style={styles.message}>
            The page you're looking for doesn't exist or has been moved.
          </p>
          <div style={styles.actions}>
            <Link to="/" style={styles.homeBtn}>
              Go to Homepage
            </Link>
            <button
              onClick={() => window.history.back()}
              style={styles.backBtn}
            >
              Go Back
            </button>
          </div>
          <p style={styles.help}>
            Need help?{' '}
            <a href="mailto:support@oxsteed.com" style={styles.link}>
              support@oxsteed.com
            </a>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    maxWidth: 480,
    width: '100%',
    textAlign: 'center',
  },
  code: {
    fontSize: 120,
    fontWeight: 800,
    color: '#f97316',
    lineHeight: 1,
    marginBottom: 8,
  },
  title: {
    color: '#e5e7eb',
    fontSize: 24,
    fontWeight: 600,
    marginBottom: 12,
  },
  message: {
    color: '#9ca3af',
    fontSize: 15,
    lineHeight: 1.6,
    marginBottom: 32,
  },
  actions: {
    display: 'flex',
    gap: 12,
    justifyContent: 'center',
    marginBottom: 24,
  },
  homeBtn: {
    background: '#f97316',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '12px 28px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    textDecoration: 'none',
  },
  backBtn: {
    background: 'transparent',
    color: '#f97316',
    border: '1px solid #f97316',
    borderRadius: 8,
    padding: '12px 28px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  help: { color: '#6b7280', fontSize: 12 },
  link: { color: '#f97316', textDecoration: 'underline' },
};
