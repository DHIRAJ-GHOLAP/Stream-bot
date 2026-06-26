// ── DOM Elements ────────────────────────────────────────────────
const guildCard = document.getElementById('guild-card');
const guildList = document.getElementById('guild-list');
const refreshBtn = document.getElementById('refresh-btn');
const listenCard = document.getElementById('listen-card');
const pttCard = document.getElementById('ptt-card');
const disconnectBtn = document.getElementById('disconnect-btn');
const startBtn = document.getElementById('start-btn');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const activeGuildBadge = document.getElementById('active-guild-badge');
const pttBtn = document.getElementById('ptt-btn');
const pttIndicator = document.getElementById('ptt-indicator');
const speakersContainer = document.getElementById('speakers-container');

let audioCtx;
let listenWs;
let speakWs;
let metadataWs;
let nextTime = 0;
let selectedGuildId = null;
const activeSpeakers = new Map();

// ── Guild Selector ──────────────────────────────────────────────

async function fetchGuilds() {
    try {
        const res = await fetch('/api/guilds');
        const guilds = await res.json();
        renderGuilds(guilds);
    } catch (err) {
        console.error('Failed to fetch guilds:', err);
    }
}

function renderGuilds(guilds) {
    const ids = Object.keys(guilds);
    if (ids.length === 0) {
        guildList.replaceChildren(createNoGuildsMessage());
        return;
    }

    guildList.replaceChildren();
    for (const guildId of ids) {
        const g = guilds[guildId];
        const item = document.createElement('div');
        const icon = document.createElement('div');
        const info = document.createElement('div');
        const name = document.createElement('span');
        const channel = document.createElement('span');

        item.className = 'guild-item';
        icon.className = 'guild-icon';
        info.className = 'guild-info';
        name.className = 'guild-name';
        channel.className = 'guild-channel';

        icon.textContent = (g.guild_name || '?').charAt(0).toUpperCase();
        name.textContent = g.guild_name || 'Unknown server';
        channel.textContent = `#${g.channel_name || 'Unknown channel'}`;

        info.append(name, channel);
        item.append(icon, info);
        item.addEventListener('click', () => selectGuild(guildId, g));
        guildList.appendChild(item);
    }
}

function createNoGuildsMessage() {
    const message = document.createElement('p');
    const command = document.createElement('kbd');
    message.className = 'no-guilds';
    message.append('No active voice channels. Use ');
    command.textContent = '!join';
    message.append(command, ' in Discord.');
    return message;
}

function selectGuild(guildId, guildInfo) {
    selectedGuildId = guildId;
    activeGuildBadge.textContent = `${guildInfo.guild_name} — #${guildInfo.channel_name}`;

    // Show listen/PTT cards, hide guild selector
    guildCard.classList.add('hidden');
    listenCard.classList.remove('hidden');
    pttCard.classList.remove('hidden');
    disconnectBtn.classList.remove('hidden');

    // Reset listen state
    startBtn.style.display = 'block';
    startBtn.innerText = 'Start Listening';
    statusDot.classList.remove('connected');
    statusText.innerText = 'Disconnected';
    speakersContainer.replaceChildren();
    activeSpeakers.clear();

    // Connect Metadata WS
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    metadataWs = new WebSocket(`${protocol}//${window.location.host}/ws/metadata/${selectedGuildId}`);
    metadataWs.onmessage = (event) => {
        try {
            handleMetadata(JSON.parse(event.data));
        } catch(e) { console.error('Metadata parse error', e); }
    };
}

function handleMetadata(data) {
    if (data.action === 'speaking_start') {
        if (!activeSpeakers.has(data.user_id)) {
            const profile = document.createElement('div');
            profile.className = 'speaker-profile speaking';
            
            const img = document.createElement('img');
            img.className = 'speaker-avatar';
            img.src = data.avatar_url || 'https://cdn.discordapp.com/embed/avatars/0.png';
            
            const name = document.createElement('span');
            name.className = 'speaker-name';
            name.textContent = data.username || 'User';
            
            profile.appendChild(img);
            profile.appendChild(name);
            speakersContainer.appendChild(profile);
            
            activeSpeakers.set(data.user_id, profile);
        } else {
            activeSpeakers.get(data.user_id).classList.add('speaking');
        }
    } else if (data.action === 'speaking_stop') {
        if (activeSpeakers.has(data.user_id)) {
            const profile = activeSpeakers.get(data.user_id);
            profile.classList.remove('speaking');
            setTimeout(() => {
                if (!profile.classList.contains('speaking')) {
                    profile.remove();
                    activeSpeakers.delete(data.user_id);
                }
            }, 2000);
        }
    }
}

    function goBackToGuildList() {
    // Disconnect everything
    if (listenWs) { listenWs.close(); listenWs = null; }
    if (metadataWs) { metadataWs.close(); metadataWs = null; }
    if (audioCtx) { audioCtx.close(); audioCtx = null; }
    stopSpeaking();
    speakersContainer.replaceChildren();
    activeSpeakers.clear();

    selectedGuildId = null;

    // Show guild selector, hide others
    guildCard.classList.remove('hidden');
    listenCard.classList.add('hidden');
    pttCard.classList.add('hidden');
    disconnectBtn.classList.add('hidden');

    fetchGuilds();
}

refreshBtn.addEventListener('click', fetchGuilds);
disconnectBtn.addEventListener('click', goBackToGuildList);

// Fetch guilds on load
fetchGuilds();

// ── Listen to VC Audio ──────────────────────────────────────────

startBtn.addEventListener('click', async () => {
    if (audioCtx || !selectedGuildId) return;

    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    // Resume AudioContext on user gesture (autoplay policy)
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }
    nextTime = 0;

    startBtn.style.display = 'none';
    statusText.innerText = 'Connecting...';

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    listenWs = new WebSocket(`${protocol}//${window.location.host}/ws/listen/${selectedGuildId}`);
    listenWs.binaryType = 'arraybuffer';

    listenWs.onopen = () => {
        statusDot.classList.add('connected');
        statusText.innerText = 'Connected & Listening';
    };

    listenWs.onclose = () => {
        statusDot.classList.remove('connected');
        statusText.innerText = 'Disconnected';
        startBtn.style.display = 'block';
        startBtn.innerText = 'Reconnect';
        if (audioCtx) { audioCtx.close(); audioCtx = null; }
        listenWs = null;
    };

    listenWs.onmessage = async (event) => {
        const arrayBuffer = event.data;
        if (!audioCtx) return;
        if (arrayBuffer.byteLength === 0) return;

        const view = new DataView(arrayBuffer);
        const numFrames = Math.floor(arrayBuffer.byteLength / 4);
        if (numFrames === 0) return;

        const audioBuffer = audioCtx.createBuffer(2, numFrames, 48000);
        for (let ch = 0; ch < 2; ch++) {
            const channelData = audioBuffer.getChannelData(ch);
            for (let i = 0; i < numFrames; i++) {
                const sample = view.getInt16(i * 4 + ch * 2, true);
                channelData[i] = sample / 32768.0;
            }
        }

        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);
        if (nextTime < audioCtx.currentTime) nextTime = audioCtx.currentTime + 0.1;
        source.start(nextTime);
        nextTime += audioBuffer.duration;
    };
});

// ── Push-to-Talk (AudioWorklet-based) ───────────────────────────
let micStream = null;
let micWorkletNode = null;
let micAudioCtx = null;
let isSpeaking = false;
let micWorkletLoaded = false;
let speakingModuleNode = null;

async function startSpeaking() {
    if (isSpeaking || !selectedGuildId) return;
    isSpeaking = true;
    pttBtn.classList.add('active');
    pttIndicator.classList.add('active');

    try {
        micStream = await navigator.mediaDevices.getUserMedia({
            audio: { sampleRate: 48000, channelCount: 2, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
    } catch (err) {
        console.error('Mic access denied:', err);
        isSpeaking = false;
        pttBtn.classList.remove('active');
        pttIndicator.classList.remove('active');
        return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    speakWs = new WebSocket(`${protocol}//${window.location.host}/ws/speak/${selectedGuildId}`);
    speakWs.binaryType = 'arraybuffer';

    micAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    if (micAudioCtx.state === 'suspended') {
        await micAudioCtx.resume();
    }

    const source = micAudioCtx.createMediaStreamSource(micStream);

    // Load AudioWorklet processor if not loaded yet
    if (!micWorkletLoaded) {
        try {
            await micAudioCtx.audioWorklet.addModule('mic-processor.js');
            micWorkletLoaded = true;
        } catch (err) {
            console.warn('AudioWorklet not supported, falling back to ScriptProcessorNode:', err);
            // Fallback to ScriptProcessorNode
            useScriptProcessorFallback(source);
            return;
        }
    }

    micWorkletNode = new AudioWorkletNode(micAudioCtx, 'mic-processor', {
        processorOptions: { sampleRate: 48000 }
    });

    micWorkletNode.port.onmessage = (event) => {
        if (!speakWs || speakWs.readyState !== WebSocket.OPEN) return;
        speakWs.send(event.data);
    };

    source.connect(micWorkletNode);
    micWorkletNode.connect(micAudioCtx.destination);
}

function useScriptProcessorFallback(source) {
    const processor = micAudioCtx.createScriptProcessor(1024, 2, 2);
    processor.onaudioprocess = (e) => {
        if (!speakWs || speakWs.readyState !== WebSocket.OPEN) return;
        const left = e.inputBuffer.getChannelData(0);
        const right = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : left;
        const buffer = new ArrayBuffer(left.length * 4);
        const view = new DataView(buffer);
        for (let i = 0; i < left.length; i++) {
            view.setInt16(i * 4, Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), true);
            view.setInt16(i * 4 + 2, Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), true);
        }
        speakWs.send(buffer);
    };
    source.connect(processor);
    processor.connect(micAudioCtx.destination);
}

function stopSpeaking() {
    if (!isSpeaking) return;
    isSpeaking = false;
    pttBtn.classList.remove('active');
    pttIndicator.classList.remove('active');

    if (micWorkletNode) { micWorkletNode.disconnect(); micWorkletNode = null; }
    if (micAudioCtx) { micAudioCtx.close(); micAudioCtx = null; }
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    if (speakWs) { speakWs.close(); speakWs = null; }
}

// Mouse
pttBtn.addEventListener('mousedown', e => { e.preventDefault(); startSpeaking(); });
pttBtn.addEventListener('mouseup', stopSpeaking);
pttBtn.addEventListener('mouseleave', stopSpeaking);

// Touch
pttBtn.addEventListener('touchstart', e => { e.preventDefault(); startSpeaking(); });
pttBtn.addEventListener('touchend', stopSpeaking);
pttBtn.addEventListener('touchcancel', stopSpeaking);

// Keyboard: Space
document.addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat) { e.preventDefault(); startSpeaking(); } });
document.addEventListener('keyup', e => { if (e.code === 'Space') { e.preventDefault(); stopSpeaking(); } });