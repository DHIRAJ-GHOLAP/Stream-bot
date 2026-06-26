const http = require('http');
const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || '/data/data/com.termux/files/home';
const LOG_DIR = path.join(HOME, 'Azure-Voice-Bot');

function getUrlFromLog(logFile) {
    try {
        const content = fs.readFileSync(path.join(LOG_DIR, logFile), 'utf8');
        const match = content.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
        if (match && match.length > 0) {
            return match[match.length - 1]; // get the latest one
        }
    } catch (e) {
        console.error('Could not read', logFile);
    }
    return '#';
}

const server = http.createServer((req, res) => {
    const dashboardUrl = getUrlFromLog('cf_dashboard.log');
    const nasUrl = getUrlFromLog('cf_nas.log');
    const sshUrl = getUrlFromLog('cf_webssh.log');

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Azure Hub</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
        <style>
            :root {
                --bg: #0f111a;
                --card-bg: rgba(255, 255, 255, 0.05);
                --card-border: rgba(255, 255, 255, 0.1);
                --text-main: #ffffff;
                --text-secondary: #a0a5ba;
                --accent: #5865F2;
            }
            body {
                margin: 0;
                padding: 0;
                font-family: 'Inter', sans-serif;
                background-color: var(--bg);
                color: var(--text-main);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                background-image: radial-gradient(circle at 50% 0%, rgba(88, 101, 242, 0.15), transparent 50%);
            }
            h1 {
                font-size: 3rem;
                font-weight: 800;
                margin-bottom: 0.5rem;
                background: linear-gradient(90deg, #fff, #a0a5ba);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            p.subtitle {
                color: var(--text-secondary);
                margin-bottom: 3rem;
            }
            .grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
                gap: 1.5rem;
                width: 100%;
                max-width: 1000px;
                padding: 0 2rem;
                box-sizing: border-box;
            }
            .card {
                background: var(--card-bg);
                border: 1px solid var(--card-border);
                border-radius: 16px;
                padding: 2rem;
                text-decoration: none;
                color: var(--text-main);
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                backdrop-filter: blur(10px);
                display: flex;
                flex-direction: column;
                align-items: flex-start;
            }
            .card:hover {
                transform: translateY(-5px);
                background: rgba(255, 255, 255, 0.1);
                border-color: rgba(255, 255, 255, 0.2);
                box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            }
            .icon {
                font-size: 2.5rem;
                margin-bottom: 1rem;
            }
            h2 {
                margin: 0 0 0.5rem 0;
                font-size: 1.25rem;
            }
            p {
                margin: 0;
                color: var(--text-secondary);
                font-size: 0.9rem;
                line-height: 1.5;
            }
            @media (max-width: 600px) {
                h1 { font-size: 2.2rem; }
                .subtitle { font-size: 0.9rem; margin-bottom: 2rem; text-align: center; padding: 0 1rem; }
                .grid { grid-template-columns: 1fr; padding: 0 1rem; gap: 1rem; }
                .card { padding: 1.5rem; align-items: center; text-align: center; }
            }
        </style>
    </head>
    <body>
        <h1>Azure Hub</h1>
        <p class="subtitle">Unified access to all your services</p>
        <div class="grid">
            <a href="${dashboardUrl}/dashboard/admin.html" target="_blank" class="card">
                <div class="icon">⚙️</div>
                <h2>Admin Console</h2>
                <p>Manage bot settings, stream controls, and moderation.</p>
            </a>
            <a href="${nasUrl}" target="_blank" class="card">
                <div class="icon">📁</div>
                <h2>NAS Storage</h2>
                <p>Secure filebrowser access to your remote storage.</p>
            </a>
            <a href="${sshUrl}" target="_blank" class="card">
                <div class="icon">💻</div>
                <h2>Web Terminal</h2>
                <p>Full SSH terminal access via your browser.</p>
            </a>
        </div>
    </body>
    </html>
    `;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
});

server.listen(8000, () => {
    console.log('Portal Server running on port 8000');
});
