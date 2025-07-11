// Configuration for RelyHealth Email Cipher Extension
// This file manages environment variables and settings

const CONFIG = {
  // Environment (development/production)
  ENV: 'development', // Change to 'production' for live use
  
  // Default encryption key (256-bit hex) - CHANGE THIS FOR PRODUCTION
  DEFAULT_KEY: 'bbc54f4570b95072dad46029b762b984ec4204b56645ed4aca67e2cf68e9e741',
  
  // Key for production environment - store securely
  PRODUCTION_KEY: 'your_production_key_here_256_bit_hex',
  
  // Extension settings
  SETTINGS: {
    // Auto-encrypt outgoing emails
    AUTO_ENCRYPT: true,
    
    // Auto-decrypt incoming emails
    AUTO_DECRYPT: true,
    
    // Show notifications for encryption/decryption
    SHOW_NOTIFICATIONS: true,
    
    // Preserve Google Meet links (don't encrypt)
    PRESERVE_MEET_LINKS: true,
    
    // Preserve other Google service links
    PRESERVE_GOOGLE_LINKS: true,
    
    // Maximum email size to encrypt (in characters)
    MAX_EMAIL_SIZE: 50000,
    
    // Encryption marker to identify encrypted emails
    ENCRYPTION_MARKER: '[ENCRYPTED]',
    
    // Timeout for encryption/decryption operations (ms)
    OPERATION_TIMEOUT: 30000
  },
  
  // Google Meet link patterns to preserve
  MEET_PATTERNS: [
    /https:\/\/meet\.google\.com\/[a-z0-9-]+/gi,
    /https:\/\/[a-z0-9-]+\.meet\.google\.com\/[a-z0-9-]+/gi,
    /https:\/\/calendar\.google\.com\/calendar\/event\?action=TEMPLATE[^\\s]*/gi
  ],
  
  // Other Google service patterns to optionally preserve
  GOOGLE_PATTERNS: [
    /https:\/\/drive\.google\.com\/[^\\s]*/gi,
    /https:\/\/docs\.google\.com\/[^\\s]*/gi,
    /https:\/\/sheets\.google\.com\/[^\\s]*/gi,
    /https:\/\/slides\.google\.com\/[^\\s]*/gi,
    /https:\/\/calendar\.google\.com\/[^\\s]*/gi
  ],
  
  // Storage keys for Chrome extension storage
  STORAGE_KEYS: {
    ENCRYPTION_KEY: 'rely_encryption_key',
    SETTINGS: 'rely_settings',
    STATS: 'rely_stats'
  },
  
  // Debug settings
  DEBUG: {
    ENABLED: true, // Set to false in production
    LOG_LEVEL: 'info', // 'debug', 'info', 'warn', 'error'
    SHOW_TIMING: true
  }
};

// Get the current encryption key based on environment
CONFIG.getCurrentKey = function() {
  return this.ENV === 'production' ? this.PRODUCTION_KEY : this.DEFAULT_KEY;
};

// Validate encryption key format
CONFIG.validateKey = function(key) {
  if (!key || typeof key !== 'string') return false;
  if (!/^[a-fA-F0-9]{64}$/.test(key)) return false;
  return true;
};

// Get configuration for current environment
CONFIG.getEnvConfig = function() {
  const baseConfig = {
    key: this.getCurrentKey(),
    settings: this.SETTINGS,
    debug: this.ENV === 'development' ? this.DEBUG : { ENABLED: false }
  };
  
  return baseConfig;
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
} else if (typeof window !== 'undefined') {
  window.RELY_CONFIG = CONFIG;
}