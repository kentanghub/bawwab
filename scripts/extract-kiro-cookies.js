/**
 * Bawwab Kiro Cookie Extractor
 * 
 * CARA PAKAI:
 * 1. Login ke https://kiro.dev di browser
 * 2. Buka DevTools (F12) → Console
 * 3. Paste kode ini dan tekan Enter
 * 4. Cookie akan otomatis dikirim ke Bawwab API
 */

(async function() {
  const BAWWAB_URL = 'http://localhost:3000'; // Ganti dengan URL Bawwab kamu
  
  // 1. Extract cookies dari kiro.dev
  const allCookies = document.cookie;
  
  // Filter cookies yang diawali 'aor_' (kiro session cookies)
  const kiroCookies = allCookies
    .split(';')
    .map(c => c.trim())
    .filter(c => c.startsWith('aor_'))
    .join('; ');
  
  if (!kiroCookies) {
    console.error('❌ Tidak ada cookie aor_* ditemukan. Pastikan kamu sudah login ke kiro.dev');
    alert('❌ Tidak ada cookie aor_* ditemukan. Pastikan kamu sudah login ke kiro.dev');
    return;
  }
  
  console.log('🍪 Cookies ditemukan:', kiroCookies.replace(/=.*/g, '=***'));
  
  // 2. Get user agent untuk fingerprint matching
  const userAgent = navigator.userAgent;
  
  // 3. Submit ke Bawwab
  try {
    const response = await fetch(`${BAWWAB_URL}/v1/oauth/kiro/cookie-entry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cookies: kiroCookies,
        userAgent: userAgent,
        // expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 hari
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log('✅ Cookie berhasil disimpan ke Bawwab!', result);
      alert('✅ Cookie berhasil disimpan ke Bawwab!\n\nSekarang kamu bisa chat via Bawwab ke kiro.dev');
    } else {
      console.error('❌ Gagal:', result);
      alert('❌ Gagal menyimpan cookie: ' + (result.message || 'Unknown error'));
    }
  } catch (err) {
    console.error('❌ Network error:', err);
    alert('❌ Gagal terhubung ke Bawwab. Pastikan Bawwab API running di ' + BAWWAB_URL);
  }
})();
