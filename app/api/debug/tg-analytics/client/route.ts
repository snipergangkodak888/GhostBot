import { NextResponse } from 'next/server'

// This returns an HTML page that shows client-side TG Analytics debug info
// Visit: /api/debug/tg-analytics/client
export async function GET() {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TG Analytics Debug</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <script src="https://tganalytics.xyz/index.js"></script>
  <script>
    window.__tgDebug = {};
    try {
      window.__tgDebug.cdnLoaded = !!window.telegramAnalytics;
      window.__tgDebug.telegramWebApp = !!window.Telegram?.WebApp;
      window.__tgDebug.initData = window.Telegram?.WebApp?.initData || '(empty)';
      window.__tgDebug.initDataLength = window.Telegram?.WebApp?.initData?.length || 0;
      window.__tgDebug.userId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id || null;
      window.__tgDebug.userName = window.Telegram?.WebApp?.initDataUnsafe?.user?.username || null;
      window.__tgDebug.platform = window.Telegram?.WebApp?.platform || null;
      window.__tgDebug.version = window.Telegram?.WebApp?.version || null;
      window.__tgDebug.tgWebAppDataInUrl = window.location.href.includes('tgWebAppData');
      window.__tgDebug.urlHash = window.location.hash?.substring(0, 200) || '(empty)';
      
      if (window.telegramAnalytics) {
        window.telegramAnalytics.init({
          token: '${process.env.NEXT_PUBLIC_TG_ANALYTICS_TOKEN || ''}',
          appName: '${process.env.NEXT_PUBLIC_TG_ANALYTICS_APP_NAME || ''}'
        });
        window.__tgDebug.initResult = 'called successfully';
      } else {
        window.__tgDebug.initResult = 'CDN script not loaded';
      }
    } catch(e) {
      window.__tgDebug.initError = e.message;
    }
  </script>
  <style>
    body { font-family: monospace; background: #1a1a2e; color: #0f0; padding: 16px; font-size: 14px; }
    pre { white-space: pre-wrap; word-break: break-all; }
    .ok { color: #0f0; } .warn { color: #ff0; } .err { color: #f55; }
    h2 { color: #7af; }
  </style>
</head>
<body>
  <h2>TG Analytics Debug</h2>
  <pre id="output">Loading...</pre>
  <h2>Network Intercept</h2>
  <p style="color:#ff0">Sensitive headers are redacted in this debug view.</p>
  <pre id="network">Watching for tganalytics.xyz requests...</pre>
  <script>
    function redactSensitiveHeaders(headersObj) {
      const out = { ...headersObj };
      const keys = Object.keys(out);
      for (const k of keys) {
        const lower = k.toLowerCase();
        if (lower === 'tga-auth-token' || lower === 'authorization') {
          const v = String(out[k] || '');
          out[k] = v.length > 16 ? (v.slice(0, 8) + '...' + v.slice(-6)) : '***redacted***';
        }
      }
      return out;
    }

    // Intercept fetch to capture tganalytics requests
    const origFetch = window.fetch;
    const captured = [];
    window.fetch = async function(...args) {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (url.includes('tganalytics')) {
        const opts = args[1] || {};
        const entry = {
          url: url,
          method: opts.method || 'GET',
          headers: redactSensitiveHeaders(Object.fromEntries((opts.headers instanceof Headers ? opts.headers : new Headers(opts.headers || {})).entries())),
          bodyPreview: opts.body ? String(opts.body).substring(0, 500) : null,
        };
        try {
          const resp = await origFetch.apply(this, args);
          entry.status = resp.status;
          entry.statusText = resp.statusText;
          const clone = resp.clone();
          try { entry.responseBody = (await clone.text()).substring(0, 500); } catch {}
          captured.push(entry);
          document.getElementById('network').textContent = JSON.stringify(captured, null, 2);
          return resp;
        } catch(e) {
          entry.error = e.message;
          captured.push(entry);
          document.getElementById('network').textContent = JSON.stringify(captured, null, 2);
          throw e;
        }
      }
      return origFetch.apply(this, args);
    };

    // Also intercept XMLHttpRequest
    const origXHROpen = XMLHttpRequest.prototype.open;
    const origXHRSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this.__url = url;
      this.__method = method;
      return origXHROpen.apply(this, [method, url, ...rest]);
    };
    XMLHttpRequest.prototype.send = function(body) {
      if (this.__url && this.__url.includes('tganalytics')) {
        const entry = { url: this.__url, method: this.__method, bodyPreview: body ? String(body).substring(0, 500) : null };
        this.addEventListener('load', () => {
          entry.status = this.status;
          entry.responseBody = this.responseText?.substring(0, 500);
          captured.push(entry);
          document.getElementById('network').textContent = JSON.stringify(captured, null, 2);
        });
        this.addEventListener('error', () => {
          entry.error = 'XHR error';
          captured.push(entry);
          document.getElementById('network').textContent = JSON.stringify(captured, null, 2);
        });
      }
      return origXHRSend.apply(this, [body]);
    };

    // Display debug info after short delay
    setTimeout(() => {
      document.getElementById('output').textContent = JSON.stringify(window.__tgDebug, null, 2);
    }, 1000);
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html' },
  })
}
