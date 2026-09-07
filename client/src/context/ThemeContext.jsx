import { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

function readTheme() {
  try {
    const saved = localStorage.getItem('theme');
    return saved ? saved === 'dark' : true; // default dark
  } catch {
    return true; // incognito / SecurityError - fall back to dark
  }
}

function writeTheme(value) {
  try {
    localStorage.setItem('theme', value);
  } catch {
    // incognito or storage quota - silently ignore
  }
}

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(readTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
      root.setAttribute('data-theme', 'dark');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark');
      root.setAttribute('data-theme', 'light');
      root.style.colorScheme = 'light';
    }
    writeTheme(isDark ? 'dark' : 'light');
  }, [isDark]);

  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key !== 'theme' || !event.newValue) return;
      if (event.newValue === 'dark' || event.newValue === 'light') {
        setIsDark(event.newValue === 'dark');
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const toggleTheme = () => setIsDark((prev) => !prev);

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
