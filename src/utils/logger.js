const isDev = import.meta.env.DEV;

export const logger = {
  log: (...args) => {
    if (isDev) console.log('%c[LOG]', 'color: #3498db; font-weight: bold;', ...args);
  },
  info: (...args) => {
    if (isDev) console.info('%c[INFO]', 'color: #2ecc71; font-weight: bold;', ...args);
  },
  warn: (...args) => {
    if (isDev) console.warn('%c[WARN]', 'color: #f39c12; font-weight: bold;', ...args);
  },
  error: (...args) => {
    // Errors should always show even in production to track issues
    console.error('%c[ERROR]', 'color: #e74c3c; font-weight: bold;', ...args);
  },
  debug: (...args) => {
    if (isDev) console.debug('%c[DEBUG]', 'color: #9b59b6; font-weight: bold;', ...args);
  },
  system: (msg) => {
    // System boot messages - always visible but styled nicely
    console.log(`%c🚀 [SYSTEM] ${msg}`, 'color: #00e676; font-weight: bold; font-size: 12px;');
  }
};
