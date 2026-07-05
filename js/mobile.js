/**
 * mobile.js — 移动端优化模块
 *
 * 职责：
 *   - 响应式 isMobile/isLandscapeMobile 检测（resize/orientationchange 触发）
 *   - 底部工具栏 5 按钮事件代理（.click() 转发到原侧边栏按钮）
 *   - 拖拽指示条 touch 处理（40% 阈值自动展开/收起）
 *   - 参数行上下滑动调整（6 个参数：size/opacity/speed/density/trail/eraserSize）
 *   - 双指缩放范围切换 [1.0, 5.0] 与缩放比例显示
 *   - 粒子模式开关：开=粒子发射器 / 关=实心笔触
 *   - 横屏自动切换右侧竖排布局（Procreate 风格）
 *
 * 依赖：main.js（state, setZoom, setParticleMode, updateZoomRange, resetZoom, setTheme, persistState）
 *      ui.js（showToast, $）
 *      particle.js（getIsMobile, getIsLandscapeMobile）
 *      util.js（clamp）
 *
 * 仅在 getIsMobile() 为 true 时绑定事件；桌面端 initMobile() 直接 return。
 */
import {
    state, setZoom, setParticleMode, updateZoomRange, resetZoom, setTheme,
    persistState, ZOOM_MIN, ZOOM_MAX,
} from './main.js';
import { showToast, $, openSaveModal } from './ui.js';
import { getIsMobile, getIsLandscapeMobile, undo, redo } from './particle.js';
import { clamp } from './util.js';

let _mobileMode = false;
let _landscape = false;
let _barExpanded = false;

/** 参数配置表（与桌面端滑块范围一致）。 */
const PARAM_CONFIG = {
    size:       { min: 1,    max: 6,   step: 0.1,  fmt: v => v.toFixed(1), slider: 'sizeSlider' },
    opacity:    { min: 0,    max: 1,   step: 0.05, fmt: v => Math.round(v * 100).toString(), slider: null },
    speed:      { min: 0.1,  max: 2.0, step: 0.05, fmt: v => v.toFixed(1), slider: 'speedSlider' },
    density:    { min: 1,    max: 20,  step: 1,    fmt: v => v.toString(), slider: 'densitySlider' },
    trail:      { min: 0.01, max: 0.6, step: 0.01, fmt: v => v.toFixed(2), slider: 'trailSlider' },
    eraserSize: { min: 2,    max: 50,  step: 1,    fmt: v => v.toString(), slider: 'eraserSizeSlider' },
};
const PARAM_VAL_ID = {
    size: 'mSizeVal', opacity: 'mOpacityVal', speed: 'mSpeedVal',
    density: 'mDensityVal', trail: 'mTrailVal', eraserSize: 'mEraserVal',
};

// ============================================================
//  初始化入口（由 main.js init() 调用）
// ============================================================

export function initMobile() {
    _mobileMode = getIsMobile();
    if (!_mobileMode) return; // 桌面端跳过所有绑定

    _landscape = getIsLandscapeMobile();
    updateZoomRange(true); // 移动端缩放范围 [1.0, 5.0]

    bindBarButtons();
    bindThemePopup();
    bindDragHandle();
    bindParamSwipe();
    bindParticleModeToggle();
    bindZoomReset();
    bindResponsiveSwitch();

    syncParamValues();
    syncParticleModeToggle();
    syncZoomIndicator();

    document.body.classList.add('mobile-mode');
    if (_landscape) document.body.classList.add('mobile-landscape');
}

// ============================================================
//  5 按钮事件代理（零重复绑定）
// ============================================================

function bindBarButtons() {
    const bar = $('mobileBar');
    if (!bar) return;

    const actionMap = {
        undoBtn: async () => { const r = await undo(); if (r.ok) showToast('已撤销', null); },
        redoBtn: async () => { const r = await redo(); if (r.ok) showToast('已重做', null); },
        saveBtn: () => { openSaveModal(); },
        toolBrush: () => { /* 画笔按钮在移动端不需要额外处理 */ },
    };

    bar.querySelectorAll('.m-btn[data-target]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const targetId = btn.dataset.target;
            const action = actionMap[targetId];
            if (action) {
                action();
            }
        });
    });

    const syncMap = [
        { origId: 'undoBtn', sel: '.m-btn[data-target="undoBtn"]' },
        { origId: 'redoBtn', sel: '.m-btn[data-target="redoBtn"]' },
    ];
    syncMap.forEach(({ origId, sel }) => {
        const orig = $(origId);
        const mobile = bar.querySelector(sel);
        if (!orig || !mobile) return;
        const sync = () => { mobile.disabled = orig.disabled; };
        new MutationObserver(sync).observe(orig, { attributes: true, attributeFilter: ['disabled'] });
        sync();
    });

    const toolOrig = $('toolBrush');
    const toolMobile = bar.querySelector('.m-btn[data-target="toolBrush"]');
    if (toolOrig && toolMobile) {
        const sync = () => {
            const on = toolOrig.classList.contains('active');
            toolMobile.classList.toggle('active', on);
            toolMobile.setAttribute('aria-pressed', on ? 'true' : 'false');
        };
        new MutationObserver(sync).observe(toolOrig, { attributes: true, attributeFilter: ['class'] });
        sync();
    }
}

// ============================================================
//  主题色板浮层
// ============================================================

function bindThemePopup() {
    const themeBtn = $('mThemeBtn');
    const popup = $('mThemePopup');
    const bar = $('mobileBar');
    if (!themeBtn || !popup) return;

    themeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_barExpanded && bar) {
            bar.classList.remove('expanded');
            _barExpanded = false;
        }
        popup.classList.toggle('show');
    });

    popup.querySelectorAll('.m-theme-opt').forEach(opt => {
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            const theme = opt.dataset.theme;
            setTheme(theme);
            popup.classList.remove('show');
            const labelMap = { rainbow: '彩虹', ocean: '海洋', fire: '火焰', aurora: '极光', candy: '糖果' };
            showToast(`已切换到「${labelMap[theme] || theme}」主题`, null);
        });
    });

    document.addEventListener('click', (e) => {
        if (!popup.contains(e.target) && e.target !== themeBtn) {
            popup.classList.remove('show');
        }
    });
}

// ============================================================
//  拖拽指示条（40% 阈值展开/收起）
// ============================================================

function bindDragHandle() {
    const handle = $('mobileBarHandle');
    const bar = $('mobileBar');
    if (!handle || !bar) return;

    let startY = 0, dragging = false;
    const PANEL_HEIGHT = 220; // 与 CSS .mobile-bar.expanded translateY 对应

    handle.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        startY = e.touches[0].clientY;
        dragging = true;
        bar.style.transition = 'none'; // 拖拽时关闭过渡，跟随手指
        e.stopPropagation();
    }, { passive: true });

    handle.addEventListener('touchmove', (e) => {
        if (!dragging) return;
        const dy = e.touches[0].clientY - startY;
        const progress = clamp(-dy / PANEL_HEIGHT, 0, 1); // 上滑 dy<0，progress 增大
        if (_landscape) {
            bar.style.transform = `translateY(-50%) translateX(${-200 * progress}px)`;
        } else {
            bar.style.transform = `translateX(-50%) translateY(${-PANEL_HEIGHT * progress}px)`;
        }
        e.preventDefault();
        e.stopPropagation();
    }, { passive: false });

    handle.addEventListener('touchend', (e) => {
        if (!dragging) return;
        dragging = false;
        bar.style.transition = ''; // 恢复 CSS 过渡
        bar.style.transform = ''; // 清除内联，回到 CSS 控制的展开/收起态
        const dy = e.changedTouches[0].clientY - startY;
        const progress = clamp(-dy / PANEL_HEIGHT, 0, 1);
        // 40% 阈值：超过则展开
        if (progress > 0.4) {
            bar.classList.add('expanded');
            _barExpanded = true;
        } else {
            bar.classList.remove('expanded');
            _barExpanded = false;
        }
        e.stopPropagation();
    });

    // 已展开时点击指示条应收回
    handle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_barExpanded) {
            bar.classList.remove('expanded');
            _barExpanded = false;
        } else {
            bar.classList.add('expanded');
            _barExpanded = true;
        }
    });
}

// ============================================================
//  参数上下滑动调整
// ============================================================

function bindParamSwipe() {
    const bar = $('mobileBar');
    if (!bar) return;

    bar.querySelectorAll('.m-param').forEach(row => {
        const key = row.dataset.param;
        const cfg = PARAM_CONFIG[key];
        if (!cfg) return;

        let startY = 0, startVal = 0, dragging = false;
        const SENSITIVITY = 4; // 每 4px 对应一个 step

        row.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            startY = e.touches[0].clientY;
            startVal = state[key];
            dragging = true;
            row.classList.add('dragging');
            e.stopPropagation();
        }, { passive: true });

        row.addEventListener('touchmove', (e) => {
            if (!dragging) return;
            const dy = startY - e.touches[0].clientY; // 上滑为正（增大）
            const steps = Math.round(dy / SENSITIVITY);
            let newVal = startVal + steps * cfg.step;
            newVal = clamp(newVal, cfg.min, cfg.max);
            // 对齐到 step（避免浮点累积）
            newVal = Math.round(newVal / cfg.step) * cfg.step;
            state[key] = newVal;
            const valEl = $(PARAM_VAL_ID[key]);
            if (valEl) valEl.textContent = cfg.fmt(newVal);
            e.preventDefault();
            e.stopPropagation();
        }, { passive: false });

        row.addEventListener('touchend', () => {
            if (!dragging) return;
            dragging = false;
            row.classList.remove('dragging');
            // 同步到桌面滑块（保证切换桌面端时一致）
            if (cfg.slider) {
                const slider = $(cfg.slider);
                if (slider) slider.value = state[key];
            }
            // 持久化
            persistState();
        });
    });
}

/** 同步当前 state 到移动端参数显示。 */
export function syncParamValues() {
    Object.keys(PARAM_CONFIG).forEach(key => {
        const cfg = PARAM_CONFIG[key];
        const valEl = $(PARAM_VAL_ID[key]);
        if (valEl && typeof state[key] === 'number') {
            valEl.textContent = cfg.fmt(state[key]);
        }
    });
}

// ============================================================
//  粒子模式开关
// ============================================================

function bindParticleModeToggle() {
    const toggle = $('particleModeToggle');
    if (!toggle) return;

    toggle.addEventListener('change', () => {
        setParticleMode(toggle.checked);
    });

    // 监听 main.js 的事件，同步 UI（防止其他入口改 state）
    document.addEventListener('particleModeChange', (e) => {
        if (toggle.checked !== e.detail) toggle.checked = e.detail;
    });
}

function syncParticleModeToggle() {
    const toggle = $('particleModeToggle');
    if (toggle) toggle.checked = state.particleMode !== false; // 默认 true
}

// ============================================================
//  重置视角按钮
// ============================================================

function bindZoomReset() {
    const btn = $('mZoomReset');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        resetZoom();
    });
}

// ============================================================
//  缩放比例显示
// ============================================================

export function showZoomIndicator(zoom) {
    if (!getIsMobile()) return;
    const el = $('zoomIndicator');
    if (!el) return;
    el.textContent = Math.round(zoom * 100) + '%';
}

function syncZoomIndicator() {
    showZoomIndicator(state.zoom);
}

// ============================================================
//  响应式切换（resize/orientationchange）
// ============================================================

function bindResponsiveSwitch() {
    const check = () => {
        const nowMobile = getIsMobile();
        const nowLandscape = getIsLandscapeMobile();

        // 移动端 ↔ 桌面端切换
        if (nowMobile !== _mobileMode) {
            _mobileMode = nowMobile;
            updateZoomRange(nowMobile);
            // 切换到桌面端时若当前 zoom < 1.0，重置避免画布不可见
            if (!nowMobile && state.zoom < 0.25) {
                setZoom(1.0, state.panX, state.panY);
            }
            // 切换到移动端时若 zoom < 1.0，重置到 1.0
            if (nowMobile && state.zoom < 1.0) {
                setZoom(1.0, state.panX, state.panY);
            }
            document.body.classList.toggle('mobile-mode', nowMobile);
        }

        // 横竖屏切换
        if (nowLandscape !== _landscape) {
            _landscape = nowLandscape;
            document.body.classList.toggle('mobile-landscape', nowLandscape);
        }
    };

    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', () => setTimeout(check, 100));
}
