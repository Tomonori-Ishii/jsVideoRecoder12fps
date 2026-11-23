import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// StrictMode は使わない（録画の制御を 1 回だけ行うため）
createRoot(document.getElementById('root')).render(<App />);
