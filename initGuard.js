// RelyHealth Email Cipher - Initialization Guard
// This script prevents multiple initializations and provides better error handling

(function() {
    'use strict';
    
    // Global initialization flag
    if (window.RelyHealthInitialized) {
        console.log('[RelyHealth] Extension already initialized, skipping...');
        return;
    }
    
    // Set initialization flag immediately
    window.RelyHealthInitialized = true;
    
    // Error handler for script loading issues
    window.addEventListener('error', function(event) {
        if (event.filename && event.filename.includes('rely')) {
            console.error('[RelyHealth] Script error:', event.error);
        }
    });
    
    // Unhandled promise rejection handler
    window.addEventListener('unhandledrejection', function(event) {
        if (event.reason && event.reason.toString().includes('rely')) {
            console.error('[RelyHealth] Unhandled promise rejection:', event.reason);
        }
    });
    
    // Prevent multiple script injections
    if (window.RelyHealthScriptsLoaded) {
        console.log('[RelyHealth] Scripts already loaded, preventing re-injection');
        return;
    }
    
    window.RelyHealthScriptsLoaded = true;
    
    // Log successful initialization
    console.log('[RelyHealth] Initialization guard loaded successfully');
})(); 