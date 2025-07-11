if (!window.RELY_CONFIG) {
    const CONFIG = {
        ENV: 'development',
        DEFAULT_KEY: 'bbc54f4570b95072dad46029b762b984ec4204b56645ed4aca67e2cf68e9e741', // Change this in the UI
        PRODUCTION_KEY: 'your_production_key_here_256_bit_hex',
        SETTINGS: {
            ENCRYPTION_MARKER: '[ENCRYPTED]',
            AUTO_ENCRYPT: true,
            AUTO_DECRYPT: true,
            PRESERVE_MEET_LINKS: true,
            SHOW_NOTIFICATIONS: true,
            DEBUG_ENABLED: true,
            MAX_EMAIL_SIZE: 50000
        },
        MEET_PATTERNS: [
            /https:\/\/meet\.google\.com\/[a-z0-9-]+/gi,
            /https:\/\/[a-z0-9-]+\.meet\.google\.com\/[a-z0-9-]+/gi
        ],
        STORAGE_KEYS: {
            ENCRYPTION_KEY: 'rely_encryption_key',
            SETTINGS: 'rely_settings',
            STATS: 'rely_stats'
        },
        getCurrentKey: function() {
            return this.ENV === 'production' ? this.PRODUCTION_KEY : this.DEFAULT_KEY;
        },
        validateKey: function(key) {
            return key && typeof key === 'string' && /^[0-9a-fA-F]{64}$/.test(key);
        }
    };
    window.RELY_CONFIG = CONFIG;
}
