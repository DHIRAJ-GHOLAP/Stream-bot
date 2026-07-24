const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const net = require('net');

const HOME = process.env.HOME || '/data/data/com.termux/files/home';
const LOG_DIR = path.join(HOME, 'Azure-Voice-Bot');

function getUrlFromLog(logFile) {
    try {
        const filePath = path.join(LOG_DIR, logFile);
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            const match = content.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
            if (match && match.length > 0) {
                return match[match.length - 1]; // get latest tunnel URL if quick tunnels are used
            }
        }
    } catch (e) {
        // Ignore log read errors
    }
    return '';
}

// Proxy HTTP requests to internal local services
function proxyRequest(req, res, targetPort, pathPrefixToStrip) {
    let reqPath = req.url;
    if (pathPrefixToStrip && reqPath.startsWith(pathPrefixToStrip)) {
        reqPath = reqPath.substring(pathPrefixToStrip.length) || '/';
    }

    const options = {
        hostname: '127.0.0.1',
        port: targetPort,
        path: reqPath,
        method: req.method,
        headers: {
            ...req.headers,
            host: `127.0.0.1:${targetPort}`
        }
    };

    const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', (err) => {
        console.error(`[Proxy Error] ${req.url} -> 127.0.0.1:${targetPort}:`, err.message);
        if (!res.headersSent) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Inter', system-ui, sans-serif; background: #090a0f; color: #f8fafc; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
        .box { background: rgba(22, 27, 46, 0.85); padding: 2.5rem 2rem; border-radius: 20px; border: 1px solid rgba(255, 255, 255, 0.1); max-width: 440px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        .icon { font-size: 2.5rem; margin-bottom: 1rem; }
        h3 { margin-bottom: 0.5rem; font-size: 1.3rem; font-weight: 700; }
        p { color: #94a3b8; font-size: 0.92rem; line-height: 1.5; margin-bottom: 1.75rem; }
        button { background: linear-gradient(135deg, #6366f1, #3b82f6); border: none; color: #fff; padding: 0.7rem 1.4rem; border-radius: 10px; font-weight: 600; cursor: pointer; transition: opacity 0.2s; }
        button:hover { opacity: 0.9; }
    </style>
</head>
<body>
    <div class="box">
        <div class="icon">⚡</div>
        <h3>Service Initializing</h3>
        <p>The backend service for this module (Port ${targetPort}) is starting up. Please click retry below in a few seconds.</p>
        <button onclick="location.reload()">🔄 Retry Connection</button>
    </div>
</body>
</html>`);
        } else {
            res.end();
        }
    });

    req.pipe(proxyReq, { end: true });
}

const server = http.createServer((req, res) => {
    const reqUrl = req.url;

    // Reverse Proxy Routes for Internal Services under single domain
    if (reqUrl.startsWith('/dashboard/') || reqUrl.startsWith('/api/') || reqUrl.startsWith('/upload-bg')) {
        return proxyRequest(req, res, 8001);
    }
    if (reqUrl.startsWith('/nas')) {
        return proxyRequest(req, res, 8080, '/nas');
    }
    if (reqUrl.startsWith('/terminal')) {
        return proxyRequest(req, res, 7681, '/terminal');
    }

    // Dynamic Quick Tunnel Fallbacks (if named tunnel DNS is not yet active)
    let dashboardUrl = getUrlFromLog('cf_dashboard.log') || '';
    let nasUrl = getUrlFromLog('cf_nas.log') || '';
    let sshUrl = getUrlFromLog('cf_webssh.log') || '';

    const adminLink = '/dashboard/admin.html';
    const nasLink = nasUrl || '/nas/';
    const sshLink = sshUrl || '/terminal/';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Azure Hub - Unified Management Portal</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-dark: #090a0f;
            --bg-card: rgba(22, 27, 46, 0.75);
            --border-card: rgba(255, 255, 255, 0.08);
            --border-active: rgba(99, 102, 241, 0.6);
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --accent-purple: #6366f1;
            --accent-blue: #3b82f6;
            --accent-emerald: #10b981;
            --accent-glow: rgba(99, 102, 241, 0.25);
            --radius-lg: 20px;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background-color: var(--bg-dark);
            color: var(--text-primary);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            overflow-x: hidden;
            background-image: 
                radial-gradient(circle at 15% 15%, rgba(99, 102, 241, 0.12), transparent 40%),
                radial-gradient(circle at 85% 85%, rgba(59, 130, 246, 0.12), transparent 40%);
        }

        header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 1rem 2rem;
            background: rgba(15, 17, 26, 0.85);
            backdrop-filter: blur(16px);
            border-bottom: 1px solid var(--border-card);
            position: sticky;
            top: 0;
            z-index: 100;
        }

        .brand {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            cursor: pointer;
            text-decoration: none;
        }

        .brand-logo {
            width: 36px;
            height: 36px;
            background: linear-gradient(135deg, var(--accent-purple), var(--accent-blue));
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 800;
            font-size: 1.2rem;
            color: #fff;
            box-shadow: 0 0 15px var(--accent-glow);
        }

        .brand-title {
            font-size: 1.35rem;
            font-weight: 800;
            background: linear-gradient(90deg, #ffffff, #cbd5e1);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: -0.5px;
        }

        .nav-tabs {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            background: rgba(255, 255, 255, 0.04);
            padding: 0.35rem;
            border-radius: 14px;
            border: 1px solid var(--border-card);
        }

        .nav-btn {
            padding: 0.55rem 1.1rem;
            border-radius: 10px;
            border: none;
            background: transparent;
            color: var(--text-secondary);
            font-size: 0.88rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.25s ease;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .nav-btn:hover {
            color: var(--text-primary);
            background: rgba(255, 255, 255, 0.06);
        }

        .nav-btn.active {
            color: #ffffff;
            background: linear-gradient(135deg, var(--accent-purple), var(--accent-blue));
            box-shadow: 0 4px 12px var(--accent-glow);
        }

        .status-pill {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.4rem 0.8rem;
            background: rgba(16, 185, 129, 0.1);
            border: 1px solid rgba(16, 185, 129, 0.25);
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 600;
            color: var(--accent-emerald);
        }

        .status-dot {
            width: 8px;
            height: 8px;
            background: var(--accent-emerald);
            border-radius: 50%;
            box-shadow: 0 0 8px var(--accent-emerald);
            animation: pulse 2s infinite;
        }

        @keyframes pulse {
            0% { transform: scale(0.95); opacity: 0.8; }
            50% { transform: scale(1.15); opacity: 1; }
            100% { transform: scale(0.95); opacity: 0.8; }
        }

        main {
            flex: 1;
            display: flex;
            flex-direction: column;
            width: 100%;
            max-width: 1300px;
            margin: 0 auto;
            padding: 2.5rem 1.5rem;
        }

        .hero {
            text-align: center;
            margin-bottom: 3rem;
        }

        .hero h1 {
            font-size: 2.8rem;
            font-weight: 800;
            letter-spacing: -1px;
            margin-bottom: 0.75rem;
            background: linear-gradient(135deg, #ffffff 30%, var(--text-secondary));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .hero p {
            color: var(--text-secondary);
            font-size: 1.1rem;
            max-width: 600px;
            margin: 0 auto;
        }

        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
            gap: 1.75rem;
        }

        .card {
            background: var(--bg-card);
            border: 1px solid var(--border-card);
            border-radius: var(--radius-lg);
            padding: 2rem;
            cursor: pointer;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            backdrop-filter: blur(12px);
        }

        .card.active-target {
            border-color: var(--border-active);
            box-shadow: 0 0 25px var(--accent-glow);
        }

        .card::before {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0;
            height: 3px;
            background: linear-gradient(90deg, transparent, var(--border-active), transparent);
            opacity: 0;
            transition: opacity 0.3s ease;
        }

        .card:hover {
            transform: translateY(-6px);
            border-color: var(--border-active);
            box-shadow: 0 16px 36px rgba(0, 0, 0, 0.4), 0 0 20px var(--accent-glow);
        }

        .card:hover::before { opacity: 1; }

        .card-icon {
            width: 56px;
            height: 56px;
            border-radius: 16px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.8rem;
            margin-bottom: 1.5rem;
            transition: transform 0.3s ease;
        }

        .card:hover .card-icon {
            transform: scale(1.1);
            background: rgba(99, 102, 241, 0.15);
            border-color: rgba(99, 102, 241, 0.4);
        }

        .card h2 { font-size: 1.4rem; font-weight: 700; margin-bottom: 0.6rem; }
        .card p { color: var(--text-secondary); font-size: 0.95rem; line-height: 1.6; margin-bottom: 1.75rem; flex: 1; }

        .card-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-top: auto;
        }

        .card-action {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            font-weight: 600;
            font-size: 0.9rem;
            color: var(--accent-purple);
            transition: gap 0.2s ease;
        }

        .card:hover .card-action { gap: 0.75rem; color: #818cf8; }

        .card-subdomain {
            font-family: monospace;
            font-size: 0.78rem;
            color: var(--text-secondary);
            background: rgba(255, 255, 255, 0.06);
            padding: 0.25rem 0.6rem;
            border-radius: 6px;
        }

        .app-view-container {
            display: none;
            flex: 1;
            flex-direction: column;
            background: var(--bg-card);
            border: 1px solid var(--border-card);
            border-radius: var(--radius-lg);
            overflow: hidden;
            min-height: 78vh;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
        }

        .app-view-container.active { display: flex; }

        .app-toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.75rem 1.25rem;
            background: rgba(15, 17, 26, 0.95);
            border-bottom: 1px solid var(--border-card);
        }

        .app-toolbar-title { display: flex; align-items: center; gap: 0.6rem; font-weight: 700; font-size: 1rem; }
        .app-actions { display: flex; align-items: center; gap: 0.6rem; }

        .tool-btn {
            padding: 0.4rem 0.8rem;
            border-radius: 8px;
            border: 1px solid var(--border-card);
            background: rgba(255, 255, 255, 0.05);
            color: var(--text-secondary);
            font-size: 0.82rem;
            font-weight: 600;
            cursor: pointer;
            text-decoration: none;
            display: flex;
            align-items: center;
            gap: 0.4rem;
            transition: all 0.2s ease;
        }

        .tool-btn:hover { background: rgba(255, 255, 255, 0.1); color: #ffffff; }

        .app-iframe {
            width: 100%;
            height: 100%;
            min-height: 720px;
            flex: 1;
            border: none;
            background: #000;
        }

        @media (max-width: 768px) {
            header { padding: 0.8rem 1rem; flex-wrap: wrap; gap: 0.75rem; }
            .nav-tabs { order: 3; width: 100%; justify-content: space-between; overflow-x: auto; }
            .nav-btn { padding: 0.45rem 0.75rem; font-size: 0.8rem; }
            .hero h1 { font-size: 2.1rem; }
            .grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <header>
        <a href="/" class="brand" onclick="switchApp(null); return false;">
            <div class="brand-logo">A</div>
            <span class="brand-title">Azure Hub</span>
        </a>

        <nav class="nav-tabs">
            <button class="nav-btn active" id="tab-overview" onclick="switchApp(null)">
                <span>📊 Overview</span>
            </button>
            <button class="nav-btn" id="tab-admin" onclick="switchApp('admin')">
                <span>⚙️ Admin</span>
            </button>
            <button class="nav-btn" id="tab-nas" onclick="switchApp('nas')">
                <span>📁 NAS</span>
            </button>
            <button class="nav-btn" id="tab-terminal" onclick="switchApp('terminal')">
                <span>💻 Terminal</span>
            </button>
        </nav>

        <div class="status-pill">
            <div class="status-dot"></div>
            <span>Named Tunnel Active</span>
        </div>
    </header>

    <main>
        <!-- Dashboard Overview Grid -->
        <div id="overview-section">
            <div class="hero">
                <h1>Azure Hub Dashboard</h1>
                <p>Central management dashboard for streaming controls, NAS file storage, and remote server terminal.</p>
            </div>

            <div class="grid">
                <div class="card" id="card-admin" onclick="switchApp('admin')">
                    <div class="card-icon">⚙️</div>
                    <h2>Admin Console</h2>
                    <p>Live stream control, real-time voice channel volume sliders, dynamic background upload, and channel moderation.</p>
                    <div class="card-footer">
                        <span class="card-action">Open Console &rarr;</span>
                        <span class="card-subdomain">admin.gholap.xyz</span>
                    </div>
                </div>

                <div class="card" id="card-nas" onclick="switchApp('nas')">
                    <div class="card-icon">📁</div>
                    <h2>NAS Storage</h2>
                    <p>Secure Filebrowser access to inspect, upload, download, and manage your local and remote storage files.</p>
                    <div class="card-footer">
                        <span class="card-action">Open NAS &rarr;</span>
                        <span class="card-subdomain">nas.gholap.xyz</span>
                    </div>
                </div>

                <div class="card" id="card-terminal" onclick="switchApp('terminal')">
                    <div class="card-icon">💻</div>
                    <h2>Web Terminal</h2>
                    <p>Full interactive web-based SSH terminal session running tmux for seamless server administration.</p>
                    <div class="card-footer">
                        <span class="card-action">Open Terminal &rarr;</span>
                        <span class="card-subdomain">terminal.gholap.xyz</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Active Service Frame View -->
        <div id="app-container" class="app-view-container">
            <div class="app-toolbar">
                <div class="app-toolbar-title" id="app-title">
                    <span id="app-icon">💻</span>
                    <span id="app-name">Web Terminal</span>
                </div>
                <div class="app-actions">
                    <button class="tool-btn" onclick="reloadIframe()">
                        🔄 Reload
                    </button>
                    <a href="#" id="external-link" target="_blank" class="tool-btn">
                        ↗️ Direct Link
                    </a>
                </div>
            </div>
            <iframe id="app-frame" class="app-iframe" src="about:blank"></iframe>
        </div>
    </main>

    <script>
        const appUrls = {
            admin: "${adminLink}",
            nas: "${nasLink}",
            terminal: "${sshLink}"
        };

        const appNames = {
            admin: { name: "Admin Console", icon: "⚙️" },
            nas: { name: "NAS Storage", icon: "📁" },
            terminal: { name: "Web Terminal", icon: "💻" }
        };

        // Central Configuration-Driven Hostname Mapping
        const APP_HOSTNAME_MAP = {
            "terminal.gholap.xyz": "terminal",
            "nas.gholap.xyz": "nas",
            "admin.gholap.xyz": "admin",
            "azure.gholap.xyz": null,

            // Future expansion hostnames hook
            "photos.gholap.xyz": "photos",
            "git.gholap.xyz": "git",
            "ai.gholap.xyz": "ai",
            "monitor.gholap.xyz": "monitor"
        };

        // Pure Hostname Detection
        function detectActiveApp() {
            const host = window.location.hostname.toLowerCase();

            // 1. Exact match from central mapping configuration
            if (host in APP_HOSTNAME_MAP) {
                return APP_HOSTNAME_MAP[host];
            }

            // 2. Subdomain prefix extraction (e.g. terminal.local or terminal.domain)
            const parts = host.split('.');
            if (parts.length > 1) {
                const sub = parts[0];
                if (sub in appNames) {
                    return sub;
                }
            }

            return null;
        }

        function switchApp(appKey) {
            const overviewSec = document.getElementById('overview-section');
            const containerSec = document.getElementById('app-container');
            const frame = document.getElementById('app-frame');
            const appTitleName = document.getElementById('app-name');
            const appTitleIcon = document.getElementById('app-icon');
            const extLink = document.getElementById('external-link');

            // Reset tab & card highlights
            document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.card').forEach(card => card.classList.remove('active-target'));

            if (!appKey || !appUrls[appKey]) {
                document.getElementById('tab-overview').classList.add('active');
                overviewSec.style.display = 'block';
                containerSec.classList.remove('active');
                frame.src = "about:blank";
                return;
            }

            // Highlight target tab and card
            const tabBtn = document.getElementById('tab-' + appKey);
            if (tabBtn) tabBtn.classList.add('active');

            const targetCard = document.getElementById('card-' + appKey);
            if (targetCard) targetCard.classList.add('active-target');

            overviewSec.style.display = 'none';
            containerSec.classList.add('active');

            const appMeta = appNames[appKey];
            appTitleName.textContent = appMeta.name;
            appTitleIcon.textContent = appMeta.icon;

            const targetUrl = appUrls[appKey];
            extLink.href = targetUrl;

            if (frame.src !== window.location.origin + targetUrl && frame.src !== targetUrl) {
                frame.src = targetUrl;
            }
        }

        function reloadIframe() {
            const frame = document.getElementById('app-frame');
            if (frame && frame.src) {
                frame.src = frame.src;
            }
        }

        // Detect hostname on load and activate module
        window.addEventListener('DOMContentLoaded', () => {
            const initialApp = detectActiveApp();
            switchApp(initialApp);
        });
    </script>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
});

server.on('upgrade', (req, socket, head) => {
    let targetPort = 8001; // default to bot ws
    const reqUrl = req.url;

    if (reqUrl.startsWith('/terminal') || reqUrl.startsWith('/ws/terminal') || reqUrl.startsWith('/ws/token') || reqUrl.startsWith('/ws/ssh') || reqUrl.startsWith('/ws/')) {
        targetPort = 7681; // ttyd terminal ws
    } else if (reqUrl.startsWith('/nas')) {
        targetPort = 8080; // NAS ws
    }

    const proxySocket = net.connect(targetPort, '127.0.0.1', () => {
        proxySocket.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
            proxySocket.write(`${req.rawHeaders[i]}: ${req.rawHeaders[i+1]}\r\n`);
        }
        proxySocket.write('\r\n');
        if (head && head.length > 0) {
            proxySocket.write(head);
        }
        proxySocket.pipe(socket);
        socket.pipe(proxySocket);
    });

    proxySocket.on('error', (err) => {
        console.error(`[WS Proxy Error] ${req.url} -> 127.0.0.1:${targetPort}:`, err.message);
        socket.destroy();
    });

    socket.on('error', (err) => {
        proxySocket.destroy();
    });
});

const PORT = parseInt(process.env.PORT || '8000', 10);
server.listen(PORT, () => {
    console.log(`Azure Hub Portal Server running on port ${PORT}`);
});
