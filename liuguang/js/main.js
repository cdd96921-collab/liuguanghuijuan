/**
 * main.js — 编排中枢模块（入口）
 *
 * 职责：
 *   - 定义 state 单例（所有模块通过 import 共享同一引用）
 *   - 定义 SHAPES 常量
 *   - 输入处理（coords/startStroke/moveStroke/endStroke + canvas 事件绑定）
 *   - 编排函数（setTheme/cycleShape/clear/setBgDark/setAuto/setPreserve）
 *   - 保存/加载/导出编排（saveConfirm/loadArtwork/renameArtwork/deleteArtwork）
 *   - 撤销/重做包装（handleUndo/handleRedo，含 toast 提示）
 *   - 画廊打开（openGallery，调用 db.all + renderGallery）
 *   - init() 初始化序列（模块初始化 + 回调注入 + 事件绑定 + 启动循环）
 *   - 标签页可见性控制
 *   - 键盘快捷键
 *
 * 依赖：所有 5 个模块 + util.js
 *
 * 这是 HTML 中 <script type="module"> 引用的入口文件。
 */

import { lerp, clamp, rgbToHsl } from './util.js';
import {
    canvas, W, H, DPR, THEMES, LIGHT_BG,
    particles, MAX_PARTICLES, history,
    spawn, pushHistory, undo, redo, undoTo, retargetColors, rebuildSpritesForShape,
    initCanvas, initSprites, startLoop, stopLoop, spawnInitialDust,
    backupState, restoreState, clearCanvas, resetParticles,
    setOnFPS, setHistoryChangeCB, exportParticleSVG, setTimelineModule,
    cores, isMobile, reducedMotion,
} from './particle.js';
import { audio, sfx, setAudioMode, initAudio } from './audio.js';
import { db, makeThumb } from './storage.js';
import { layerManager, getDims } from './layers.js';
import { extractColors, generatePalettes, hslToRgb } from './colorAnalyzer.js';
import { timeline } from './timeline.js';
import {
    $, wrapper, hint,
    clearBtn, bgToggle, saveBtn, autoBtn, preserveBtn, audioBtn,
    shapeBtn, undoBtn, redoBtn, galleryBtn, diaryBtn, themeBtns,
    galleryDrawer, galleryOverlay, galleryBody, galleryBatchBtn,
    inspBtn, inspDrawer, inspOverlay, inspBody, inspCloseBtn,
    aiBtn, shareBtn,
    layerBtn,
    sizeSlider, speedSlider, densitySlider, trailSlider,
    sizeVal, speedVal, densityVal, trailVal,
    showToast, updateThemeUI, updateShapeBtn, updateHistoryButtons,
    setBgDarkUI, setAutoUI, setPreserveUI, applyColorBlind,
    openSaveModal, closeSaveModal, getSaveData,
    closeGallery, renderGallery, renderGallerySkeleton, renderGalleryEmpty,
    closeInspDrawer, renderInspirations,
    openAIModal, closeAIModal, setAILoading,
    openShareModal, closeShareModal, setShareCardPreview,
    openLayerPanel, closeLayerPanel, renderLayers,
    renderUndoPreview, openUndoPreview, closeUndoPreview, undoPreviewClose,
    toolBtns, toolBrush, toolEyedrop, toolEraser, toolText,
    zoomReset, importBtn,
    openDiary, startOnboard, hideSplash, onFPS,
    initUI,
    buildAudioStyleMenu, audioStyleMenu,
    showConfirm, closeConfirm, openShortcuts, closeShortcuts,
    positionMenu,
    setDynamicBgUI,
} from './ui.js';
import { INSPIRATIONS, getTodayChallenge, SHAPE_TEMPLATES, SHAPE_PRESETS } from './inspirations.js';
import { styleTransfer, analyzeEmotion } from './ai.js';
import { generateShareCard, exportWebM, isRecording } from './share.js';

// ============================================================
//  状态单例
// ============================================================

/**
 * 全局状态单例。所有模块通过 `import { state } from './main.js'` 共享。
 * 模块间通过 live binding 读取 state 的字段（不在顶层求值时读取）。
 */
export const state = {
    theme: 'rainbow', bgDark: true,
    size: 2.8, speed: 0.7, density: 8, trail: 0.10, eraserSize: 10,
    shape: 'circle', // circle | star | sparkle
    autoMode: false, preserveMode: false, audioMode: false,
    demoMode: false, // Phase 6.2：音频演示模式（Web Audio 合成伪频谱，无需共享系统音频）
    soundOn: false, colorBlind: 'normal', highContrast: false,
    activeLayerId: null, // 当前活跃图层 id（由 layerManager.init 设置）
    preset: 'medium', spray: false, // 画笔预设与喷枪散射
    tool: 'brush', // brush | eyedropper | eraser | text | pan
    zoom: 1, panX: 0, panY: 0, // 画布缩放与平移
    pickedColor: null, // 吸管取色覆盖色 {h,s,l}，null 时用主题色
    customTheme: null, // Phase 7：AI 风格迁移生成的自定义色板 {colors:[[h,s,l],...]}，theme==='custom' 时生效
    audioStyle: 'normal', // 音频反应粒子样式
    dynamicBg: false, // 动态背景效果
};

/** 粒子形状循环列表。 */
export const SHAPES = ['circle', 'star', 'sparkle'];

/** 音频反应粒子样式列表。 */
export const AUDIO_STYLES = [
    { id: 'normal', name: '普通', desc: '标准扩散' },
    { id: 'burst', name: '爆发', desc: '向外爆发' },
    { id: 'spiral', name: '螺旋', desc: '旋转扩散' },
    { id: 'wave', name: '波浪', desc: '波动前进' },
    { id: 'explode', name: '爆炸', desc: '剧烈爆炸' },
    { id: 'flow', name: '流动', desc: '向前流动' },
    { id: 'firework', name: '烟花', desc: '烟花绽放' },
    { id: 'shower', name: '淋浴', desc: '向下飘落' },
    { id: 'vortex', name: '漩涡', desc: '旋涡吸入' },
    { id: 'laser', name: '激光', desc: '直线冲刺' },
    { id: 'glow', name: '光晕', desc: '缓慢扩散' },
];

// ============================================================
//  状态持久化（localStorage）
// ============================================================

const STATE_KEY = 'liuguang_state_v5';
let _persistTimer = null;

/** 持久化 state 子集到 localStorage（debounce 500ms）。audioMode 不持久化（需用户手势）。 */
export function persistState() {
    if (_persistTimer) clearTimeout(_persistTimer);
    _persistTimer = setTimeout(() => {
        try {
            const s = {
                theme: state.theme, bgDark: state.bgDark,
                size: state.size, speed: state.speed, density: state.density, trail: state.trail,
                shape: state.shape,
                autoMode: state.autoMode, preserveMode: state.preserveMode,
                demoMode: state.demoMode,
                soundOn: state.soundOn,
                colorBlind: state.colorBlind, highContrast: state.highContrast,
                activeLayerId: state.activeLayerId,
                tool: state.tool, zoom: state.zoom, panX: state.panX, panY: state.panY,
            };
            localStorage.setItem(STATE_KEY, JSON.stringify(s));
        } catch (e) { /* 配额溢出或隐私模式，静默忽略 */ }
    }, 500);
}

/** 集中同步所有 UI 到 state（恢复或预设切换时调用）。 */
function syncUIFromState() {
    // 滑块值与数值文本
    sizeSlider.value = state.size; sizeVal.textContent = state.size.toFixed(1);
    speedSlider.value = state.speed; speedVal.textContent = state.speed.toFixed(1);
    densitySlider.value = state.density; densityVal.textContent = state.density;
    trailSlider.value = state.trail; trailVal.textContent = state.trail.toFixed(2);
    // 主题
    updateThemeUI(state.theme);
    // 形状
    updateShapeBtn(state.shape);
    rebuildSpritesForShape();
    // 背景明暗
    setBgDarkUI(state.bgDark);
    wrapper.style.background = state.bgDark ? THEMES[state.theme].bg : LIGHT_BG;
    // 自动 / 保留
    setAutoUI(state.autoMode);
    setPreserveUI(state.preserveMode);
    // 色盲滤镜
    applyColorBlind();
    // 高对比度
    document.body.classList.toggle('hc', state.highContrast);
    // 画笔预设高亮
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.toggle('active', b.dataset.preset === state.preset));
    // 工具高亮 + 光标
    if (toolBtns && toolBtns.length) {
        toolBtns.forEach(b => {
            const on = b.dataset.tool === state.tool;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        wrapper.style.cursor = TOOL_CURSORS[state.tool] || 'crosshair';
    }
    // 画布缩放/平移
    applyCanvasTransform();
}

/** 从 localStorage 恢复 state（谨慎合并，校验字段合法性）。 */
function restorePersistedState() {
    try {
        const raw = localStorage.getItem(STATE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        // 校验 theme / shape 合法性
        if (saved.theme && THEMES[saved.theme]) state.theme = saved.theme;
        if (saved.shape && SHAPES.includes(saved.shape)) state.shape = saved.shape;
        // 数值字段
        if (typeof saved.bgDark === 'boolean') state.bgDark = saved.bgDark;
        if (typeof saved.size === 'number') state.size = saved.size;
        if (typeof saved.speed === 'number') state.speed = saved.speed;
        if (typeof saved.density === 'number') state.density = saved.density;
        if (typeof saved.trail === 'number') state.trail = saved.trail;
        if (typeof saved.autoMode === 'boolean') state.autoMode = saved.autoMode;
        if (typeof saved.preserveMode === 'boolean') state.preserveMode = saved.preserveMode;
        if (typeof saved.demoMode === 'boolean') state.demoMode = saved.demoMode;
        if (typeof saved.soundOn === 'boolean') state.soundOn = saved.soundOn;
        if (typeof saved.colorBlind === 'string') state.colorBlind = saved.colorBlind;
        if (typeof saved.highContrast === 'boolean') state.highContrast = saved.highContrast;
        if (saved.activeLayerId && typeof saved.activeLayerId === 'number') state.activeLayerId = saved.activeLayerId;
        // 工具与缩放（Phase 4）
        if (typeof saved.tool === 'string' && TOOL_CURSORS[saved.tool]) state.tool = saved.tool;
        if (typeof saved.zoom === 'number') state.zoom = clamp(saved.zoom, 0.25, 4);
        if (typeof saved.panX === 'number') state.panX = saved.panX;
        if (typeof saved.panY === 'number') state.panY = saved.panY;
        syncUIFromState();
    } catch (e) { /* 解析失败，使用默认值 */ }
}

// ============================================================
//  输入处理
// ============================================================

const pointers = new Map();
const MOUSE_ID = -1;

// 手势识别状态（Phase 5.1）：双指轻点撤销 / 双指捏合缩放 / 单指长按吸管
const _gestureState = {
    pinchStartDist: 0,    // 双指落下时的初始距离
    pinchStartZoom: 1,    // 双指落下时的缩放
    twoFingerStart: 0,    // 双指落下时间戳
    twoFingerMoved: false, // 双指是否明显移动（用于区分轻点 vs 捏合）
    longPressTimer: null, // 单指长按计时器
    isPinching: false,    // 当前是否处于双指捏合中
};

function coords(cx, cy) {
    const r = canvas.getBoundingClientRect();
    // canvas 应用 CSS transform: translate(panX,panY) scale(zoom) origin 0 0
    // getBoundingClientRect 返回变换后的矩形，rect.left 已含 panX
    // 因此内部坐标 = (clientX - rect.left) / zoom
    const z = state.zoom || 1;
    return {
        x: (cx - r.left) / z,
        y: (cy - r.top) / z,
    };
}

function ensurePtr(id, x, y) {
    let p = pointers.get(id);
    if (!p) { p = { x, y, prevX: x, prevY: y, active: true, lastT: 0, tool: 'brush', startTime: 0 }; pointers.set(id, p); }
    return p;
}

function startStroke(id, x, y) {
    const p = ensurePtr(id, x, y);
    p.x = x; p.y = y; p.prevX = x; p.prevY = y; p.active = true; p.lastT = 0;
    p.tool = state.tool; // 锁定本次笔触的工具，避免中途切换造成混乱
    p.startX = x; p.startY = y; p.moved = false;
    p.startTime = performance.now();
    hint.classList.add('hidden');

    // 双指手势：第二指落下时进入手势模式，两指均不绘制
    if (pointers.size >= 2) {
        if (_gestureState.longPressTimer) { clearTimeout(_gestureState.longPressTimer); _gestureState.longPressTimer = null; }
        const pts = [...pointers.values()];
        _gestureState.pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        _gestureState.pinchStartZoom = state.zoom;
        _gestureState.twoFingerStart = performance.now();
        _gestureState.twoFingerMoved = false;
        _gestureState.isPinching = true;
        pts.forEach(pp => pp.active = false);
        return;
    }

    // 单指长按吸管（仅触控 + 画笔工具时，避免与其他工具冲突）
    if (id !== MOUSE_ID && state.tool === 'brush' && !_gestureState.longPressTimer) {
        const lx = x, ly = y;
        _gestureState.longPressTimer = setTimeout(() => {
            pickColor(lx, ly);
            p.active = false;
            _gestureState.longPressTimer = null;
        }, 600);
    }

    // 按工具分派
    if (p.tool === 'eyedropper') { pickColor(x, y); p.active = false; return; }
    if (p.tool === 'text') { placeText(x, y); p.active = false; return; }
    if (p.tool === 'eraser') { eraseAt(x, y); if (id !== MOUSE_ID && navigator.vibrate) navigator.vibrate(6); return; }
    if (p.tool === 'pan') { p._panStartX = state.panX; p._panStartY = state.panY; return; }

    // 默认画笔：音频反应中频增加 spawn 数
    let cnt = Math.max(2, Math.floor(state.density * 0.4));
    if (state.audioMode && audio.mid > 0) cnt += Math.floor(audio.mid * 4);
    cnt = Math.min(cnt, 12);
    const style = state.audioMode ? state.audioStyle : 'normal';
    spawn(x, y, cnt, state.size, state.speed, state.theme, state.pickedColor, style);
    if (id !== MOUSE_ID && navigator.vibrate) navigator.vibrate(8);
    if (state.soundOn) sfx.tick();
}

function moveStroke(id, x, y) {
    const p = pointers.get(id); if (!p) return;

    // 双指捏合缩放（优先级最高，2 指在场且处于手势模式）
    if (_gestureState.isPinching && pointers.size >= 2) {
        p.x = x; p.y = y;
        const pts = [...pointers.values()];
        const curDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (Math.abs(curDist - _gestureState.pinchStartDist) > 4) {
            _gestureState.twoFingerMoved = true;
            const midX = (pts[0].x + pts[1].x) / 2;
            const midY = (pts[0].y + pts[1].y) / 2;
            const newZoom = clamp(_gestureState.pinchStartZoom * (curDist / Math.max(1, _gestureState.pinchStartDist)), 0.25, 4);
            setZoom(newZoom, midX, midY);
        }
        return;
    }

    if (!p.active) return;
    p.prevX = p.x; p.prevY = p.y; p.x = x; p.y = y;
    const dx = x - p.prevX, dy = y - p.prevY, dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 2) p.moved = true;

    // 单指移动超阈值 → 取消长按吸管
    if (_gestureState.longPressTimer && Math.hypot(x - p.startX, y - p.startY) > 8) {
        clearTimeout(_gestureState.longPressTimer);
        _gestureState.longPressTimer = null;
    }

    // pan 工具：平移视图
    if (p.tool === 'pan') {
        // 用 startStroke 时记录的起点偏移推算平移（基于 pointer 移动量 * zoom）
        state.panX = p._panStartX + (x - p.startX) * state.zoom;
        state.panY = p._panStartY + (y - p.startY) * state.zoom;
        applyCanvasTransform();
        return;
    }
    // 橡皮擦：沿轨迹连续擦除
    if (p.tool === 'eraser') {
        const steps = Math.max(1, Math.floor(dist / 2));
        for (let i = 0; i < steps; i++) {
            const t = (i + 1) / steps;
            eraseAt(lerp(p.prevX, x, t), lerp(p.prevY, y, t));
        }
        return;
    }
    // 画笔：压感模拟（速度越快笔触越细，pressure ∈ [0.5, 1.0]）
    const now = performance.now();
    const dt = p.lastT ? Math.max(8, now - p.lastT) : 16;
    p.lastT = now;
    const velocity = dist / dt;
    const pressure = 1 - clamp(velocity / 8, 0, 0.5);
    const drawSize = state.size * pressure;
    const steps = Math.max(1, Math.floor(dist / 2));
    for (let i = 0; i < steps; i++) {
        const t = (i + 1) / steps;
        let sx = lerp(p.prevX, x, t), sy = lerp(p.prevY, y, t);
        // 喷枪模式：大范围散射
        if (state.spray) { sx += (Math.random() - 0.5) * 36; sy += (Math.random() - 0.5) * 36; }
        let cnt = Math.max(1, Math.floor(state.density * 0.5));
        if (state.spray) cnt = Math.max(1, Math.floor(cnt / 2));
        if (state.audioMode && audio.mid > 0) cnt += Math.floor(audio.mid * 3);
        cnt = Math.min(cnt, 20);
        const style = state.audioMode ? state.audioStyle : 'normal';
        spawn(sx, sy, cnt, drawSize, state.speed, state.theme, state.pickedColor, style);
    }
    if (dist > 20) {
        const style = state.audioMode ? state.audioStyle : 'normal';
        spawn(x, y, 3, drawSize * 0.8, state.speed * 0.8, state.theme, state.pickedColor, style);
    }
}

function endStroke(id) {
    const p = pointers.get(id); if (!p) return;

    // 清理长按计时
    if (_gestureState.longPressTimer) { clearTimeout(_gestureState.longPressTimer); _gestureState.longPressTimer = null; }

    const wasPinching = _gestureState.isPinching;
    const twoFingerDuration = performance.now() - _gestureState.twoFingerStart;

    p.active = false; pointers.delete(id);

    // 双指手势结束：剩余 < 2 指时判定
    if (wasPinching && pointers.size < 2) {
        _gestureState.isPinching = false;
        // 双指轻点 → 撤销（持续 < 200ms 且未明显移动）
        if (twoFingerDuration < 200 && !_gestureState.twoFingerMoved) {
            undo();
            if (navigator.vibrate) navigator.vibrate(10);
        }
        return;
    }

    // 橡皮擦/画笔笔触结束 → 推入历史栈
    if (p.tool === 'eraser' || (p.tool === 'brush' && state.preserveMode)) pushHistory();
    // 画笔结束补点
    if (p.tool === 'brush' && particles.length < MAX_PARTICLES - 20) {
        spawn(p.x, p.y, 3, state.size * 0.7, state.speed * 0.5, state.theme, state.pickedColor);
    }
}

// ============================================================
//  编排函数
// ============================================================

/** 切换主题：更新 state → 重定向粒子色彩 → 更新 UI → 音效。 */
function setTheme(theme) {
    if (theme === state.theme) return;
    state.theme = theme;
    if (state.bgDark) wrapper.style.background = THEMES[theme].bg;
    retargetColors(theme);
    updateThemeUI(theme);
    if (state.soundOn) sfx.chime();
    persistState();
}

/** 循环切换粒子形状：更新 state → 重建精灵图 → 更新按钮 → 提示。 */
function cycleShape() {
    const idx = SHAPES.indexOf(state.shape);
    state.shape = SHAPES[(idx + 1) % SHAPES.length];
    updateShapeBtn(state.shape);
    rebuildSpritesForShape();
    const names = { circle: '圆形', star: '星形', sparkle: '光点' };
    showToast('粒子形状：' + names[state.shape], null);
    persistState();
}

/** 切换背景明暗：更新 state → 更新 UI。 */
function setBgDark(dark) {
    state.bgDark = dark;
    setBgDarkUI(dark);
    persistState();
}

/** 切换自动模式：更新 state → 更新 UI → 提示。 */
function setAuto(on) {
    state.autoMode = on;
    setAutoUI(on);
    showToast(on ? '自动模式已开启' : '自动模式已关闭', null);
    persistState();
}

/** 切换保留路径：更新 state → 更新 UI → 提示。 */
function setPreserve(on) {
    state.preserveMode = on;
    setPreserveUI(on);
    showToast(on ? '路径保留已开启 · 轨迹不再消散' : '路径保留已关闭', null);
    persistState();
}

/** 切换动态背景：更新 state → 更新 UI → 提示。 */
function setDynamicBg(on) {
    state.dynamicBg = on;
    setDynamicBgUI(on);
    showToast(on ? '动态背景已开启 · 背景随粒子颜色变化' : '动态背景已关闭', null);
    persistState();
}

// ============================================================
//  画笔预设（需求 3）
// ============================================================

/** 4 套画笔预设：细笔/中笔/粗笔/喷枪。喷枪额外散射。 */
const PRESETS = {
    fine:   { size: 1.5, speed: 0.5, density: 5, trail: 0.05, label: '细笔', scatter: false },
    medium: { size: 2.8, speed: 0.7, density: 10, trail: 0.12, label: '中笔', scatter: false },
    coarse: { size: 4.5, speed: 1.0, density: 16, trail: 0.25, label: '粗笔', scatter: false },
    spray:  { size: 3.0, speed: 0.4, density: 6, trail: 0.08, label: '喷枪', scatter: true },
};

/** 应用画笔预设：更新 state → 同步 UI → 高亮按钮 → 持久化。 */
function applyPreset(name) {
    const p = PRESETS[name]; if (!p) return;
    Object.assign(state, {
        size: p.size, speed: p.speed, density: p.density, trail: p.trail,
        preset: name, spray: p.scatter,
    });
    syncUIFromState();
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.toggle('active', b.dataset.preset === name));
    showToast('画笔：' + p.label, null);
    persistState();
}

// ============================================================
//  工具集（需求 7 吸管、18 画布工具）
// ============================================================

const TOOL_CURSORS = { brush: 'crosshair', eyedropper: 'copy', eraser: 'cell', text: 'text', pan: 'grab' };

/** 切换当前工具：更新 state → 高亮按钮 → 光标 → 持久化。 */
function setTool(name) {
    if (!TOOL_CURSORS[name]) return;
    state.tool = name;
    toolBtns.forEach(b => {
        const on = b.dataset.tool === name;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    wrapper.style.cursor = TOOL_CURSORS[name];
    persistState();
}

/** 吸管：从活跃图层取像素 → HSL → state.pickedColor → 切回画笔。 */
function pickColor(x, y) {
    const layer = layerManager.getActive();
    if (!layer) return;
    const dpr = getDims().dpr || 1;
    const px = Math.floor(x * dpr), py = Math.floor(y * dpr);
    let data;
    try { data = layer.ctx.getImageData(px, py, 1, 1).data; }
    catch (e) { showToast('取色失败（跨域受限）', null); return; }
    if (data[3] < 10) { showToast('该位置无颜色，请从已绘制区域取色', null); return; }
    const [h, s, l] = rgbToHsl(data[0], data[1], data[2]);
    state.pickedColor = { h, s, l };
    showToast(`已取色 HSL(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%) · 已切回画笔`, null);
    setTool('brush');
}

/** 橡皮擦：在活跃图层用 destination-out 圆形擦除。半径与粒子大小相关。 */
function eraseAt(x, y) {
    const layer = layerManager.getActive();
    if (!layer) return;
    const cx = layer.ctx;
    cx.save();
    cx.globalCompositeOperation = 'destination-out';
    cx.beginPath();
    cx.arc(x, y, Math.max(2, state.eraserSize), 0, Math.PI * 2);
    cx.fillStyle = 'rgba(0,0,0,1)';
    cx.fill();
    cx.restore();
}

/** 文字标注：在画布坐标处创建 inline input，Enter 提交后 fillText 到活跃图层。 */
function placeText(x, y) {
    if (document.querySelector('.text-input-field')) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'text-input-field';
    input.placeholder = '输入文字 · Enter 确认 / Esc 取消';
    
    const r = canvas.getBoundingClientRect();
    const screenX = r.left + x * state.zoom;
    const screenY = r.top + y * state.zoom;
    
    Object.assign(input.style, {
        position: 'fixed',
        left: Math.max(10, Math.min(screenX, window.innerWidth - 160)) + 'px',
        top: Math.max(10, Math.min(screenY, window.innerHeight - 40)) + 'px',
        zIndex: '9999',
        background: 'rgba(0,0,0,0.9)',
        color: '#ffffff',
        border: '2px solid var(--accent-border)',
        borderRadius: '6px',
        padding: '8px 12px',
        fontSize: Math.max(16, Math.round(state.size * 8)) + 'px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        minWidth: '160px',
        maxWidth: '300px',
        outline: 'none',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        pointerEvents: 'auto',
        userSelect: 'text',
        WebkitUserSelect: 'text',
    });
    document.body.appendChild(input);
    setTimeout(() => {
        input.focus();
        input.select();
    }, 50);
    
    let committed = false;
    const commit = () => {
        if (committed) return; committed = true;
        const txt = input.value.trim();
        if (txt) {
            const layer = layerManager.getActive();
            if (layer) {
                const cx = layer.ctx;
                cx.save();
                cx.fillStyle = state.pickedColor
                    ? `hsl(${state.pickedColor.h},${state.pickedColor.s}%,${state.pickedColor.l}%)`
                    : '#ffffff';
                cx.font = `${Math.max(16, state.size * 8)}px system-ui, -apple-system, sans-serif`;
                cx.textBaseline = 'top';
                cx.fillText(txt, x, y);
                cx.restore();
                pushHistory();
            }
        }
        input.remove();
    };
    
    const handleKeydown = e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { committed = true; input.remove(); }
    };
    
    input.addEventListener('keydown', handleKeydown);
    input.addEventListener('blur', () => {
        setTimeout(() => {
            if (!committed) commit();
        }, 150);
    });
}

/** 导入图片：文件选择 → 新建图层（置底）→ 居中等比绘制。 */
function importImage() {
    const f = document.createElement('input');
    f.type = 'file'; f.accept = 'image/*';
    f.onchange = () => {
        const file = f.files[0];
        if (!file) return;
        const img = new Image();
        img.onload = () => {
            const layer = layerManager.add('导入图片');
            if (!layer) { showToast('图层已满（上限 8 层）', null); return; }
            // 移到最底（index 0）作为参考/临摹层
            const idx = layerManager.layers.indexOf(layer);
            if (idx > 0) {
                layerManager.layers.splice(idx, 1);
                layerManager.layers.unshift(layer);
            }
            // 居中绘制（按画布尺寸等比缩放）
            const { w: cw, h: ch } = getDims();
            const cx = layer.ctx;
            const scale = Math.min(cw / img.width, ch / img.height);
            const dw = img.width * scale, dh = img.height * scale;
            cx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
            layerManager._notify();
            URL.revokeObjectURL(img.src);
            showToast('图片已导入为新图层（置底）', null);
        };
        img.onerror = () => showToast('图片加载失败', null);
        img.src = URL.createObjectURL(file);
    };
    f.click();
}

// ============================================================
//  画布缩放与平移（需求 18 画布放大缩小）
// ============================================================

/** 应用 state.zoom/panX/panY 到 canvas 的 CSS transform。 */
function applyCanvasTransform() {
    canvas.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    canvas.style.transformOrigin = '0 0';
}

/** 设置缩放（钳制 0.25–4），以指定画布坐标为缩放中心。 */
function setZoom(newZoom, centerX, centerY) {
    newZoom = clamp(newZoom, 0.25, 4);
    if (newZoom === state.zoom) return;
    // 保持 centerX/Y 在屏幕上不动：调整 panX/panY
    // 屏幕位置 = panX + center * zoom（相对 wrapper）
    // 缩放后：panX' + center * newZoom = panX + center * zoom
    if (typeof centerX === 'number' && typeof centerY === 'number') {
        state.panX = state.panX + centerX * (state.zoom - newZoom);
        state.panY = state.panY + centerY * (state.zoom - newZoom);
    }
    state.zoom = newZoom;
    applyCanvasTransform();
    persistState();
}

/** 重置缩放与平移到初始状态。 */
function resetZoom() {
    state.zoom = 1; state.panX = 0; state.panY = 0;
    applyCanvasTransform();
    showToast('已重置缩放', null);
    persistState();
}

/** 撤销包装：调用 particle.undo() + toast。 */
async function handleUndo() {
    const result = await undo();
    if (result.ok) showToast('已撤销', null);
}

/** 重做包装：调用 particle.redo() + toast。 */
async function handleRedo() {
    const result = await redo();
    if (result.ok) showToast('已重做', null);
}

// ============================================================
//  清空（含 5 秒撤销窗口）
// ============================================================

let clearBackup = null, clearTimer = null;

function _hasVisibleContent() {
    if (particles.length > 0) return true;
    if (history.undo.length > 0) return true;
    for (const layer of layerManager.layers) {
        if (!layer.visible) continue;
        const imageData = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
        for (let i = 3; i < imageData.data.length; i += 4) {
            if (imageData.data[i] > 0) return true;
        }
    }
    return false;
}

function handleClear() {
    if (!_hasVisibleContent()) { showToast('画布已是空的', null); return; }
    showConfirm('确认清空', '确定要清空画布吗？此操作可以撤销。', () => {
        clearBackup = backupState();
        clearCanvas();
        showToast('已清空画布', '↩ 撤销', async () => {
            await restoreState(clearBackup);
            clearBackup = null; clearTimeout(clearTimer);
            showToast('已恢复', null);
        });
        clearTimeout(clearTimer);
        clearTimer = setTimeout(() => { clearBackup = null; }, 5000);
        persistState();
    });
}

// ============================================================
//  保存 / 加载 / 画廊
// ============================================================

/** 保存确认：截取画布 → 生成缩略图 → 写入 IndexedDB → 下载 PNG → 提示。 */
async function handleSaveConfirm() {
    const data = getSaveData();
    const dataURL = canvas.toDataURL('image/png');
    const thumb = makeThumb();
    const artwork = {
        name: data.name, dataURL, thumb, mood: data.mood, note: data.note,
        tags: data.tags,
        createdAt: Date.now(), theme: state.theme
    };
    try {
        await db.add('artworks', artwork);
        // 同步写入日记
        await db.add('diary', { date: Date.now(), mood: data.mood, note: data.note, thumb, name: data.name });
        closeSaveModal();
        showToast('已保存到作品库', null);
        if (state.soundOn) sfx.success();
        // Phase 5.2：保存成功动画 — 画布闪白 0.2s + 粒子向四周扩散庆祝
        wrapper.classList.add('flash');
        setTimeout(() => wrapper.classList.remove('flash'), 200);
        const cx = W / 2, cy = H / 2;
        for (let i = 0; i < 30; i++) {
            const ang = (i / 30) * Math.PI * 2;
            const r = 40 + Math.random() * 30;
            spawn(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, 2, state.size * 1.2, state.speed * 1.8, state.theme, state.pickedColor);
        }
        // 同时触发 PNG 下载
        const link = document.createElement('a');
        link.download = `${data.name}.png`; link.href = dataURL; link.click();
    } catch (e) {
        showToast('保存失败：' + (e.message || '未知错误'), null);
    }
}

/** 当前画廊激活的筛选标签（null = 全部）。点击 chip 时更新并重渲染。 */
let _galleryActiveTag = null;
/** Phase 6.1：批量选择模式状态。 */
let _gallerySelectMode = false;
let _gallerySelected = new Set();
/** 缓存当前画廊展示的作品列表，供批量操作复用。 */
let _galleryItems = [];

/** Phase 6.3：空状态 CTA「试试示例作品」→ 打开灵感画廊。 */
function loadSampleArtwork() {
    closeGallery();
    openInspDrawer();
}

/** 打开画廊：加载作品列表 → 计算所有标签 → 按激活标签筛选 → 渲染网格。支持批量选择模式。 */
async function openGallery() {
    galleryDrawer.classList.add('show');
    galleryOverlay.classList.add('show');
    renderGallerySkeleton();
    try {
        const all = await db.all('artworks');
        if (all.length === 0) {
            _galleryItems = [];
            renderGalleryEmpty(loadSampleArtwork);
            return;
        }
        // 汇总所有作品的标签（去重排序），用于顶部 chips
        const tags = [...new Set(all.flatMap(it => it.tags || []))].sort();
        // 按激活标签筛选展示项
        const items = _galleryActiveTag ? all.filter(it => (it.tags || []).includes(_galleryActiveTag)) : all;
        _galleryItems = items;
        renderGallery(items, buildGalleryHandlers(), tags, _galleryActiveTag, {
            selectMode: _gallerySelectMode,
            selected: _gallerySelected,
        });
    } catch (e) {
        galleryBody.innerHTML = '<div class="gallery-empty">加载失败</div>';
    }
}

/** 构建画廊回调集合（普通模式 + 批量模式统一入口）。 */
function buildGalleryHandlers() {
    return {
        onLoad: loadArtwork,
        onRename: renameArtwork,
        onDelete: deleteArtwork,
        onFilter: (tag) => { _galleryActiveTag = tag; openGallery(); },
        onToggleSelect: (id) => {
            if (_gallerySelected.has(id)) _gallerySelected.delete(id);
            else _gallerySelected.add(id);
            _rerenderGallery();
        },
        onBatchDelete: batchDeleteArtworks,
        onExitSelect: exitGallerySelect,
        onSelectAll: () => {
            if (_gallerySelected.size === _galleryItems.length) {
                _gallerySelected.clear();
            } else {
                _gallerySelected = new Set(_galleryItems.map(it => it.id));
            }
            _rerenderGallery();
        },
    };
}

/** 重渲染画廊（保留当前筛选/批量模式状态）。 */
function _rerenderGallery() {
    const tags = [...new Set(_galleryItems.flatMap(it => it.tags || []))].sort();
    renderGallery(_galleryItems, buildGalleryHandlers(), tags, _galleryActiveTag, {
        selectMode: _gallerySelectMode,
        selected: _gallerySelected,
    });
}

/** 进入批量选择模式。 */
function enterGallerySelect() {
    _gallerySelectMode = true;
    _gallerySelected.clear();
    _rerenderGallery();
}

/** 退出批量选择模式。 */
function exitGallerySelect() {
    _gallerySelectMode = false;
    _gallerySelected.clear();
    _rerenderGallery();
}

/** Phase 6.1：批量删除选中作品。 */
async function batchDeleteArtworks() {
    if (_gallerySelected.size === 0) return;
    if (!confirm(`确认删除选中的 ${_gallerySelected.size} 幅作品？此操作不可撤销。`)) return;
    try {
        for (const id of _gallerySelected) {
            await db.del('artworks', id);
        }
        showToast(`已删除 ${_gallerySelected.size} 幅作品`, null);
        _gallerySelected.clear();
        _gallerySelectMode = false;
        openGallery(); // 重新加载
    } catch (e) {
        showToast('批量删除失败：' + (e.message || '未知错误'), null);
    }
}

/** 加载作品到活跃图层：恢复图片 → 重置粒子 → 开启保留模式。 */
async function loadArtwork(id) {
    const items = await db.all('artworks');
    const it = items.find(x => x.id === id);
    if (!it) return;
    await layerManager.restore(it.dataURL);
    resetParticles();
    state.preserveMode = true;
    setPreserveUI(true);
    closeGallery();
    showToast(`已加载：${it.name}`, null);
}

/** 重命名作品。 */
async function renameArtwork(id, el) {
    const items = await db.all('artworks');
    const it = items.find(x => x.id === id);
    if (!it) return;
    const name = prompt('重命名作品：', it.name);
    if (name && name.trim()) {
        it.name = name.trim();
        await db.update('artworks', it);
        openGallery();
    }
}

/** 删除作品。 */
async function deleteArtwork(id, el) {
    if (!confirm('确认删除这幅作品？')) return;
    await db.del('artworks', id);
    el.remove();
    showToast('已删除', null);
}

// ============================================================
//  灵感画廊编排（Phase 6.3）
// ============================================================

/** 打开灵感画廊抽屉：渲染 12 套预设缩略图。 */
function openInspDrawer() {
    if (!inspDrawer) return;
    inspDrawer.classList.add('show');
    inspOverlay.classList.add('show');
    renderInspirations(loadInspiration);
}

/**
 * 加载灵感预设到当前画布：套用主题/形状/参数，重置粒子，开启保留模式。
 * 如果预设包含形状模板，则在画布上绘制模板轮廓作为引导。
 * @param {Object} preset 预设对象（来自 INSPIRATIONS 或 SHAPE_PRESETS）
 */
function loadInspiration(preset) {
    if (!preset) return;
    state.theme = preset.theme;
    state.shape = preset.shape;
    state.size = preset.size;
    state.speed = preset.speed;
    state.density = preset.density;
    state.trail = preset.trail;
    syncUIFromState();
    resetParticles();
    state.preserveMode = true;
    setPreserveUI(true);
    
    // 如果有形状模板，绘制模板轮廓作为引导
    if (preset.template && SHAPE_TEMPLATES[preset.template]) {
        drawShapeTemplate(preset.template);
    }
    
    closeInspDrawer();
    persistState();
    showToast(`已套用灵感：${preset.name}`, null);
    hint.classList.add('hidden');
}

/**
 * 在画布上绘制形状模板轮廓作为引导。
 * 使用临时透明图层显示模板，用户绘制时会覆盖它。
 * @param {string} templateName 模板名称（如 'sun', 'moon'）
 */
function drawShapeTemplate(templateName) {
    const template = SHAPE_TEMPLATES[templateName];
    if (!template) return;
    
    const layer = layerManager.getActive();
    if (!layer) return;
    
    const cx = layer.ctx;
    const { W, H } = getDims();
    
    cx.save();
    cx.globalAlpha = 0.3;
    cx.strokeStyle = 'rgba(255,255,255,0.5)';
    cx.lineWidth = 2;
    
    const scale = Math.min(W, H) * 0.35;
    cx.translate(W / 2, H / 2);
    cx.scale(scale / 100, scale / 100);
    
    const path = new Path2D(template.path);
    cx.stroke(path);
    cx.restore();
}

// ============================================================
//  AI 创作编排（Phase 7.1）
// ============================================================

/** 应用 AI 风格迁移结果：写入 customTheme + 切换到 custom 主题 + 套用参数。 */
function applyStyleResult(result) {
    state.customTheme = { colors: result.colors };
    state.theme = 'custom';
    state.size = result.size;
    state.speed = result.speed;
    state.density = result.density;
    state.trail = result.trail;
    syncUIFromState();
    // 切换主题后重新着色现有粒子 + 重建精灵图（custom 主题用新色板）
    retargetColors('custom');
    rebuildSpritesForShape();
    persistState();
    showToast(`AI 风格已应用 · ${result.colors.length} 色调色板`, null);
}

/** AI 风格迁移：读取用户选择的图片 → 调用 AI → 应用结果。 */
async function handleAIStyleTransfer() {
    const fileInput = $('aiStyleFile');
    const file = fileInput && fileInput.files[0];
    if (!file) { showToast('请先选择图片', null); return; }
    setAILoading(true);
    try {
        const result = await styleTransfer(file);
        applyStyleResult(result);
        closeAIModal();
    } catch (e) {
        showToast('AI 分析失败：' + (e.message || '未知错误'), null);
    } finally {
        setAILoading(false);
    }
}

/** AI 情绪识别：读取输入文本 → 调用 AI → 切换主题。 */
async function handleAIEmotion() {
    const text = $('aiEmotionText').value.trim();
    if (!text) { showToast('请输入心情文字', null); return; }
    setAILoading(true);
    try {
        const theme = await analyzeEmotion(text);
        setTheme(theme);
        const labelMap = { rainbow: '彩虹', ocean: '海洋', fire: '火焰', aurora: '极光', candy: '糖果' };
        showToast(`AI 识别情绪 · 已切换到「${labelMap[theme] || theme}」主题`, null);
        closeAIModal();
    } catch (e) {
        showToast('AI 分析失败：' + (e.message || '未知错误'), null);
    } finally {
        setAILoading(false);
    }
}

// ============================================================
//  分享导出编排（Phase 7.2）
// ============================================================

/** 获取当前画布快照作为「作品」对象（用于分享卡片）。 */
function _getCurrentSnapshot() {
    const dataURL = canvas.toDataURL('image/png');
    return { name: '流光即景', dataURL, thumb: dataURL };
}

/** 生成分享卡片：当前画布快照 + 署名 → 卡片预览。 */
async function handleShareCard() {
    const artist = $('shareArtist').value.trim() || '匿名';
    try {
        const artwork = _getCurrentSnapshot();
        const dataURL = await generateShareCard(artwork, artist);
        setShareCardPreview(dataURL);
        showToast('分享卡片已生成', null);
    } catch (e) {
        showToast('卡片生成失败：' + (e.message || '未知错误'), null);
    }
}

/** 导出 WebM 动画：录制当前画布 10 秒。 */
async function handleShareWebM() {
    if (isRecording()) { showToast('正在录制中，请稍候', null); return; }
    closeShareModal();
    await exportWebM(10);
}

// ============================================================
//  图层编排
// ============================================================

/** 图层面板操作回调集合（供 ui.renderLayers 调用）。 */
const layerHandlers = {
    onSelect: (id) => { layerManager.setActive(id); state.activeLayerId = id; },
    onToggleVisible: (id) => { layerManager.setVisible(id, !layerManager.layers.find(l => l.id === id).visible); },
    onOpacity: (id, v) => { layerManager.setOpacity(id, v); },
    onBlendMode: (id, mode) => { layerManager.setBlendMode(id, mode); },
    onAdd: () => {
        const l = layerManager.add();
        if (l) { state.activeLayerId = l.id; showToast('已新建图层', null); }
        else showToast('已达图层上限（8 层）', null);
    },
    onRemove: (id) => {
        if (layerManager.remove(id)) {
            state.activeLayerId = layerManager.getActive().id;
            showToast('已删除图层', null);
        } else showToast('至少保留一个图层', null);
    },
    onMove: (id, dir) => { layerManager.move(id, dir); },
    onRename: (id, name) => { layerManager.rename(id, name); },
    onMerge: () => { layerManager.mergeAll(); showToast('已合并所有图层', null); },
};

/** 图层变化回调：刷新图层面板（若打开）+ 同步 state.activeLayerId。 */
function onLayerChange(snap) {
    state.activeLayerId = snap.activeId;
    if (layerDrawerOpen) renderLayers(snap, layerHandlers);
}

let layerDrawerOpen = false;

/** 打开图层面板。 */
function openLayerPanelOrch() {
    layerDrawerOpen = true;
    renderLayers(layerManager.getSnapshot(), layerHandlers);
    openLayerPanel();
}

/** 关闭图层面板。 */
function closeLayerPanelOrch() {
    layerDrawerOpen = false;
    closeLayerPanel();
}

// ============================================================
//  撤销历史预览编排
// ============================================================

let undoPreviewOpen = false;
const undoPreviewHandlers = {
    onUndoTo: async (targetIndex) => {
        const did = await undoTo(targetIndex);
        if (did) { showToast('已跳转', null); refreshUndoPreview(); }
    },
    onRedoTo: async (targetIndex) => {
        let did = false;
        while (history.redo.length >= targetIndex && history.redo.length > 0) {
            const r = await redo();
            if (!r.ok) break;
            did = true;
        }
        if (did) { showToast('已重做', null); refreshUndoPreview(); }
    },
};

/** 刷新撤销预览（仅当面板打开时）。 */
function refreshUndoPreview() {
    if (undoPreviewOpen) renderUndoPreview(undoPreviewHandlers);
}

/** 打开撤销预览面板。 */
function openUndoPreviewOrch() {
    undoPreviewOpen = true;
    renderUndoPreview(undoPreviewHandlers);
    openUndoPreview();
}

/** 关闭撤销预览面板。 */
function closeUndoPreviewOrch() {
    undoPreviewOpen = false;
    closeUndoPreview();
}

/** 历史变化回调：更新按钮 + 刷新预览（若打开）。 */
function onHistoryChange(state2) {
    updateHistoryButtons(state2);
    refreshUndoPreview();
}

// ============================================================
//  初始化
// ============================================================

/**
 * 应用初始化入口。在 DOM 加载完成后调用（type="module" 隐式 defer）。
 * 执行顺序：
 *   1. 存储初始化（IndexedDB）
 *   2. 粒子模块初始化（Canvas + 精灵图）
 *   3. 音频模块初始化（频谱指示器）
 *   4. UI 模块初始化（事件绑定）
 *   5. 回调注入（FPS + 历史变化）
 *   6. 编排事件绑定（主题/形状/清空/模式/保存/画廊/日记/输入/键盘）
 *   7. 启动渲染循环 + 初始星尘
 *   8. 启动页 + 引导 + 提示定时器
 *   9. 标签页可见性监听
 */
export function init() {
    // file:// 协议警告
    if (location.protocol === 'file:') {
        console.warn('⚠ ES Modules 需要 HTTP 服务器运行。请使用 python -m http.server 或 npx serve。');
    }

    // 1. 存储初始化
    db.init().catch(e => console.warn('IndexedDB 初始化失败：', e));

    // 2. 粒子模块初始化
    initCanvas(wrapper);
    initSprites();
    // 图层管理器初始化（在 initCanvas 之后，此时 W/H/DPR 已就绪）
    layerManager.init(W, H, DPR);
    state.activeLayerId = layerManager.getActive().id;

    // 3. 音频模块初始化
    initAudio(wrapper);

    // 4. UI 模块初始化
    initUI();

    // 5. 回调注入
    setOnFPS(onFPS);
    setHistoryChangeCB(onHistoryChange);
    layerManager.setChangeCB(onLayerChange);

    // 6. 编排事件绑定
    bindOrchestrationEvents();

    // 6.5 恢复持久化状态（在 UI 与事件绑定之后，避免覆盖 DOM 绑定；在渲染循环之前，让初始星尘使用恢复后的主题）
    restorePersistedState();

    // 7. 启动渲染循环 + 初始星尘
    startLoop();
    const initCount = reducedMotion ? 50 : 120;
    spawnInitialDust(initCount);
    
    // 连接时间轴模块
    setTimelineModule({ timeline });

    // 8. 启动页 + 引导 + 提示定时器
    setTimeout(hideSplash, 2600);
    setTimeout(() => {
        if (!localStorage.getItem('liuguang_onboarded')) startOnboard();
    }, 3200);
    setTimeout(() => hint.classList.add('hidden'), 8000);
    hint.addEventListener('click', () => hint.classList.add('hidden'));
    // Phase 6.4：启动后展示今日挑战
    setTimeout(() => showToast('🎯 今日挑战：' + getTodayChallenge(), 6000), 3800);

    // 9. 标签页可见性监听
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopLoop();
        else startLoop();
    });

    // 启动日志（含运行时关键状态，便于排查"粒子不可见"类问题）
    console.log('%c✦ 流光绘卷 v6 已启动（模块化版）', 'color:#7dd3fc;font-size:14px;font-weight:bold;');
    console.log('模块：util / particle / audio / storage / layers / ui / inspirations / ai / share / main');
    console.log(`画布：${W}x${H} DPR=${DPR} · 图层 ${layerManager.layers.length} 层 · 活跃层 id=${layerManager.activeId} · 初始粒子 ${particles.length}/${MAX_PARTICLES}`);
    console.log('快捷键：C清空 Z撤销 Y重做 B背景 S保存 A自动 P保留 M音频 G作品库 D日记 L图层 I吸管 E橡皮 T文字 0重置缩放 N音效 Space/1-5换主题');
}

/** 绑定所有需要 particle/audio/storage 编排的事件处理器。 */
function bindOrchestrationEvents() {
    // Canvas 输入
    canvas.addEventListener('mousedown', e => { const p = coords(e.clientX, e.clientY); startStroke(MOUSE_ID, p.x, p.y); });
    canvas.addEventListener('mousemove', e => { if (!pointers.has(MOUSE_ID)) return; const p = coords(e.clientX, e.clientY); moveStroke(MOUSE_ID, p.x, p.y); });
    window.addEventListener('mouseup', () => endStroke(MOUSE_ID));
    canvas.addEventListener('mouseleave', () => endStroke(MOUSE_ID));
    canvas.addEventListener('touchstart', e => { e.preventDefault(); for (const t of e.changedTouches) { const p = coords(t.clientX, t.clientY); startStroke(t.identifier, p.x, p.y); } }, { passive: false });
    canvas.addEventListener('touchmove', e => { e.preventDefault(); for (const t of e.changedTouches) { const p = coords(t.clientX, t.clientY); moveStroke(t.identifier, p.x, p.y); } }, { passive: false });
    canvas.addEventListener('touchend', e => { e.preventDefault(); for (const t of e.changedTouches) endStroke(t.identifier); }, { passive: false });
    canvas.addEventListener('touchcancel', e => { for (const t of e.changedTouches) endStroke(t.identifier); });

    // 主题按钮
    themeBtns.forEach(b => b.addEventListener('click', () => setTheme(b.dataset.theme)));

    // 形状切换
    if (shapeBtn) shapeBtn.addEventListener('click', cycleShape);

    // 画笔预设
    document.querySelectorAll('.preset-btn').forEach(b => {
        b.addEventListener('click', () => applyPreset(b.dataset.preset));
    });

    // 工具切换（画笔/吸管/橡皮/文字）
    toolBtns.forEach(b => {
        b.addEventListener('click', () => setTool(b.dataset.tool));
    });

    // 导入图片 → 新图层置底
    if (importBtn) importBtn.addEventListener('click', importImage);

    // 重置缩放
    if (zoomReset) zoomReset.addEventListener('click', resetZoom);

    // 滚轮缩放（桌面端，以鼠标位置为缩放中心）
    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        // 鼠标在画布内部坐标（CSS 像素）
        const cx = (e.clientX - r.left) / state.zoom;
        const cy = (e.clientY - r.top) / state.zoom;
        const delta = -e.deltaY * 0.0015;
        const newZoom = clamp(state.zoom * (1 + delta), 0.25, 4);
        setZoom(newZoom, cx, cy);
    }, { passive: false });

    // 撤销 / 重做
    undoBtn.addEventListener('click', handleUndo);
    redoBtn.addEventListener('click', handleRedo);

    // 撤销按钮长按 → 打开历史预览面板（短按仍走 handleUndo）
    let undoLongPressTimer = null;
    let undoLongPressFired = false;
    const startUndoLongPress = () => {
        undoLongPressFired = false;
        undoLongPressTimer = setTimeout(() => {
            undoLongPressFired = true;
            openUndoPreviewOrch();
        }, 500);
    };
    const cancelUndoLongPress = () => {
        if (undoLongPressTimer) { clearTimeout(undoLongPressTimer); undoLongPressTimer = null; }
    };
    undoBtn.addEventListener('mousedown', startUndoLongPress);
    undoBtn.addEventListener('mouseup', cancelUndoLongPress);
    undoBtn.addEventListener('mouseleave', cancelUndoLongPress);
    undoBtn.addEventListener('touchstart', startUndoLongPress, { passive: true });
    undoBtn.addEventListener('touchend', cancelUndoLongPress);
    undoBtn.addEventListener('touchcancel', cancelUndoLongPress);
    // 长按触发后阻止本次 click 的 handleUndo
    undoBtn.addEventListener('click', (e) => { if (undoLongPressFired) { e.preventDefault(); e.stopPropagation(); } }, true);
    // 预览面板关闭按钮
    if (undoPreviewClose) undoPreviewClose.onclick = closeUndoPreviewOrch;

    // 清空
    clearBtn.addEventListener('click', handleClear);

    // 背景切换
    bgToggle.addEventListener('click', () => setBgDark(!state.bgDark));

    // 自动 / 保留 / 音频
    autoBtn.addEventListener('click', () => setAuto(!state.autoMode));
    preserveBtn.addEventListener('click', () => setPreserve(!state.preserveMode));
    audioBtn.addEventListener('click', () => {
        if (state.audioMode) {
            buildAudioStyleMenu();
            positionMenu(audioStyleMenu, audioBtn);
            audioStyleMenu.classList.toggle('show');
        } else {
            setAudioMode(true);
        }
    });
    
    // 动态背景
    const dynamicBgBtn = $('dynamicBgBtn');
    if (dynamicBgBtn) dynamicBgBtn.addEventListener('click', () => setDynamicBg(!state.dynamicBg));
    
    // 侧边栏收缩/展开
    const sidebar = $('sidebar');
    const sidebarToggle = $('sidebarToggle');
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            sidebarToggle.textContent = sidebar.classList.contains('collapsed') ? '›' : '‹';
        });
    }
    
    // 参数展开（替代旧的 expandRow）已移除，改用二级菜单
    
    // 保存
    saveBtn.addEventListener('click', openSaveModal);
    $('saveConfirm').onclick = handleSaveConfirm;

    // 画廊
    galleryBtn.addEventListener('click', openGallery);
    const galleryCloseEl = $('galleryClose');
    if (galleryCloseEl) galleryCloseEl.onclick = () => { exitGallerySelect(); closeGallery(); };
    if (galleryOverlay) galleryOverlay.onclick = () => { exitGallerySelect(); closeGallery(); };
    // Phase 6.1：批量管理按钮
    if (galleryBatchBtn) galleryBatchBtn.onclick = () => {
        if (_galleryItems.length === 0) { showToast('暂无作品可批量管理', null); return; }
        if (_gallerySelectMode) exitGallerySelect();
        else enterGallerySelect();
    };

    // Phase 6.3：灵感画廊
    if (inspBtn) inspBtn.addEventListener('click', openInspDrawer);
    if (inspCloseBtn) inspCloseBtn.onclick = closeInspDrawer;
    if (inspOverlay) inspOverlay.onclick = closeInspDrawer;

    // Phase 7：AI 创作 + 分享导出
    if (aiBtn) aiBtn.addEventListener('click', openAIModal);
    if (shareBtn) shareBtn.addEventListener('click', openShareModal);
    $('aiStyleApply').onclick = handleAIStyleTransfer;
    $('aiEmotionApply').onclick = handleAIEmotion;
    $('shareCardBtn').onclick = handleShareCard;
    $('shareWebMBtn').onclick = handleShareWebM;

    // 日记
    diaryBtn.addEventListener('click', openDiary);

    // 图层面板
    layerBtn.addEventListener('click', openLayerPanelOrch);
    // 覆盖 initUI 中的关闭绑定，确保同步 layerDrawerOpen 状态
    const layerCloseEl = $('layerClose');
    const layerOverlayEl = $('layerOverlay');
    if (layerCloseEl) layerCloseEl.onclick = closeLayerPanelOrch;
    if (layerOverlayEl) layerOverlayEl.onclick = closeLayerPanelOrch;

    // 快捷键面板
    const shortcutsClose = $('shortcutsClose');
    const shortcutsOverlayEl = $('shortcutsOverlay');
    if (shortcutsClose) shortcutsClose.onclick = closeShortcuts;
    if (shortcutsOverlayEl) shortcutsOverlayEl.onclick = closeShortcuts;

    // 智能调色板面板
    const paletteBtn = $('paletteBtn');
    const paletteModal = $('paletteModal');
    const paletteOverlay = $('paletteOverlay');
    const paletteContainer = $('paletteContainer');
    const paletteRefresh = $('paletteRefresh');
    const paletteClose = $('paletteClose');
    
    if (paletteBtn) paletteBtn.addEventListener('click', openPalettePanel);
    if (paletteClose) paletteClose.onclick = closePalettePanel;
    if (paletteOverlay) paletteOverlay.onclick = closePalettePanel;
    if (paletteRefresh) paletteRefresh.onclick = renderPalettePanel;

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.target.classList.contains('text-input-field')) return;
        const k = e.key.toLowerCase();
        if (k === 'c') clearBtn.click();
        else if (k === 'z' && !e.ctrlKey && !e.metaKey) handleUndo();
        else if (k === 'y' && !e.ctrlKey && !e.metaKey) handleRedo();
        else if ((k === 'z' || k === 'y') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); k === 'z' && !e.shiftKey ? handleUndo() : handleRedo(); }
        else if (k === 'b') bgToggle.click();
        else if (k === 's') { e.preventDefault(); saveBtn.click(); }
        else if (k === 'a') autoBtn.click();
        else if (k === 'p') preserveBtn.click();
        else if (k === 'm') audioBtn.click();
        else if (k === 'g') galleryBtn.click();
        else if (k === 'd') diaryBtn.click();
        else if (k === 'l') layerBtn.click();
        else if (k === 'n') { state.soundOn = !state.soundOn; sfx.init(); showToast(state.soundOn ? '音效已开启' : '音效已关闭', null); persistState(); }
        else if (k === 'i') setTool('eyedropper');
        else if (k === 'e') setTool('eraser');
        else if (k === 't') setTool('text');
        else if (k === '0') resetZoom();
        else if (e.code === 'Space') { e.preventDefault(); const ts = ['rainbow','ocean','fire','aurora','candy']; setTheme(ts[(ts.indexOf(state.theme) + 1) % ts.length]); }
        else if (k >= '1' && k <= '5') setTheme(['rainbow','ocean','fire','aurora','candy'][parseInt(k) - 1]);
        else if (k === '/' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openShortcuts(); }
    });
}

// ============================================================
//  智能调色板面板
// ============================================================

function openPalettePanel() {
    const paletteOverlay = $('paletteOverlay');
    const paletteModal = $('paletteModal');
    if (!paletteOverlay || !paletteModal) return;
    renderPalettePanel();
    paletteOverlay.classList.add('show');
    paletteModal.classList.add('show');
}

function closePalettePanel() {
    const paletteOverlay = $('paletteOverlay');
    const paletteModal = $('paletteModal');
    if (!paletteOverlay || !paletteModal) return;
    paletteOverlay.classList.remove('show');
    paletteModal.classList.remove('show');
}

function renderPalettePanel() {
    const paletteContainer = $('paletteContainer');
    if (!paletteContainer) return;
    
    const layer = layerManager.getActive();
    let baseColors = [];
    
    if (layer && layer.canvas) {
        baseColors = extractColors(layer.ctx, layer.canvas.width, layer.canvas.height);
    }
    
    const palettes = generatePalettes(baseColors);
    const paletteNames = {
        complementary: '互补色',
        analogous: '类似色',
        triadic: '三角色',
        monochromatic: '单色',
        splitComplementary: '分裂互补',
        extracted: '提取色',
    };
    
    paletteContainer.innerHTML = Object.entries(palettes)
        .map(([key, colors]) => {
            const colorHtml = colors.map(c => 
                `<div class="palette-color" style="background:hsl(${c[0]},${c[1]}%,${c[2]}%)"></div>`
            ).join('');
            const dotsHtml = colors.map(c =>
                `<div class="palette-dot" style="background:hsl(${c[0]},${c[1]}%,${c[2]}%)"></div>`
            ).join('');
            return `
                <div class="palette-card" data-palette="${key}">
                    <div class="palette-card-title">${paletteNames[key] || key}</div>
                    <div class="palette-colors">${colorHtml}</div>
                    <div class="palette-preview">${dotsHtml}</div>
                </div>
            `;
        }).join('');
    
    paletteContainer.querySelectorAll('.palette-card').forEach(card => {
        card.addEventListener('click', () => {
            const key = card.dataset.palette;
            const colors = palettes[key];
            applyPalette(colors);
            closePalettePanel();
            showToast(`已应用「${paletteNames[key] || key}」调色板`, null);
        });
    });
}

function applyPalette(colors) {
    if (!colors || colors.length === 0) return;
    state.customTheme = { colors };
    setTheme('custom');
}

// ============================================================
//  启动
// ============================================================

// type="module" 隐式 defer，DOM 已就绪，直接初始化
// 包 try/catch：init 抛异常时打印错误并兜底隐藏启动页，避免遮罩常驻掩盖真实问题
try {
    init();
} catch (e) {
    console.error('❌ 流光绘卷 init 失败：', e);
    const _sp = document.getElementById('splash');
    if (_sp) _sp.classList.add('gone');
}
