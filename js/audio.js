/**
 * audio.js — 音频引擎模块
 *
 * 职责：
 *   - 捕获系统音频输出（getDisplayMedia，不启用麦克风）或加载本地音频文件
 *   - 频谱分析（AnalyserNode）+ 三频段（低/中/高）能量计算
 *   - 自适应节拍检测（能量均值+标准差动态阈值、BPM 估计）
 *   - 音频驱动粒子生成（updateAudioPaint，分层 + 节拍爆发）
 *   - 频谱指示器绘制（meterCanvas，左下角小窗）
 *   - 合成音效（sfx：落笔/主题切换/保存成功）
 *   - 屏幕边框光晕脉动（audioRing）
 *
 * 依赖：
 *   - util.js：rand, clamp
 *   - main.js：state（audioMode/soundOn/size/speed/theme，live binding）
 *   - particle.js：acquire, particles, MAX_PARTICLES, W, H（live binding）
 *   - ui.js：audioBtn, audioRing, showToast（live binding）
 *
 * 循环依赖说明：
 *   audio ↔ particle、audio ↔ ui、audio ↔ main 均为安全循环。
 *   updateAudioPaint 在函数体内读取 particle 的 acquire/particles，
 *   audio.update 在 draw() 循环内被调用（非顶层）。
 */

import { rand, clamp } from './util.js';
import { state } from './main.js';
import { acquire, particles, MAX_PARTICLES, W, H } from './particle.js';
import { audioBtn, audioRing, showToast, controls } from './ui.js';

// ============================================================
//  频谱指示器 Canvas（延迟创建）
// ============================================================

let meterCanvas = null, meterCtx = null;

/**
 * 初始化音频模块：创建频谱指示器 canvas 并挂载到 wrapper。
 * 必须在 main.js init() 中、ui.js initUI() 之后调用。
 */
export function initAudio(wrapperEl) {
    meterCanvas = document.createElement('canvas');
    meterCanvas.width = 104; meterCanvas.height = 48;
    Object.assign(meterCanvas.style, {
        position: 'absolute', bottom: 'max(96px, env(safe-area-inset-bottom))',
        left: 'max(24px, env(safe-area-inset-left))', width: '104px', height: '48px',
        zIndex: '8', opacity: '0', transition: 'opacity 0.3s', pointerEvents: 'none',
        borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)',
        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', webkitBackdropFilter: 'blur(8px)'
    });
    wrapperEl.appendChild(meterCanvas);
    meterCtx = meterCanvas.getContext('2d');
}

// ============================================================
//  音频引擎
// ============================================================

/**
 * 音频引擎对象。
 * 捕获系统音频（不启用麦克风）或音频文件，进行频谱分析与节拍检测。
 */
export const audio = {
    ctx: null, analyser: null, source: null, stream: null, data: null,
    bass: 0, mid: 0, treble: 0, fileName: null,
    beat: false, beatStrength: 0, prevBass: 0, beatCooldown: 0, emitterAngle: 0,
    bpm: 120, beatHistory: [], lastBeatTime: 0, energyHistory: [],
    bassBeat: false, midBeat: false, trebleBeat: false,
    /** 14 色频谱映射：低频暖色 → 高频冷色 */
    spectrumColors: [[20,85,60],[45,88,65],[70,85,62],[95,80,58],[120,75,55],[145,70,52],[170,68,58],[195,72,65],[220,75,70],[245,78,68],[270,80,62],[295,78,58],[320,75,60],[345,72,65]],

    async init() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); },

    /**
     * 捕获系统/标签页音频输出（不启用麦克风）。
     * 使用 getDisplayMedia 请求音频+视频，立即丢弃视频轨道。
     * @returns {Promise<boolean>} 是否成功
     */
    async startSystemAudio() {
        await this.init();
        this.stop();
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            showToast('当前浏览器不支持系统音频捕获，请在设置中使用音频文件', null);
            return false;
        }
        try {
            // 大多数浏览器要求同时请求视频轨道才会显示共享面板
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            const audioTracks = stream.getAudioTracks();
            if (audioTracks.length === 0) {
                stream.getTracks().forEach(t => t.stop());
                showToast('未捕获到音频：请在共享面板勾选「分享系统音频 / Share system audio」', null);
                return false;
            }
            // 仅保留音频轨道，立即丢弃视频轨道（不需要画面）
            stream.getVideoTracks().forEach(t => t.stop());
            this.stream = new MediaStream(audioTracks);
            this.source = this.ctx.createMediaStreamSource(this.stream);
            // 不外放：用户已通过原播放器听到声音，再外放会形成回声
            this._setupAnalyser(false);
            this.fileName = '系统音频';
            // 用户在浏览器原生 UI 停止共享时，自动关闭音频模式
            audioTracks[0].addEventListener('ended', () => deactivateAudio());
            return true;
        } catch (e) {
            if (e && e.name !== 'AbortError') showToast('音频捕获失败：' + (e.message || e.name), null);
            return false;
        }
    },

    /**
     * 加载本地音频文件并播放（回退方案）。
     * @param {File} file
     * @returns {Promise<boolean>}
     */
    async startFile(file) {
        await this.init();
        this.stop();
        try {
            const url = URL.createObjectURL(file);
            const el = new Audio(url); el.loop = true; el.crossOrigin = 'anonymous';
            await el.play();
            this.source = this.ctx.createMediaElementSource(el);
            this._el = el; this.fileName = file.name;
            this._setupAnalyser(true);
            return true;
        } catch (e) { showToast('音频加载失败', null); return false; }
    },

    /**
     * 设置频谱分析器。
     * @param {boolean} toDestination 是否连接到 destination（音频文件需要外放，麦克风不需要以防啸叫）
     */
    _setupAnalyser(toDestination) {
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 256;
        this.source.connect(this.analyser);
        // 仅音频文件需要外放；麦克风若接到 destination 会引发啸叫反馈
        if (toDestination) this.analyser.connect(this.ctx.destination);
        this.data = new Uint8Array(this.analyser.frequencyBinCount);
    },

    /**
     * 每帧更新：读取频谱数据，计算三频段能量，执行自适应节拍检测，
     * 绘制频谱指示器，更新边框光晕。
     */
    update() {
        if (!this.analyser) return;
        this.analyser.getByteFrequencyData(this.data);
        const n = this.data.length;
        let b = 0, m = 0, t = 0;
        const bEnd = Math.floor(n * 0.1), mEnd = Math.floor(n * 0.4);
        for (let i = 0; i < bEnd; i++) b += this.data[i];
        for (let i = bEnd; i < mEnd; i++) m += this.data[i];
        for (let i = mEnd; i < n; i++) t += this.data[i];
        const smooth = 0.35;
        this.bass = this.bass * (1 - smooth) + (b / bEnd / 255) * smooth;
        this.mid = this.mid * (1 - smooth) + (m / (mEnd - bEnd) / 255) * smooth;
        this.treble = this.treble * (1 - smooth) + (t / (n - mEnd) / 255) * smooth;

        // 能量历史用于自适应阈值
        const energy = this.bass + this.mid + this.treble;
        this.energyHistory.push(energy);
        if (this.energyHistory.length > 60) this.energyHistory.shift();
        const avgEnergy = this.energyHistory.reduce((a, b) => a + b, 0) / this.energyHistory.length;
        const energyStd = Math.sqrt(this.energyHistory.reduce((s, e) => s + Math.pow(e - avgEnergy, 2), 0) / this.energyHistory.length);

        // 动态节拍检测：基于标准差的自适应阈值
        if (this.beatCooldown > 0) this.beatCooldown--;
        const bassDelta = this.bass - this.prevBass;
        this.prevBass = this.bass;

        // 低音节拍（鼓点）：要求突增且超过均值 + 1.5倍标准差
        const bassThreshold = avgEnergy * 0.4 + energyStd * 1.2;
        this.bassBeat = bassDelta > 0.08 && this.bass > bassThreshold && this.beatCooldown === 0;

        // 中音节拍（旋律）
        const midDelta = this.mid - (this._prevMid || 0);
        this._prevMid = this.mid;
        this.midBeat = midDelta > 0.15 && this.mid > avgEnergy * 0.3;

        // 高音节拍（打击乐）
        const trebleDelta = this.treble - (this._prevTreble || 0);
        this._prevTreble = this.treble;
        this.trebleBeat = trebleDelta > 0.2 && this.treble > avgEnergy * 0.25;

        // 综合节拍（任一频段触发即为一拍）
        if (this.bassBeat || this.midBeat || this.trebleBeat) {
            this.beat = true;
            this.beatStrength = Math.max(bassDelta, midDelta, trebleDelta);
            // 动态 cooldown：根据估计的 BPM 调整
            const beatInterval = Math.max(8, Math.min(30, Math.round(60000 / this.bpm / 60)));
            this.beatCooldown = beatInterval;

            // BPM 估计：记录节拍间隔并计算
            const now = performance.now();
            if (this.lastBeatTime > 0) {
                const interval = now - this.lastBeatTime;
                const bpmEst = 60000 / interval;
                this.bpm = this.bpm * 0.8 + bpmEst * 0.2;
            }
            this.lastBeatTime = now;

            // Phase 5.2：节拍反馈 — 控制面板边框短暂高亮（柔和脉动）
            if (controls) {
                controls.classList.add('beat-pulse');
                setTimeout(() => controls.classList.remove('beat-pulse'), 150);
            }
        } else {
            this.beat = false;
        }

        // 频谱指示器
        if (meterCtx) {
            meterCtx.clearRect(0, 0, 104, 48);
            const bars = [
                { v: this.bass, c: '#ff6b6b', label: 'BASS' },
                { v: this.mid, c: '#feca57', label: 'MID' },
                { v: this.treble, c: '#7dd3fc', label: 'HIGH' }
            ];
            const bw = 24, gap = 6, x0 = 10, baseY = 38, maxH = 28;
            bars.forEach((bar, i) => {
                const x = x0 + i * (bw + gap);
                const h = Math.max(2, bar.v * maxH);
                meterCtx.fillStyle = bar.c;
                meterCtx.globalAlpha = 0.85;
                meterCtx.fillRect(x, baseY - h, bw, h);
                meterCtx.globalAlpha = 0.4;
                meterCtx.fillStyle = '#fff';
                meterCtx.font = '7px sans-serif';
                meterCtx.textAlign = 'center';
                meterCtx.fillText(bar.label, x + bw / 2, 46);
            });
            meterCtx.globalAlpha = 1;
            if (this.beat) {
                meterCtx.fillStyle = 'rgba(255,255,255,0.9)';
                meterCtx.font = 'bold 9px sans-serif';
                meterCtx.textAlign = 'left';
                meterCtx.fillText('♪ BEAT', 10, 12);
            }
        }

        // 屏幕边框光晕：随低频脉动（比之前明显得多）
        audioRing.style.opacity = (0.25 + this.bass * 0.6).toFixed(2);
        audioRing.style.boxShadow = `inset 0 0 ${30 + this.bass * 100}px rgba(125,211,252,${(0.12 + this.bass * 0.5).toFixed(2)})`;
    },

    /** 停止音频捕获/播放，重置所有状态。 */
    stop() {
        if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
        if (this._el) { this._el.pause(); this._el = null; }
        if (this.source) { try { this.source.disconnect(); } catch (e) {} this.source = null; }
        this.analyser = null; this.bass = this.mid = this.treble = 0;
        this.beat = false; this.prevBass = 0; this.beatCooldown = 0;
        this.bpm = 120; this.beatHistory = []; this.lastBeatTime = 0; this.energyHistory = [];
        this.bassBeat = false; this.midBeat = false; this.trebleBeat = false;
        this._prevMid = 0; this._prevTreble = 0;
        audioRing.style.opacity = '0';
        audioRing.style.boxShadow = 'none';
        if (meterCanvas) meterCanvas.style.opacity = '0';
    },

    /**
     * Phase 6.2：音频演示模式 — 无需 getDisplayMedia，用 Web Audio 合成伪频谱。
     * 3 个振荡器（低频 60Hz / 中频 440Hz / 高频 2kHz）+ LFO 调制振幅模拟节拍。
     * 不连接 destination（静音），仅通过 AnalyserNode 读取频谱驱动粒子。
     * @returns {boolean} 是否成功启动
     */
    startDemo() {
        try {
            if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            if (this.ctx.state === 'suspended') this.ctx.resume();
            // 三层振荡器
            this._demoBass = this.ctx.createOscillator(); this._demoBass.type = 'sine'; this._demoBass.frequency.value = 60;
            this._demoMid = this.ctx.createOscillator(); this._demoMid.type = 'triangle'; this._demoMid.frequency.value = 440;
            this._demoTreble = this.ctx.createOscillator(); this._demoTreble.type = 'square'; this._demoTreble.frequency.value = 2000;
            // 各自增益（控制能量层级：低频强、中频中、高频弱）
            this._demoBassGain = this.ctx.createGain(); this._demoBassGain.gain.value = 0.5;
            this._demoMidGain = this.ctx.createGain(); this._demoMidGain.gain.value = 0.25;
            this._demoTrebleGain = this.ctx.createGain(); this._demoTrebleGain.gain.value = 0.08;
            // LFO 调制低频振幅，模拟节拍（1.5Hz ≈ 90 BPM）
            this._demoLFO = this.ctx.createOscillator(); this._demoLFO.frequency.value = 1.5;
            this._demoLFOGain = this.ctx.createGain(); this._demoLFOGain.gain.value = 0.4;
            // 分析器
            this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 1024; this.analyser.smoothingTimeConstant = 0.8;
            this.data = new Uint8Array(this.analyser.frequencyBinCount);
            // 连接：振荡器 → 增益 → 分析器（不连 destination，静音）
            this._demoBass.connect(this._demoBassGain); this._demoBassGain.connect(this.analyser);
            this._demoMid.connect(this._demoMidGain); this._demoMidGain.connect(this.analyser);
            this._demoTreble.connect(this._demoTrebleGain); this._demoTrebleGain.connect(this.analyser);
            // LFO → 低频增益（调制振幅产生节拍感）
            this._demoLFO.connect(this._demoLFOGain); this._demoLFOGain.connect(this._demoBassGain.gain);
            this._demoBass.start(); this._demoMid.start(); this._demoTreble.start(); this._demoLFO.start();
            this.fileName = '演示波形';
            this.bass = this.mid = this.treble = 0;
            return true;
        } catch (e) { return false; }
    },

    /** Phase 6.2：停止演示模式，清理合成振荡器。 */
    stopDemo() {
        ['_demoBass', '_demoMid', '_demoTreble', '_demoLFO'].forEach(k => {
            const o = this[k];
            if (o) { try { o.stop(); } catch (e) {} try { o.disconnect(); } catch (e) {} this[k] = null; }
        });
        ['_demoBassGain', '_demoMidGain', '_demoTrebleGain', '_demoLFOGain'].forEach(k => {
            const g = this[k];
            if (g) { try { g.disconnect(); } catch (e) {} this[k] = null; }
        });
        this.analyser = null; this.data = null;
        this.bass = this.mid = this.treble = 0;
        this.beat = false; this.beatCooldown = 0;
    }
};

// ============================================================
//  音频驱动粒子生成
// ============================================================

/**
 * 音频驱动自动绘制：开启后画面随声音流动，无需手动画。
 * 持续发射：多频段驱动，每个频段独立生成粒子（低频大/暖、中频中/彩、高频小/冷）。
 * 节拍爆发：低音辐射、中音扩散、高音飞溅。
 * 直接 mutate particles 数组（文档化的有意耦合）。
 */
export function updateAudioPaint() {
    if (!state.audioMode || !audio.analyser) return;
    const energy = audio.bass * 1.2 + audio.mid * 0.6 + audio.treble * 0.3;

    // 频谱颜色映射：将频率数据映射到14色光谱
    const colors = audio.spectrumColors;
    const binCount = audio.data.length;
    const binsPerColor = Math.ceil(binCount / colors.length);

    // 持续发射：多频段驱动，每个频段独立生成粒子
    if (energy > 0.08) {
        audio.emitterAngle += 0.015 + audio.bass * 0.02;
        const ex = W / 2 + Math.cos(audio.emitterAngle) * W * 0.35;
        const ey = H / 2 + Math.sin(audio.emitterAngle * 1.3) * H * 0.35;

        // 按频段分层生成：低频暖色调（大粒子）、中频（中粒子）、高频冷色调（小粒子）
        const layers = [
            { start: 0, end: Math.floor(binCount * 0.15), sizeMul: 1.0, speedMul: 0.6, countMul: audio.bass },
            { start: Math.floor(binCount * 0.15), end: Math.floor(binCount * 0.5), sizeMul: 0.75, speedMul: 0.85, countMul: audio.mid },
            { start: Math.floor(binCount * 0.5), end: binCount, sizeMul: 0.5, speedMul: 1.1, countMul: audio.treble }
        ];

        layers.forEach(layer => {
            if (layer.countMul < 0.05) return;
            const bandCount = Math.min(6, Math.floor(layer.countMul * 8));
            for (let i = 0; i < bandCount; i++) {
                if (particles.length >= MAX_PARTICLES) return;
                // 从频段中随机选一个频率点获取颜色
                const binIdx = layer.start + Math.floor(rand(0, layer.end - layer.start));
                const colorIdx = Math.min(colors.length - 1, Math.floor(binIdx / binsPerColor));
                const [h, s, l] = colors[colorIdx];

                const p = acquire().reset(
                    ex + rand(-8, 8), ey + rand(-8, 8),
                    state.size * layer.sizeMul * (0.9 + rand(0.2, 0.4)),
                    state.speed * layer.speedMul * (0.8 + rand(0.3, 0.5)),
                    state.theme
                );
                p.h = (h + rand(-15, 15) + 360) % 360; p.targetH = p.h;
                p.s = clamp(s + rand(-10, 10), 50, 95); p.targetS = p.s;
                p.l = clamp(l + rand(-8, 8), 40, 80); p.targetL = p.l;
                p.alpha = 0.75 + layer.countMul * 0.3;
                p.decay *= 0.9;
                particles.push(p);
            }
        });
    }

    // 低音节拍爆发：鼓点时从中心向外辐射大粒子（暖色调）
    if (audio.bassBeat) {
        audio.bassBeat = false;
        const cx = W / 2 + rand(-W * 0.15, W * 0.15);
        const cy = H / 2 + rand(-H * 0.15, H * 0.15);
        const burstN = 10 + Math.floor(audio.beatStrength * 8);
        const baseSpeed = Math.max(0.3, state.speed);
        for (let i = 0; i < burstN; i++) {
            if (particles.length >= MAX_PARTICLES) break;
            const ang = (i / burstN) * Math.PI * 2 + rand(-0.15, 0.15);
            const speed = baseSpeed * (1.2 + audio.beatStrength * 2);
            const [h, s, l] = colors[Math.floor(rand(0, 4))]; // 暖色区域
            const p = acquire().reset(cx, cy, state.size * (1.5 + rand(0.3, 0.6)), baseSpeed, state.theme);
            p.vx = Math.cos(ang) * speed; p.vy = Math.sin(ang) * speed;
            p.h = (h + rand(-8, 8) + 360) % 360; p.targetH = p.h;
            p.s = clamp(s + rand(-5, 10), 75, 92); p.targetS = p.s;
            p.l = clamp(l + rand(-5, 15), 55, 75); p.targetL = p.l;
            p.alpha = 0.85;
            p.decay *= 1.2;
            particles.push(p);
        }
    }

    // 中音节拍爆发：旋律时生成中等粒子（彩色）
    if (audio.midBeat) {
        audio.midBeat = false;
        const mx = W * 0.2 + rand(0, W * 0.6);
        const my = H * 0.2 + rand(0, H * 0.6);
        const burstN = 7 + Math.floor(audio.beatStrength * 6);
        const baseSpeed = Math.max(0.3, state.speed);
        for (let i = 0; i < burstN; i++) {
            if (particles.length >= MAX_PARTICLES) break;
            const [h, s, l] = colors[Math.floor(rand(4, 10))]; // 中间色区域
            const p = acquire().reset(mx + rand(-10, 10), my + rand(-10, 10), state.size * (1.1 + rand(0.2, 0.4)), baseSpeed, state.theme);
            p.vx = rand(-1, 1) * baseSpeed * 1.2; p.vy = rand(-1, 1) * baseSpeed * 1.2;
            p.h = (h + rand(-12, 12) + 360) % 360; p.targetH = p.h;
            p.s = clamp(s + rand(-8, 8), 65, 90); p.targetS = p.s;
            p.l = clamp(l + rand(-5, 10), 50, 78); p.targetL = p.l;
            p.alpha = 0.78;
            p.decay *= 1.1;
            particles.push(p);
        }
    }

    // 高音节拍爆发：打击乐时生成小而亮的粒子（冷色调）
    if (audio.trebleBeat) {
        audio.trebleBeat = false;
        const tx = rand(0, W);
        const ty = rand(0, H);
        const burstN = 8 + Math.floor(audio.beatStrength * 7);
        const baseSpeed = Math.max(0.3, state.speed);
        for (let i = 0; i < burstN; i++) {
            if (particles.length >= MAX_PARTICLES) break;
            const [h, s, l] = colors[Math.floor(rand(10, colors.length))]; // 冷色区域
            const p = acquire().reset(tx + rand(-5, 5), ty + rand(-5, 5), state.size * (0.6 + rand(0.1, 0.3)), baseSpeed, state.theme);
            p.vx = rand(-1, 1) * baseSpeed * 1.5; p.vy = rand(-1, 1) * baseSpeed * 1.5;
            p.h = (h + rand(-10, 10) + 360) % 360; p.targetH = p.h;
            p.s = clamp(s + rand(-5, 15), 70, 95); p.targetS = p.s;
            p.l = clamp(l + rand(10, 20), 65, 88); p.targetL = p.l;
            p.alpha = 0.82;
            p.decay *= 1.3;
            particles.push(p);
        }
    }
}

// ============================================================
//  音频模式开关
// ============================================================

/** 激活音频模式：更新 UI 状态 + 显示频谱指示器。 */
export function activateAudio(label) {
    state.audioMode = true;
    audioBtn.classList.add('active-toggle');
    audioBtn.setAttribute('aria-pressed', 'true');
    audioRing.classList.add('active');
    if (meterCanvas) meterCanvas.style.opacity = '1';
    showToast('音频反应已开启 · ' + label, null);
    showToast('播放电脑音频，画面会随声音节奏流动', null);
}

/** 关闭音频模式：停止音频 + 重置 UI。自动识别演示/真实模式并清理对应资源。 */
export function deactivateAudio() {
    if (state.demoMode) {
        audio.stopDemo();
    } else {
        audio.stop();
    }
    state.audioMode = false;
    audioBtn.classList.remove('active-toggle');
    audioBtn.setAttribute('aria-pressed', 'false');
    audioRing.classList.remove('active');
    if (meterCanvas) meterCanvas.style.opacity = '0';
    showToast('音频反应已关闭', null);
}

/**
 * 切换音频模式开关。
 * 演示模式（state.demoMode）：调用 audio.startDemo()，Web Audio 合成伪频谱，无需共享系统音频。
 * 真实模式：唤起系统音频共享面板（getDisplayMedia）。
 * 关闭时调用 deactivateAudio。
 */
export function setAudioMode(on) {
    if (on) {
        if (state.demoMode) {
            // 演示模式：合成波形，无需用户授权
            const ok = audio.startDemo();
            if (ok) activateAudio('演示波形');
            else showToast('演示模式启动失败，请尝试真实音频', null);
        } else {
            // 先提示用户在共享面板如何操作，再唤起系统音频共享
            showToast('请在共享面板选「整个屏幕」或「浏览器标签」，并勾选「分享系统音频」', null);
            audio.startSystemAudio().then(ok => { if (ok) activateAudio('系统音频'); });
        }
    } else {
        deactivateAudio();
    }
}

/**
 * 音频文件回退：用于不支持 getDisplayMedia 的浏览器（在设置菜单中触发）。
 */
export function pickAudioFile() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'audio/*';
    input.onchange = () => {
        if (input.files[0]) {
            audio.startFile(input.files[0]).then(ok => { if (ok) activateAudio(audio.fileName); });
        }
    };
    input.click();
}

// ============================================================
//  合成音效
// ============================================================

/**
 * 合成音效对象（振荡器 + 增益包络）。
 * 落笔 tick / 主题切换 chime / 保存成功 success。
 */
export const sfx = {
    ctx: null,
    init() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); },
    play(freq, dur, type = 'sine', gain = 0.06) {
        if (!state.soundOn) return;
        this.init();
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = type; o.frequency.value = freq;
        g.gain.setValueAtTime(0, this.ctx.currentTime);
        g.gain.linearRampToValueAtTime(gain, this.ctx.currentTime + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
        o.connect(g); g.connect(this.ctx.destination);
        o.start(); o.stop(this.ctx.currentTime + dur);
    },
    tick() { this.play(600 + Math.random() * 200, 0.05, 'sine', 0.03); },
    chime() { this.play(880, 0.15, 'triangle', 0.05); setTimeout(() => this.play(1320, 0.2, 'triangle', 0.04), 60); },
    success() { this.play(523, 0.1, 'sine', 0.05); setTimeout(() => this.play(784, 0.2, 'sine', 0.05), 80); },
};
