#!/usr/bin/env python3
"""
Bawwab Kiro Cookie Extractor
Extract cookies from kiro.dev and submit to Bawwab API

Usage:
    1. Login to https://kiro.dev in your browser
    2. Open DevTools → Application → Cookies → https://kiro.dev
    3. Copy all cookies starting with 'aor_'
    4. Run: python3 submit-kiro-cookies.py
    5. Paste cookies when prompted
"""

import sys
import urllib.request
import urllib.error
import json

BAWWAB_URL = "http://localhost:3000"  # Change to your Bawwab URL


def submit_cookies(cookies: str, user_agent: str = None):
    """Submit cookies to Bawwab API"""
    url = f"{BAWWAB_URL}/v1/oauth/kiro/cookie-entry"
    
    data = json.dumps({
        "cookies": cookies,
        "userAgent": user_agent or "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    }).encode("utf-8")
    
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
        },
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read().decode())
            if result.get("success"):
                print(f"✅ Success: {result['message']}")
                return True
            else:
                print(f"❌ Failed: {result}")
                return False
    except urllib.error.HTTPError as e:
        print(f"❌ HTTP Error {e.code}: {e.read().decode()}")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def test_chat():
    """Test chat via Bawwab to kiro"""
    url = f"{BAWWAB_URL}/v1/chat/completions"
    
    data = json.dumps({
        "model": "kr/claude-sonnet-4",
        "messages": [{"role": "user", "content": "Hello!"}]
    }).encode("utf-8")
    
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer test-key"  # Use your virtual key
        },
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode())
            print(f"✅ Chat response: {json.dumps(result, indent=2)[:500]}...")
            return True
    except Exception as e:
        print(f"❌ Chat error: {e}")
        return False


def main():
    print("=" * 60)
    print("  Bawwab Kiro Cookie Submitter")
    print("=" * 60)
    print()
    print("Paste your kiro.dev cookies (starting with aor_):")
    print("(Press Ctrl+D when done)")
    print()
    
    lines = sys.stdin.read().strip()
    
    if not lines:
        print("❌ No cookies provided")
        sys.exit(1)
    
    # Clean up cookies
    cookies = lines.replace("\n", "; ").replace("  ", " ").strip()
    
    if "aor_" not in cookies:
        print("⚠️  Warning: No aor_* cookies found. Make sure you copied from kiro.dev")
    
    print(f"\n🍪 Submitting {len(cookies)} chars of cookies...")
    
    if submit_cookies(cookies):
        print("\n🧪 Testing chat endpoint...")
        test_chat()
    
    print("\n✅ Done!")


if __name__ == "__main__":
    main()
