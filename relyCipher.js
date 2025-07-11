(function() {
    function hexToBytes(hex) {
        if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
            throw new Error('Invalid hex key: Must be 64-character hex string');
        }
        return new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
    }
    
    function abToB64(arrayBuffer) {
        return btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    }
    
    function b64ToAb(base64) {
        return Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;
    }
    
    function generateIV() {
        return crypto.getRandomValues(new Uint8Array(12));
    }
    
    async function importKey(hexKey, usage) {
        const keyBytes = hexToBytes(hexKey);
        return crypto.subtle.importKey(
            'raw',
            keyBytes,
            { name: 'AES-GCM' },
            false,
            usage
        );
    }
    
    async function encryptText(plainText = '', hexKey) {
        if (!hexKey) throw new Error('hexKey required');
        if (!plainText) return '';
        const key = await importKey(hexKey, ['encrypt']);
        const iv = generateIV();
        const encoded = new TextEncoder().encode(plainText);
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
        return `${abToB64(iv)}:${abToB64(ct)}`;
    }
    
    async function decryptText(cipherText = '', hexKey) {
        if (!hexKey) throw new Error('hexKey required');
        if (!cipherText || !cipherText.includes(':')) return cipherText;
        const [ivB64, ctB64] = cipherText.split(':');
        const iv = new Uint8Array(b64ToAb(ivB64));
        const ct = b64ToAb(ctB64);
        const key = await importKey(hexKey, ['decrypt']);
        const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
        return new TextDecoder().decode(plainBuf);
    }
    
    window.relyCipher = {
        encryptText,
        decryptText
    };
})();