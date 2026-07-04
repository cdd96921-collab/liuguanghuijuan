/**
 * particle.js — 粒子系统核心模块
 *
 * 职责：
 *   - 拥有 Canvas/2D 上下文及尺寸管理（W/H/DPR/resize）
 *   - 主题色板定义（THEMES）与颜色插值（getThemeColor）
 *   - 粒子类（Particle）、对象池（acquire/release/spawn）
 *   - 精灵图缓存（预渲染径向渐变 + 形状裁剪）
 *   - 自动流场（updateAuto）与 FPS 监控（tickFPS + 自动降级）
 *   - 渲染主循环（draw）—— 在循环内调用 audio.update/updateAudioPaint
 *   - 历史快照（undo/redo 栈，返回 {ok} 无 UI 副作用）
 *   - 清空备份/恢复、SVG 导出辅助
 *
 * 依赖：
 *   - util.js：lerp, rand, clamp, lerpHue
 *   - main.js：state（单例，live binding）
 *   - audio.js：audio（update/updateAudioPaint/bass，live binding）
 *   - layers.js：layerManager（图层合成与拖尾衰减）
 *
 * 循环依赖说明：
 *   particle ↔ audio、particle ↔ main 均为安全循环。
 *   particle → layers 为单向依赖（layers 无外部依赖）。
 *   所有跨模块绑定访问都在函数体内，不在顶层求值时读取。
 */

import { lerp, rand, clamp, lerpHue } from './util.js';
import { state } from './main.js';
import { audio, updateAudioPaint } from './audio.js';
import { layerManager } from './layers.js';

// ============================================================
//  主题色板
// ============================================================

/**
 * 5 套主题色板，每套包含 12-16 个 HSL 颜色点 + 背景色。
 * getThemeColor 在颜色点之间做线性插值（色相走最短弧）。
 */
export const THEMES = {
    rainbow: { colors: [[0,80,65],[25,82,68],[50,80,62],[75,78,60],[100,75,58],[125,70,55],[150,68,58],[175,72,65],[200,75,70],[225,78,68],[250,80,62],[275,78,58],[300,75,60],[325,72,65],[345,75,68],[358,78,65]], bg: '#0f0f14' },
    ocean: { colors: [[180,72,45],[190,70,50],[200,68,55],[210,65,60],[220,62,58],[230,60,55],[240,62,52],[250,65,48],[260,68,45],[270,70,42],[200,75,55],[215,72,60],[230,68,58],[185,70,48]], bg: '#08141e' },
    fire: { colors: [[0,85,55],[15,88,60],[30,90,65],[45,88,62],[60,85,58],[80,80,55],[100,75,52],[120,70,48],[25,90,58],[40,88,65],[55,85,60],[10,82,50]], bg: '#1a0e08' },
    aurora: { colors: [[120,68,50],[140,65,55],[160,62,60],[180,60,65],[200,62,62],[220,65,58],[240,68,52],[260,70,48],[130,65,48],[150,62,55],[170,60,62],[190,62,58],[210,65,52]], bg: '#081412' },
    candy: { colors: [[310,78,70],[325,80,72],[340,78,70],[355,75,68],[10,72,70],[25,70,72],[40,68,70],[55,70,68],[300,75,65],[315,78,68],[330,80,70],[345,75,65],[5,70,68]], bg: '#140e1a' },
    // Phase 7：自定义主题占位。colors 在运行时由 state.customTheme.colors 覆盖（AI 风格迁移写入）。
    custom: { colors: [[0,80,65],[60,85,58],[120,75,55],[180,72,60],[240,70,55],[300,78,62]], bg: '#0f0f14' },
};
export const LIGHT_BG = '#f5f0eb';

/**
 * 在主题色板上沿 t∈[0,1] 插值取色。
 * Phase 7：theme === 'custom' 且 state.customTheme 已设置时，使用 AI 生成的色板。
 * @returns {[number, number, number]} [h, s, l]
 */
export function getThemeColor(theme, t) {
    let p;
    if (theme === 'custom' && state.customTheme && state.customTheme.colors && state.customTheme.colors.length) {
        p = state.customTheme.colors;
    } else {
        p = THEMES[theme].colors;
    }
    const idx = t * (p.length - 1);
    const i0 = Math.floor(idx) % p.length;
    const i1 = (i0 + 1) % p.length;
    const f = idx - Math.floor(idx);
    const c0 = p[i0], c1 = p[i1];
    return [lerpHue(c0[0], c1[0], f), lerp(c0[1], c1[1], f), lerp(c0[2], c1[2], f)];
}

// ============================================================
//  Canvas 所有权
// ============================================================

export const canvas = document.getElementById('flowCanvas');
export const ctx = canvas.getContext('2d');

export let W = 0, H = 0, DPR = 1;
let wrapperEl = null;

/**
 * 初始化 Canvas：绑定 wrapper 元素，执行首次 resize，注册窗口监听。
 * 必须在 main.js init() 中调用。
 * @param {HTMLElement} wrapper 画布容器（#canvas-wrapper）
 */
export function initCanvas(wrapper) {
    wrapperEl = wrapper;
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
}

/** 根据 wrapper 尺寸重设 Canvas 分辨率（含 DPR 适配）。 */
export function resize() {
    if (!wrapperEl) return;
    const rect = wrapperEl.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(rect.width * DPR);
    canvas.height = Math.floor(rect.height * DPR);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    W = rect.width; H = rect.height;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // 同步图层尺寸（保留已有内容）。首次调用时 layerManager 尚未 init，跳过。
    if (layerManager.layers.length > 0) layerManager.resize(W, H, DPR);
}

// ============================================================
//  设备分级
// ============================================================

export const cores = navigator.hardwareConcurrency || 4;
export const isMobile = matchMedia('(max-width: 860px)').matches;
export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
export let MAX_PARTICLES = isMobile ? (cores >= 6 ? 1800 : 1200) : (cores >= 8 ? 3000 : 2000);

// ============================================================
//  精灵图缓存
// ============================================================

const SPRITE_COUNT = 18, SPRITE_SIZE = 64;
const spriteCache = {};

/**
 * 构建指定主题的精灵图数组（18 帧径向渐变 + 形状裁剪）。
 * 读取 state.shape 决定裁剪形状（circle 不裁剪，star/sparkle 裁剪）。
 */
function buildSprites(theme) {
    const sprites = [];
    for (let i = 0; i < SPRITE_COUNT; i++) {
        const t = i / (SPRITE_COUNT - 1);
        const [h, s, l] = getThemeColor(theme, t);
        const c = document.createElement('canvas');
        c.width = c.height = SPRITE_SIZE;
        const cx = c.getContext('2d');
        const r = SPRITE_SIZE / 2;
        const grad = cx.createRadialGradient(r, r, 0, r, r, r);
        grad.addColorStop(0, `hsla(${h},${s}%,${clamp(l+12,0,90)}%,0.9)`);
        grad.addColorStop(0.3, `hsla(${h},${s}%,${l}%,0.55)`);
        grad.addColorStop(0.7, `hsla(${h},${s}%,${l}%,0.12)`);
        grad.addColorStop(1, `hsla(${h},${s}%,${l}%,0)`);
        cx.fillStyle = grad;
        cx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
        // 形状裁剪：用纯白路径做 destination-in，保留形状内的光晕（circle 不裁剪）
        if (state.shape === 'star' || state.shape === 'sparkle') {
            cx.globalCompositeOperation = 'destination-in';
            cx.fillStyle = '#fff';
            if (state.shape === 'star') drawStarPath(cx, r, r, r * 0.95, r * 0.42, 5);
            else drawSparklePath(cx, r, r, r * 0.98, r * 0.16);
            cx.fill();
            cx.globalCompositeOperation = 'source-over';
        }
        sprites.push(c);
    }
    return sprites;
}

function drawStarPath(cx, x, y, outer, inner, points) {
    cx.beginPath();
    for (let i = 0; i < points * 2; i++) {
        const ang = (Math.PI / points) * i - Math.PI / 2;
        const rad = i % 2 === 0 ? outer : inner;
        const px = x + Math.cos(ang) * rad;
        const py = y + Math.sin(ang) * rad;
        if (i === 0) cx.moveTo(px, py); else cx.lineTo(px, py);
    }
    cx.closePath();
}

function drawSparklePath(cx, x, y, outer, inner) {
    cx.beginPath();
    const points = 4;
    for (let i = 0; i < points * 2; i++) {
        const ang = (Math.PI / points) * i - Math.PI / 2;
        const rad = i % 2 === 0 ? outer : inner;
        const px = x + Math.cos(ang) * rad;
        const py = y + Math.sin(ang) * rad;
        if (i === 0) cx.moveTo(px, py); else cx.lineTo(px, py);
    }
    cx.closePath();
}

/** 形状变化时重建所有主题精灵。 */
export function rebuildSpritesForShape() {
    Object.keys(THEMES).forEach(name => { spriteCache[name] = buildSprites(name); });
}

/**
 * 初始化精灵图缓存。必须在所有模块加载后（state 可用时）调用。
 */
export function initSprites() {
    rebuildSpritesForShape();
}

function getSprite(theme, h) {
    const arr = spriteCache[theme];
    return arr[Math.floor(((h % 360 + 360) % 360) / 360 * SPRITE_COUNT) % SPRITE_COUNT];
}

// ============================================================
//  粒子类与对象池
// ============================================================

export class Particle {
    constructor() { this.reset(0, 0, 2, 0.7, 'rainbow'); }
    reset(x, y, size, speed, theme, colorT = Math.random(), overrideColor = null, style = 'normal') {
        this.x = x; this.y = y;
        this.size = size * (0.6 + Math.random() * 0.8);
        this.speed = speed;
        this.style = style;
        
        let ang, v;
        switch (style) {
            case 'burst':
                ang = rand(0, Math.PI * 2);
                v = speed * (0.8 + Math.random() * 1.2);
                break;
            case 'spiral':
                ang = rand(0, Math.PI * 2);
                v = speed * (0.4 + Math.random() * 0.6);
                break;
            case 'wave':
                ang = Math.PI * 1.5 + rand(-0.3, 0.3);
                v = speed * (0.5 + Math.random() * 0.5);
                break;
            case 'explode':
                ang = rand(0, Math.PI * 2);
                v = speed * (1.5 + Math.random() * 1.5);
                break;
            case 'flow':
                ang = rand(-0.5, 0.5);
                v = speed * (0.3 + Math.random() * 0.4);
                break;
            case 'firework':
                ang = rand(0, Math.PI * 2);
                v = speed * (0.6 + Math.random() * 0.8);
                break;
            case 'shower':
                ang = Math.PI * 0.5 + rand(-0.5, 0.5);
                v = speed * (0.4 + Math.random() * 0.6);
                break;
            case 'vortex':
                ang = rand(0, Math.PI * 2);
                v = speed * (0.3 + Math.random() * 0.5);
                break;
            case 'laser':
                ang = rand(-0.1, 0.1);
                v = speed * (1.2 + Math.random() * 0.8);
                break;
            case 'glow':
                ang = rand(0, Math.PI * 2);
                v = speed * (0.2 + Math.random() * 0.3);
                break;
            default:
                ang = rand(0, Math.PI * 2);
                v = speed * (0.3 + Math.random() * 0.7);
        }
        
        this.vx = Math.cos(ang) * v; this.vy = Math.sin(ang) * v;
        this.colorT = colorT;
        if (overrideColor) {
            this.h = (overrideColor.h + rand(-6, 6) + 360) % 360;
            this.s = clamp(overrideColor.s + rand(-4, 4), 30, 95);
            this.l = clamp(overrideColor.l + rand(-6, 6), 25, 88);
        } else {
            const [h, s, l] = getThemeColor(theme, colorT);
            this.h = (h + rand(-8, 8) + 360) % 360;
            this.s = clamp(s + rand(-6, 6), 30, 95);
            this.l = clamp(l + rand(-8, 8), 25, 88);
        }
        this.targetH = this.h; this.targetS = this.s; this.targetL = this.l;
        this.life = 1.0;
        
        let baseDecay = 0.006 + Math.random() * 0.008;
        switch (style) {
            case 'burst': baseDecay *= 1.5; break;
            case 'explode': baseDecay *= 1.8; break;
            case 'firework': baseDecay *= 1.6; break;
            case 'shower': baseDecay *= 0.8; break;
            case 'glow': baseDecay *= 0.5; break;
            case 'laser': baseDecay *= 1.2; break;
        }
        this.decay = baseDecay * (0.5 + speed * 0.8);
        
        if (reducedMotion) this.decay *= 1.8;
        this.alpha = 0.5 + Math.random() * 0.3;
        const driftScale = Math.max(0.3, speed * 2);
        this.driftX = rand(-0.08, 0.08) * driftScale; this.driftY = rand(-0.08, 0.08) * driftScale;
        return this;
    }
    update() {
        switch (this.style) {
            case 'spiral':
                const spiralSpeed = 0.03;
                const angle = Math.atan2(this.vy, this.vx) + spiralSpeed;
                const mag = Math.hypot(this.vx, this.vy);
                this.vx = Math.cos(angle) * mag;
                this.vy = Math.sin(angle) * mag;
                break;
            case 'vortex':
                const vortexSpeed = 0.05;
                const vAngle = Math.atan2(this.vy, this.vx) + vortexSpeed;
                const vMag = Math.hypot(this.vx, this.vy) * 0.98;
                this.vx = Math.cos(vAngle) * vMag;
                this.vy = Math.sin(vAngle) * vMag;
                break;
            case 'wave':
                this.vx += Math.sin(this.y * 0.05) * 0.02;
                break;
        }
        
        this.x += this.vx + this.driftX; this.y += this.vy + this.driftY;
        const perturbScale = Math.max(0.2, this.speed * 1.5);
        this.vx += rand(-0.04, 0.04) * perturbScale; this.vy += rand(-0.04, 0.04) * perturbScale;
        this.vx *= 0.995; this.vy *= 0.995;
        const m = 30;
        if (this.x < -m || this.x > W + m || this.y < -m || this.y > H + m) this.life -= 0.05;
        this.life -= this.decay;
        if (this.life < 0) this.life = 0;
        this.h = lerpHue(this.h, this.targetH, 0.04);
        this.s = lerp(this.s, this.targetS, 0.04);
        this.l = lerp(this.l, this.targetL, 0.04);
    }
    draw(ctx) {
        const a = this.life * this.alpha * 0.7;
        if (a < 0.01) return;
        // 音频反应：低频 boost 大小（state/audio 在函数体内读取，live binding 安全）
        let sizeMul = 1;
        if (state.audioMode && audio.bass > 0) sizeMul = 1 + audio.bass * 0.8;
        const radius = this.size * (0.5 + 0.5 * this.life) * 2.0 * sizeMul;
        ctx.globalAlpha = a;
        ctx.drawImage(getSprite(state.theme, this.h), this.x - radius, this.y - radius, radius * 2, radius * 2);
    }
}

export let particles = [];
const pool = [];
let _dynamicBgH = 0, _dynamicBgS = 0, _dynamicBgL = 0;

/** 从对象池获取粒子（或新建）。 */
export function acquire() { return pool.pop() || new Particle(); }

/** 归还粒子到对象池。 */
export function release(p) { if (pool.length < MAX_PARTICLES) pool.push(p); }

/**
 * 在 (x, y) 生成 count 个粒子。
 * @param {number} count 单次上限 12
 * @param {{h:number,s:number,l:number}|null} overrideColor 吸管取色覆盖色（可选）
 * @param {string} style 粒子样式（normal/burst/spiral/wave/explode/flow/firework/shower/vortex/laser/glow）
 */
export function spawn(x, y, count, size, speed, theme, overrideColor = null, style = 'normal') {
    const n = Math.min(count, 12);
    for (let i = 0; i < n; i++) {
        if (particles.length >= MAX_PARTICLES) break;
        particles.push(acquire().reset(x + rand(-4, 4), y + rand(-4, 4), size * (0.6 + rand(0, 0.6)), speed * (0.5 + rand(0, 0.6)), theme, Math.random(), overrideColor, style));
    }
}

// ============================================================
//  流场（自动模式）
// ============================================================

function flowAngle(x, y, t) {
    const s = 0.0028;
    return ((Math.sin(x * s + t * 0.0004) + Math.cos(y * s * 1.3 - t * 0.0003)) * 0.7
        + Math.sin((x + y) * s * 0.6 + t * 0.0002) * 0.3) * Math.PI;
}

let autoTimer = 0;

/** 自动模式：定时在流场位置生成粒子。 */
export function updateAuto(dt, now) {
    if (!state.autoMode) return;
    autoTimer += dt;
    if (autoTimer > 80) {
        autoTimer = 0;
        const count = reducedMotion ? 2 : 4;
        for (let i = 0; i < count; i++) {
            if (particles.length >= MAX_PARTICLES) break;
            const x = rand(W * 0.1, W * 0.9), y = rand(H * 0.1, H * 0.9);
            const ang = flowAngle(x, y, now);
            const p = acquire().reset(x, y, state.size, state.speed * 0.9, state.theme);
            p.vx = Math.cos(ang) * state.speed; p.vy = Math.sin(ang) * state.speed;
            p.decay *= 0.7;
            particles.push(p);
        }
    }
}

// ============================================================
//  FPS 监控 + 自动降级
// ============================================================

const fps = { frames: 0, last: performance.now(), value: 60, lowCount: 0 };
let onFPSCallback = null;

/**
 * 注册 FPS 回调。main.js 注入：更新 fpsMonitor DOM + 降级 toast。
 * @param {(data: {fps:number, warn:boolean, bad:boolean, degraded:boolean}|null) => void} cb
 */
export function setOnFPS(cb) { onFPSCallback = cb; }

/**
 * FPS 采样（每 500ms 一次）。管理 MAX_PARTICLES 自动降级。
 * @returns {{fps:number, warn:boolean, bad:boolean, degraded:boolean, count:number, max:number}|null} 非采样窗口返回 null
 */
export function tickFPS(now) {
    fps.frames++;
    if (now - fps.last < 500) return null;
    fps.value = Math.round(fps.frames * 1000 / (now - fps.last));
    fps.frames = 0; fps.last = now;
    const warn = fps.value < 50 && fps.value >= 30;
    const bad = fps.value < 30;
    let degraded = false;
    // 持续低帧自动降级
    if (fps.value < 35) {
        fps.lowCount++;
        if (fps.lowCount >= 3 && MAX_PARTICLES > 800) {
            MAX_PARTICLES = Math.floor(MAX_PARTICLES * 0.75);
            fps.lowCount = 0;
            degraded = true;
        }
    } else fps.lowCount = 0;
    return { fps: fps.value, warn, bad, degraded, count: particles.length, max: MAX_PARTICLES };
}

// ============================================================
//  历史快照（撤销/重做）
// ============================================================

export const history = { undo: [], redo: [], max: 30 };

let historyChangeCB = null;

/** 注册历史变化回调（ui.js 订阅以更新按钮状态）。 */
export function setHistoryChangeCB(fn) { historyChangeCB = fn; }

function notifyHistoryChange() {
    if (historyChangeCB) historyChangeCB({ canUndo: history.undo.length > 0, canRedo: history.redo.length > 0 });
}

/** 截取当前合成画布为 PNG dataURL（通过 layerManager 合成所有图层）。 */
export function takeSnapshot() {
    return layerManager.snapshot();
}

/** 推入历史栈（笔触结束时调用）。 */
export function pushHistory() {
    history.undo.push(takeSnapshot());
    if (history.undo.length > history.max) history.undo.shift();
    history.redo = [];
    notifyHistoryChange();
}

/** 将 dataURL 恢复到活跃图层（清空其它图层）。 */
export function applySnapshot(dataURL) {
    return layerManager.restore(dataURL);
}

/**
 * 撤销。返回 {ok} 无 UI 副作用（main.js 负责提示）。
 */
export async function undo() {
    if (history.undo.length === 0) return { ok: false };
    history.redo.push(takeSnapshot());
    const snap = history.undo.pop();
    await applySnapshot(snap);
    // 撤销后清空活跃粒子，避免叠加
    while (particles.length > 0) release(particles.pop());
    notifyHistoryChange();
    return { ok: true };
}

/**
 * 重做。返回 {ok} 无 UI 副作用（main.js 负责提示）。
 */
export async function redo() {
    if (history.redo.length === 0) return { ok: false };
    history.undo.push(takeSnapshot());
    const snap = history.redo.pop();
    await applySnapshot(snap);
    while (particles.length > 0) release(particles.pop());
    notifyHistoryChange();
    return { ok: true };
}

/**
 * 跳转到撤销栈中指定位置（用于撤销预览点击）。
 * 重复 undo 直到 undo 栈长度等于 targetIndex，画布显示该步快照。
 * @param {number} targetIndex 目标 undo 栈剩余长度
 * @returns {Promise<boolean>} 是否执行了至少一次 undo
 */
export async function undoTo(targetIndex) {
    let did = false;
    while (history.undo.length > targetIndex && history.undo.length > 0) {
        await undo();
        did = true;
    }
    return did;
}

// ============================================================
//  色彩重定向（主题切换时平滑过渡）
// ============================================================

/** 主题切换时，将所有活跃粒子的目标色重设为新主题。 */
export function retargetColors(theme) {
    for (const p of particles) {
        const [h, s, l] = getThemeColor(theme, p.colorT);
        p.targetH = (h + rand(-8, 8) + 360) % 360;
        p.targetS = clamp(s + rand(-6, 6), 30, 95);
        p.targetL = clamp(l + rand(-8, 8), 25, 88);
    }
}

// ============================================================
//  渲染主循环
// ============================================================

let rafId = null, lastFrameTime = 0;

/**
 * 主渲染循环。每帧：
 *   1. 采样 FPS（回调通知 main.js 更新 DOM）
 *   2. 音频模式时更新频谱数据
 *   3. 拖尾衰减（作用于活跃图层，destination-out 透明衰减；保留模式跳过）
 *   4. 自动流场 + 音频驱动粒子生成
 *   5. 绘制所有粒子到活跃图层
 *   6. 主 canvas 填 bg → 合成所有图层
 *   7. 更新粒子状态 + 回收死亡粒子
 */
export function draw(now) {
    const dt = lastFrameTime ? (now - lastFrameTime) : 16;
    lastFrameTime = now;

    const fpsData = tickFPS(now);
    if (fpsData && onFPSCallback) onFPSCallback(fpsData);

    // 音频数据更新
    if (state.audioMode) audio.update();

    // 拖尾衰减：作用于活跃图层（destination-out 模式，更直接的透明擦除）
    // trail 参数直接映射到衰减强度，确保参数变化有明显视觉效果
    if (!state.preserveMode) {
        let trailA = state.trail;
        if (reducedMotion) trailA *= 2;
        const fadeAlpha = clamp(trailA * 2.5, 0.05, 0.9);
        layerManager.applyTrailFade(fadeAlpha);
    }

    updateAuto(dt, now);
    updateAudioPaint();

    // 绘制粒子到活跃图层
    const active = layerManager.getActive();
    if (active) {
        const actx = active.ctx;
        for (let i = 0; i < particles.length; i++) particles[i].draw(actx);
        actx.globalAlpha = 1;
    }

    // 动态背景平滑更新（放在绘制之前）
    if (state.dynamicBg && particles.length > 0) {
        let totalH = 0, totalS = 0, totalL = 0;
        const sampleCount = Math.min(30, particles.length);
        for (let i = 0; i < sampleCount; i++) {
            const p = particles[Math.floor(Math.random() * particles.length)];
            totalH += p.h;
            totalS += p.s;
            totalL += p.l;
        }
        const targetH = totalH / sampleCount;
        const targetS = Math.min(70, totalS / sampleCount + 15);
        const targetL = Math.max(6, Math.min(14, totalL / sampleCount * 0.2));
        
        const smoothFactor = Math.min(0.08 * (dt / 16), 0.3);
        _dynamicBgH = lerpHue(_dynamicBgH, targetH, smoothFactor);
        _dynamicBgS = lerp(_dynamicBgS, targetS, smoothFactor);
        _dynamicBgL = lerp(_dynamicBgL, targetL, smoothFactor);
    }
    
    // 主 canvas：填 bg → 合成所有可见图层
    const bgHex = state.bgDark ? THEMES[state.theme].bg : LIGHT_BG;
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    
    if (state.dynamicBg && particles.length > 0) {
        ctx.fillStyle = `hsl(${_dynamicBgH}, ${_dynamicBgS}%, ${_dynamicBgL}%)`;
    } else {
        ctx.fillStyle = bgHex;
    }
    
    ctx.fillRect(0, 0, W, H);
    layerManager.composite(ctx);
    ctx.globalAlpha = 1;
    
    recordFrameIfNeeded();

    // 更新 + 回收（末尾交换删除）
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.update();
        if (p.life <= 0) {
            const last = particles.pop();
            if (i < particles.length) particles[i] = last;
            release(p);
        }
    }

    rafId = requestAnimationFrame(draw);
}

let _timelineModule = null;
export function setTimelineModule(module) { _timelineModule = module; }

function recordFrameIfNeeded() {
    if (_timelineModule && _timelineModule.timeline && _timelineModule.timeline.isRecording) {
        _timelineModule.timeline.recordFrame(layerManager);
    }
}

/** 启动渲染循环。 */
export function startLoop() {
    if (!rafId) { lastFrameTime = 0; rafId = requestAnimationFrame(draw); }
}

/** 停止渲染循环。 */
export function stopLoop() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    lastFrameTime = 0;
}

/** 生成初始星尘粒子（启动时调用）。 */
export function spawnInitialDust(count) {
    for (let i = 0; i < count; i++) {
        const speed = rand(0.1, 0.4);
        const p = acquire().reset(rand(0, W), rand(0, H), rand(0.5, 2.0), speed, state.theme);
        p.life = rand(0.2, 0.6);
        p.decay = rand(0.006, 0.012) * (0.5 + speed * 0.8);
        particles.push(p);
    }
}

// ============================================================
//  清空 / 备份 / 恢复
// ============================================================

/**
 * 备份当前粒子 + 画布合成快照（用于清空撤销）。
 * @returns {{particles: Particle[], snap: string}|null}
 */
export function backupState() {
    return { particles: particles.slice(), snap: takeSnapshot() };
}

/**
 * 从备份恢复（清空撤销）。
 * @param {{particles: Particle[], snap: string}} backup
 */
export async function restoreState(backup) {
    particles = backup.particles;
    await applySnapshot(backup.snap);
}

/** 清空所有图层 + 主画布填 bg，清空历史栈。 */
export function clearCanvas() {
    particles = [];
    layerManager.clearAll();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = state.bgDark ? THEMES[state.theme].bg : LIGHT_BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    history.undo = []; history.redo = [];
    notifyHistoryChange();
}

/** 重置粒子数组（加载作品时使用）。 */
export function resetParticles() {
    while (particles.length > 0) release(particles.pop());
    history.undo = []; history.redo = [];
    notifyHistoryChange();
}

// ============================================================
//  SVG 导出辅助
// ============================================================

/**
 * 将当前粒子位置采样为 SVG 圆形集合并触发下载。
 * @returns {boolean} 恒为 true
 */
export function exportParticleSVG() {
    const sample = particles.filter(p => p.life > 0.3).slice(0, 800);
    const bgHex = state.bgDark ? THEMES[state.theme].bg : LIGHT_BG;
    let circles = '';
    for (const p of sample) {
        const r = p.size * (0.3 + 0.7 * p.life) * 2;
        circles += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="hsl(${p.h.toFixed(0)},${p.s.toFixed(0)}%,${p.l.toFixed(0)}%)" opacity="${(p.life * p.alpha).toFixed(2)}"/>`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${bgHex}"/>${circles}</svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `流光绘卷_${Date.now()}.svg`; link.href = url; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
}
