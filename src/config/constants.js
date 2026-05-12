export const CONSTANTS = {
    // Auto Cleanup Configuration
    CLEANUP: {
        STARTUP_DELAY_MS: 20000, // 20 seconds
        HISTORY_RETENTION_DAYS: 30,
    },

    // YouTube & Connection Configuration
    YOUTUBE: {
        VIEWER_POLL_INTERVAL_MS: 60000, // 1 minute (60 seconds) - Optimized for API quota
        DISCONNECT_DELAY_MS: 90000,     // 1.5 minutes (90 seconds)
    },

    // UI & System Limits
    UI: {
        TOAST_DURATION_MS: 2000,
        LONG_TOAST_DURATION_MS: 3000,
        ERROR_TOAST_DURATION_MS: 4000,
    },

    // Voice & Audio
    VOICE: {
        RETRY_DELAY_MS: 500,
    }
};
