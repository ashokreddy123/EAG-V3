let totalSeconds = 25 * 60;
let remainingSeconds = totalSeconds;
let elapsedSeconds = 0;
let timerInterval = null;
let isRunning = false;

// Setup Dragging
document.getElementById('drag-handle').addEventListener('mousedown', (e) => {
    if(e.target.tagName !== 'BUTTON') {
        if(window.pywebview) window.pywebview.api.start_drag();
    }
});

// Setup window controls
document.getElementById('close-btn').addEventListener('click', () => {
    if(window.pywebview) window.pywebview.api.close_timer(elapsedSeconds);
});
document.getElementById('minimize-btn').addEventListener('click', () => {
    if(window.pywebview) window.pywebview.api.minimize_timer();
});
document.getElementById('restart-btn').addEventListener('click', () => {
    elapsedSeconds = 0;
    remainingSeconds = totalSeconds;
    isRunning = true;
    updateDisplay();
});

// Completion overlay buttons
document.getElementById('done-close-btn').addEventListener('click', () => {
    if(window.pywebview) window.pywebview.api.close_timer(0);
});
document.getElementById('new-session-btn').addEventListener('click', () => {
    document.getElementById('done-overlay').style.display = 'none';
    elapsedSeconds = 0;
    remainingSeconds = totalSeconds;
    isRunning = true;
    updateDisplay();
    if(window.pywebview) window.pywebview.api.start_python_timer();
});

// Canvas Setup
const canvas = document.getElementById('hgCanvas');
const ctx = canvas.getContext('2d');
const W = 100;
const H = 160;
const centerX = W / 2;
const neckY = H / 2;

const bulbWidth = 80;
const bulbHeight = 70;
const neckWidth = 7;

// Create realistic sandy texture pattern
function createSandPattern() {
    const pc = document.createElement('canvas');
    pc.width = 64; pc.height = 64;
    const pctx = pc.getContext('2d');
    pctx.fillStyle = '#b8860b'; // Base gold
    pctx.fillRect(0,0,64,64);
    for(let i=0; i<3000; i++) {
        pctx.fillStyle = Math.random() > 0.5 ? '#d4af37' : '#8b6508';
        pctx.fillRect(Math.random()*64, Math.random()*64, 1, 1);
    }
    return ctx.createPattern(pc, 'repeat');
}
const sandPattern = createSandPattern();

const particles = [];
class Particle {
    constructor() {
        this.x = centerX + (Math.random() - 0.5) * neckWidth * 0.8;
        this.y = neckY;
        this.vx = (Math.random() - 0.5) * 0.4;
        this.vy = 1 + Math.random() * 2;
        this.size = Math.random() * 1.5 + 0.5;
        this.color = Math.random() > 0.5 ? '#d4af37' : '#f8e58c';
    }
    update() {
        this.vy += 0.15; // gravity
        this.y += this.vy;
        this.x += this.vx;
    }
    draw() {
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.size, this.size);
    }
}

function getGlassPath(isTop) {
    const path = new Path2D();
    const sign = isTop ? -1 : 1;
    
    path.moveTo(centerX - neckWidth/2, neckY);
    path.bezierCurveTo(
        centerX - neckWidth/2, neckY + sign*30, 
        centerX - bulbWidth/2, neckY + sign*bulbHeight*0.4, 
        centerX - bulbWidth/2, neckY + sign*bulbHeight*0.8 
    );
    path.bezierCurveTo(
        centerX - bulbWidth/2, neckY + sign*bulbHeight*1.1, 
        centerX + bulbWidth/2, neckY + sign*bulbHeight*1.1, 
        centerX + bulbWidth/2, neckY + sign*bulbHeight*0.8
    );
    path.bezierCurveTo(
        centerX + bulbWidth/2, neckY + sign*bulbHeight*0.4,
        centerX + neckWidth/2, neckY + sign*30,
        centerX + neckWidth/2, neckY
    );
    path.closePath();
    return path;
}

function drawGlass() {
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    
    const topPath = getGlassPath(true);
    ctx.fill(topPath); ctx.stroke(topPath);
    
    const botPath = getGlassPath(false);
    ctx.fill(botPath); ctx.stroke(botPath);
}

function drawSand() {
    const p = totalSeconds > 0 ? remainingSeconds / totalSeconds : 0;
    const inv = 1 - p;

    // Top Sand
    if (p > 0) {
        ctx.save();
        ctx.clip(getGlassPath(true));
        ctx.fillStyle = sandPattern;
        
        let levelY = neckY - bulbHeight + (bulbHeight * inv);
        let dip = 40 * inv; 
        if(levelY > neckY) levelY = neckY;
        
        ctx.beginPath();
        ctx.moveTo(0, levelY);
        ctx.quadraticCurveTo(centerX, levelY + dip, W, levelY);
        ctx.lineTo(W, neckY);
        ctx.lineTo(0, neckY);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    // Bottom Sand
    if (inv > 0) {
        ctx.save();
        ctx.clip(getGlassPath(false));
        ctx.fillStyle = sandPattern;
        
        let levelY = (neckY + bulbHeight) - (bulbHeight * inv); 
        let peak = 40 * inv; 
        
        ctx.beginPath();
        ctx.moveTo(0, levelY + peak);
        ctx.quadraticCurveTo(centerX, levelY - peak, W, levelY + peak);
        ctx.lineTo(W, H);
        ctx.lineTo(0, H);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }
}

function renderCanvas() {
    ctx.clearRect(0,0,W,H);
    
    drawSand();
    drawGlass();
    
    if (isRunning && remainingSeconds > 0) {
        for(let i=0; i<4; i++) particles.push(new Particle());
    }
    
    const p = totalSeconds > 0 ? remainingSeconds / totalSeconds : 0;
    const inv = 1 - p;
    // Estimated collision line
    const peakY = (neckY + bulbHeight) - (bulbHeight * inv) - (20 * inv);

    for(let i=particles.length-1; i>=0; i--) {
        const pt = particles[i];
        pt.update();
        pt.draw();
        if(pt.y >= peakY) {
            particles.splice(i, 1);
        }
    }
    requestAnimationFrame(renderCanvas);
}

async function initTimer() {
    if(!window.pywebview || !window.pywebview.api) {
        setTimeout(initTimer, 100);
        return;
    }
    
    // Set opacity to 90% immediately via OS Level API
    window.pywebview.api.set_window_opacity(90);
    
    totalSeconds = await window.pywebview.api.get_timer_duration();
    remainingSeconds = totalSeconds;
    isRunning = true;
    
    // Start the Python-side timer thread (counts even when minimized)
    window.pywebview.api.start_python_timer();
    
    updateDisplay();
    renderCanvas();
    
    timerInterval = setInterval(() => {
        if(remainingSeconds > 0) {
            remainingSeconds--;
            elapsedSeconds++;
            updateDisplay();
            
            // Sync live status back to dashboard
            if(elapsedSeconds % 5 === 0 && window.pywebview && window.pywebview.api.sync_active_timer) {
                window.pywebview.api.sync_active_timer(elapsedSeconds);
            }
        } else {
            clearInterval(timerInterval);
            isRunning = false;
            
            // 1. Play chime sound
            playChime();
            
            // 2. Show completion overlay (widget stays open)
            document.getElementById('time-display').innerText = "DONE!";
            document.getElementById('done-overlay').style.display = 'flex';
            
            // 3. Commit deep work to DB via Python
            if(window.pywebview) window.pywebview.api.close_timer(elapsedSeconds);
            
            // 4. Send Windows notification
            if(window.pywebview) window.pywebview.api.notify_complete(elapsedSeconds);
        }
    }, 1000);
}

function playChime() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const notes = [523.25, 659.25, 783.99, 1046.50]; // C5 E5 G5 C6
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.value = freq;
            const startAt = ctx.currentTime + i * 0.25;
            gain.gain.setValueAtTime(0, startAt);
            gain.gain.linearRampToValueAtTime(0.4, startAt + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.6);
            osc.start(startAt);
            osc.stop(startAt + 0.6);
        });
    } catch(e) { console.log('Audio error:', e); }
}

function updateDisplay() {
    const m = Math.floor(remainingSeconds / 60);
    const s = remainingSeconds % 60;
    document.getElementById('time-display').innerText = 
        `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}


window.addEventListener('pywebviewready', initTimer);
