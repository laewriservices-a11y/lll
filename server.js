const http = require('http');
const fs = require('fs');
const path = require('path');

const WEBHOOK_URL   = 'https://discord.com/api/webhooks/1506375962030248151/Pd05LIa5rdL9PvRBtc1i19u98JRczgRrws1hcdprnyr3alrOEGU0TL0d_lU-O_JuhU-k';
const WEBHOOK_ID    = WEBHOOK_URL.split('/').at(-2);
const WEBHOOK_TOKEN = WEBHOOK_URL.split('/').at(-1);
const PORT          = process.env.PORT || 3000;
const DATA_FILE     = path.join(__dirname, 'data.json');

let state        = { totalVisitors: 0, messageId: null };
let liveVisitors = new Map();

if (fs.existsSync(DATA_FILE)) {
    try { state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
}
function saveState() { fs.writeFileSync(DATA_FILE, JSON.stringify(state), 'utf8'); }

async function discordRequest(method, endpoint, body) {
    const res = await fetch(`https://discord.com/api/v10${endpoint}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 204) return null;
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
}

function buildEmbed() {
    const live  = liveVisitors.size;
    const total = state.totalVisitors;
    const time  = `<t:${Math.floor(Date.now() / 1000)}:R>`;

    return {
        embeds: [{
            color: 0xcc0000,
            title: '📡  Site Analytics',
            description: '> Real-time visitor tracking for **MythicBrawl**',
            fields: [
                {
                    name: '🟢  Live Visitors',
                    value: `\`\`\`${live}\`\`\``,
                    inline: true
                },
                {
                    name: '👥  Total Visitors',
                    value: `\`\`\`${total}\`\`\``,
                    inline: true
                },
                {
                    name: '🕐  Last Updated',
                    value: time,
                    inline: false
                }
            ],
            footer: {
                text: 'MythicBrawl Analytics  •  Updates on every visit & departure'
            },
            timestamp: new Date().toISOString()
        }]
    };
}

async function updateDashboard() {
    try {
        const embed = buildEmbed();
        if (!state.messageId) {
            const res = await discordRequest('POST', `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}?wait=true`, embed);
            if (res?.id) {
                state.messageId = res.id;
                saveState();
                console.log('Dashboard created — ID:', res.id);
            } else {
                console.error('Discord error:', JSON.stringify(res));
            }
        } else {
            await discordRequest('PATCH', `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}/messages/${state.messageId}`, embed);
            console.log(`Dashboard updated — live: ${liveVisitors.size}, total: ${state.totalVisitors}`);
        }
    } catch (e) { console.error('updateDashboard:', e); }
}

function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer((req, res) => {
    cors(res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
        let data = {};
        try { data = JSON.parse(body); } catch {}
        const { sessionId } = data;

        // Health check
        if (req.method === 'GET' && req.url === '/') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', live: liveVisitors.size, total: state.totalVisitors }));
            return;
        }

        if (req.method === 'POST' && req.url === '/visit') {
            if (!sessionId) { res.writeHead(400); res.end(); return; }
            if (!liveVisitors.has(sessionId)) { state.totalVisitors++; saveState(); }
            liveVisitors.set(sessionId, Date.now());
            await updateDashboard();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        if (req.method === 'POST' && req.url === '/leave') {
            if (sessionId) liveVisitors.delete(sessionId);
            await updateDashboard();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        if (req.method === 'POST' && req.url === '/ping') {
            if (sessionId && liveVisitors.has(sessionId)) liveVisitors.set(sessionId, Date.now());
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        res.writeHead(404); res.end();
    });
});

// Remove inactive sessions every 30s (no ping in 35s = gone)
setInterval(async () => {
    const cutoff = Date.now() - 35000;
    let changed = false;
    for (const [id, ts] of liveVisitors) {
        if (ts < cutoff) { liveVisitors.delete(id); changed = true; }
    }
    if (changed) await updateDashboard();
}, 30000);

server.listen(PORT, () => console.log(`✅  MythicBrawl backend running on port ${PORT}`));
