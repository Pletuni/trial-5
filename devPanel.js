// Manual Decryption and Encryption logic for popup.html

document.addEventListener('DOMContentLoaded', () => {
    const encryptInput = document.getElementById('manualEncryptInput');
    const decryptInput = document.getElementById('manualDecryptInput');
    const keyInput = document.getElementById('manualKeyInput');
    const resultBox = document.getElementById('manualResult');
    const encryptBtn = document.getElementById('manualEncryptBtn');
    const decryptBtn = document.getElementById('manualDecryptBtn');

    if (encryptBtn) {
        encryptBtn.onclick = async () => {
            const text = encryptInput.value.trim();
            const key = keyInput.value.trim();
            if (!text || !key) {
                resultBox.value = 'Please enter text and a valid key.';
                return;
            }
            if (!/^[0-9a-fA-F]{64}$/.test(key)) {
                resultBox.value = 'Key must be a 64-character hex string.';
                return;
            }
            try {
                const encrypted = await window.relyCipher.encryptText(text, key);
                resultBox.value = encrypted;
            } catch (e) {
                resultBox.value = 'Encryption failed: ' + e.message;
            }
        };
    }

    if (decryptBtn) {
        decryptBtn.onclick = async () => {
            const encrypted = decryptInput.value.trim();
            const key = keyInput.value.trim();
            if (!encrypted || !key) {
                resultBox.value = 'Please enter encrypted text and a valid key.';
                return;
            }
            if (!/^[0-9a-fA-F]{64}$/.test(key)) {
                resultBox.value = 'Key must be a 64-character hex string.';
                return;
            }
            try {
                const decrypted = await window.relyCipher.decryptText(encrypted, key);
                resultBox.value = decrypted;
            } catch (e) {
                resultBox.value = 'Decryption failed: ' + e.message;
            }
        };
    }
});