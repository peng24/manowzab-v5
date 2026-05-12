import { db } from "../services/firebase";
import { ref as dbRef, push } from "firebase/database";

const isDev = import.meta.env.MODE === 'development';

export const logger = {
  log: (...args) => {
    if (isDev) console.log('%c[LOG]', 'color: #3498db; font-weight: bold;', ...args);
  },
  
  warn: (...args) => {
    console.warn('%c[WARN]', 'color: #f39c12; font-weight: bold;', ...args);
  },

  error: async (err, context = {}) => {
    console.error('%c[ERROR]', 'color: #e74c3c; font-weight: bold;', err, context);
    
    // Sync critical errors to Firebase for remote monitoring
    try {
      const errorLogRef = dbRef(db, "system/remote_logs");
      await push(errorLogRef, {
        timestamp: Date.now(),
        message: err.message || String(err),
        stack: err.stack || null,
        context: context,
        userAgent: navigator.userAgent,
        deviceId: localStorage.getItem("device_id") || "unknown"
      });
    } catch (e) {
      console.warn("Failed to sync error to Firebase", e);
    }
  },

  debug: (...args) => {
    if (isDev) console.debug('%c[DEBUG]', 'color: #9b59b6; font-weight: bold;', ...args);
  },

  system: (msg) => {
    console.log(`%c🚀 [SYSTEM] ${msg}`, 'color: #00e676; font-weight: bold; font-size: 12px;');
  }
};
