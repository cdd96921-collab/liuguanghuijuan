/**
 * ui.js — UI 表现层模块
 *
 * 职责：
 *   - SVG 图标系统（ICONS + iconHTML）
 *   - 所有 DOM 引用（除 canvas/ctx 归 particle.js 外）
 *   - Toast 通知
 *   - UI 状态更新函数（由 main.js 编排调用：updateThemeUI/updateShapeBtn/...）
 *   - 设置菜单构建（buildSettingsMenu + applyColorBlind）
 *   - 保存对话框（openSaveModal/closeSaveModal/getSaveData）
 *   - 画廊渲染（renderGallery，接受回调）
 *   - 情绪日记（openDiary/closeDiary/drawDiaryChart/renderDiaryList）
 *   - 新手引导（startOnboard/endOnboard）
 *   - 启动页（hideSplash）
 *   - initUI()：绑定所有不依赖 particle/audio 编排的事件处理器
 *
 * 依赖：
 *   - util.js：escapeHTML, formatDate, formatDateTime, clamp
 *   - main.js：state（live binding）
 *   - particle.js：THEMES, LIGHT_BG, canvas, exportParticleSVG
 *   - audio.js：sfx, pickAudioFile
 *   - storage.js：db
 *
 * 循环依赖说明：
 *   ui ↔ main、ui ↔ particle、ui ↔ audio 均为安全循环。
 *   initUI() 由 main.js 在所有模块加载后调用，此时所有绑定已就绪。
 */

import { escapeHTML, formatDate, formatDateTime, clamp } from './util.js';
import { state, persistState, AUDIO_STYLES } from './main.js';
import { THEMES, LIGHT_BG, canvas, exportParticleSVG, history } from './particle.js';
import { sfx, pickAudioFile, setAudioMode, deactivateAudio } from './audio.js';
import { db } from './storage.js';
import { getTodayChallenge, INSPIRATIONS, SHAPE_PRESETS, renderInspirationThumb } from './inspirations.js';

// ============================================================
//  图标系统
// ============================================================

export const ICONS = {
    brush: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>',
    redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg>',
    gallery: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
    diary: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l3-3 3 3 4-5"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 4 20 12 6 20"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    clear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    chevronUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>',
    chevronDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
    rename: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    volume: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>',
    circle: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9"/></svg>',
    sparkle: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.5 6.5L20 10l-6.5 1.5L12 18l-1.5-6.5L4 10l6.5-1.5z"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    contrast: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2v20" fill="currentColor"/><path d="M12 2a10 10 0 0 0 0 20z" fill="currentColor"/></svg>',
    layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    arrowUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>',
    arrowDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>',
    merge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6L2 12l6 6"/><path d="M16 6l6 6-6 6"/><line x1="2" y1="12" x2="22" y2="12"/></svg>',
    eyedropper: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 22l1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="M15 6l3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4z"/></svg>',
    eraser: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H7L3 16a2 2 0 0 1 0-2.8L13.2 3a2 2 0 0 1 2.8 0l5 5a2 2 0 0 1 0 2.8L11 20"/><line x1="18" y1="13" x2="9" y2="4"/></svg>',
    text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    ai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="15" r="2"/><path d="M12 13v-2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><circle cx="8" cy="16" r="0.5" fill="currentColor"/><circle cx="16" cy="16" r="0.5" fill="currentColor"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
    film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>',
};
export const iconHTML = (name) => ICONS[name] || '';

// ============================================================
//  DOM 引用
// ============================================================

export const $ = (id) => document.getElementById(id);
export const wrapper = $('canvas-wrapper'), hint = $('hint');
export const sizeSlider = $('sizeSlider'), speedSlider = $('speedSlider');
export const densitySlider = $('densitySlider'), trailSlider = $('trailSlider');
export const eraserSizeSlider = $('eraserSizeSlider');
export const sizeVal = $('sizeVal'), speedVal = $('speedVal');
export const densityVal = $('densityVal'), trailVal = $('trailVal');
export const eraserSizeVal = $('eraserSizeVal');
export const clearBtn = $('clearBtn'), bgToggle = $('bgToggle'), saveBtn = $('saveBtn');
export const autoBtn = $('autoBtn'), preserveBtn = $('preserveBtn'), audioBtn = $('audioBtn');
export const audioStyleMenu = $('audioStyleMenu');
export const shapeBtn = $('shapeBtn'), undoBtn = $('undoBtn'), redoBtn = $('redoBtn');
export const moreBtn = $('moreBtn'), expandRow = $('expandRow');
export const controls = $('controls'), themeBtns = document.querySelectorAll('.theme-btn');
export const presetBtns = document.querySelectorAll('.preset-btn');
export const toastContainer = $('toastContainer'), fpsMonitor = $('fpsMonitor');
export const galleryBtn = $('galleryBtn'), diaryBtn = $('diaryBtn');
export const inspBtn = $('inspBtn');
export const aiBtn = $('aiBtn'), shareBtn = $('shareBtn');
export const aiModal = $('aiModal'), aiOverlay = $('aiOverlay'), shareModal = $('shareModal'), shareOverlay = $('shareOverlay');
export const settingsBtn = $('settingsBtn'), settingsMenu = $('settingsMenu');
export const audioRing = $('audioRing');
export const galleryDrawer = $('galleryDrawer'), galleryOverlay = $('galleryOverlay'), galleryBody = $('galleryBody');
export const galleryBatchBtn = $('galleryBatchBtn');
export const inspDrawer = $('inspDrawer'), inspOverlay = $('inspOverlay'), inspBody = $('inspBody'), inspCloseBtn = $('inspClose');
export const diaryModal = $('diaryModal'), diaryOverlay = $('diaryOverlay');
export const layerBtn = $('layerBtn'), layerDrawer = $('layerDrawer'), layerOverlay = $('layerOverlay'), layerBody = $('layerBody');
export const undoPreview = $('undoPreview'), undoPreviewGrid = $('undoPreviewGrid'), undoPreviewClose = $('undoPreviewClose');
export const toolBtns = document.querySelectorAll('.tool-btn');
export const toolBrush = $('toolBrush'), toolEyedrop = $('toolEyedrop'), toolEraser = $('toolEraser'), toolText = $('toolText');
export const zoomReset = $('zoomReset'), importBtn = $('importBtn'), dynamicBgBtn = $('dynamicBgBtn');
export const particleModeSwitch = $('particleModeSwitch');
export const modeParticle = $('modeParticle'), modeBrush = $('modeBrush');
export const brushSizeSlider = $('brushSizeSlider'), brushOpacitySlider = $('brushOpacitySlider');
export const brushSizeVal = $('brushSizeVal'), brushOpacityVal = $('brushOpacityVal');
export const colorWheel = $('colorWheel'), colorWheelCursor = $('colorWheelCursor');
export const colorHueSlider = $('colorHueSlider'), colorSatSlider = $('colorSatSlider'), colorLightSlider = $('colorLightSlider');
export const colorPreview = $('colorPreview');
export const brushSliderPanel = $('brushSliderPanel');
export const brushSizeFill = $('brushSizeFill'), brushSizeThumb = $('brushSizeThumb');
export const brushOpacityFill = $('brushOpacityFill'), brushOpacityThumb = $('brushOpacityThumb');
const saveModal = $('saveModal');
const confirmModal = $('confirmModal'), confirmOverlay = $('confirmOverlay');
const confirmTitle = $('confirmTitle'), confirmMessage = $('confirmMessage');
const shortcutsModal = $('shortcutsModal'), shortcutsOverlay = $('shortcutsOverlay');
const paramsBtn = $('paramsBtn'), paramsMenu = $('paramsMenu');

// 初始化图标按钮内容（顶层执行，仅依赖 iconHTML）
if (autoBtn) autoBtn.innerHTML = iconHTML('play') + '<span>自动</span>';
if (preserveBtn) preserveBtn.innerHTML = iconHTML('pin') + '<span>保留</span>';
if (audioBtn) audioBtn.innerHTML = iconHTML('music') + '<span>音频</span>';
if (undoBtn) undoBtn.innerHTML = iconHTML('undo') + '<span>撤销</span>';
if (redoBtn) redoBtn.innerHTML = iconHTML('redo') + '<span>重做</span>';
if (shapeBtn) shapeBtn.innerHTML = iconHTML('circle') + '<span>圆形</span>';
if (bgToggle) bgToggle.innerHTML = iconHTML('moon') + '<span>背景</span>';
if (moreBtn) moreBtn.innerHTML = iconHTML('chevronDown') + '<span>参数</span>';
if (paramsBtn) paramsBtn.innerHTML = iconHTML('settings') + '<span>参数</span>';
if (clearBtn) clearBtn.innerHTML = iconHTML('clear') + '<span>清空</span>';
if (settingsBtn) settingsBtn.innerHTML = iconHTML('settings') + '<span>设置</span>';
if (galleryBtn) galleryBtn.innerHTML = iconHTML('gallery') + '<span>作品库</span>';
if (inspBtn) inspBtn.innerHTML = iconHTML('sparkle') + '<span>灵感</span>';
if (aiBtn) aiBtn.innerHTML = iconHTML('ai') + '<span>AI创作</span>';
if (shareBtn) shareBtn.innerHTML = iconHTML('share') + '<span>分享</span>';
if (diaryBtn) diaryBtn.innerHTML = iconHTML('diary') + '<span>日记</span>';
if (saveBtn) saveBtn.innerHTML = iconHTML('save') + '<span>保存</span>';
if (layerBtn) layerBtn.innerHTML = iconHTML('layers') + '<span>图层</span>';
const galleryClose = $('galleryClose');
if (galleryClose) galleryClose.innerHTML = iconHTML('close');
const layerCloseBtn = $('layerClose');
if (layerCloseBtn) layerCloseBtn.innerHTML = iconHTML('close');
if (inspCloseBtn) inspCloseBtn.innerHTML = iconHTML('close');
// 工具按钮图标
if (toolBrush) toolBrush.innerHTML = iconHTML('brush') + '<span>画笔</span>';
if (toolEyedrop) toolEyedrop.innerHTML = iconHTML('eyedropper') + '<span>吸管</span>';
if (toolEraser) toolEraser.innerHTML = iconHTML('eraser') + '<span>橡皮擦</span>';
if (toolText) toolText.innerHTML = iconHTML('text') + '<span>文字</span>';
if (zoomReset) zoomReset.innerHTML = iconHTML('target') + '<span>重置视角</span>';
if (importBtn) importBtn.innerHTML = iconHTML('image') + '<span>导入图片</span>';

// ============================================================
//  Toast 通知
// ============================================================

/**
 * 显示 Toast 通知。
 * @param {string} text 主文本
 * @param {string|null} actionLabel 可选操作按钮文本
 * @param {Function|null} onAction 点击操作按钮的回调
 */
export function showToast(text, actionLabel, onAction) {
    const t = document.createElement('div'); t.className = 'toast';
    const s = document.createElement('span'); s.textContent = text; t.appendChild(s);
    if (actionLabel) {
        const b = document.createElement('button');
        b.className = 'toast-action'; b.textContent = actionLabel;
        b.onclick = () => { if (onAction) onAction(); removeToast(t); };
        t.appendChild(b);
    }
    toastContainer.appendChild(t);
    setTimeout(() => removeToast(t), actionLabel ? 5000 : 2200);
}

/** 移除 Toast（带淡出动画）。 */
export function removeToast(t) {
    if (!t.parentNode) return;
    t.classList.add('out');
    setTimeout(() => t.parentNode && t.parentNode.removeChild(t), 300);
}

// ============================================================
//  UI 状态更新（由 main.js 编排调用）
// ============================================================

/** 更新主题按钮高亮状态。 */
export function updateThemeUI(theme) {
    document.querySelectorAll('.theme-btn').forEach(b => {
        const on = b.dataset.theme === theme;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
}

/** 更新形状按钮图标和文字。 */
export function updateShapeBtn(shape) {
    if (!shapeBtn) return;
    const names = { circle: '圆形', star: '星形', sparkle: '光点' };
    shapeBtn.innerHTML = `${iconHTML(shape)}<span>${names[shape]}</span>`;
}

/** 更新撤销/重做按钮禁用状态。 */
export function updateHistoryButtons({ canUndo, canRedo }) {
    if (undoBtn) undoBtn.disabled = !canUndo;
    if (redoBtn) redoBtn.disabled = !canRedo;
}

/** 更新背景明暗 UI（body class + wrapper bg + 按钮图标）。 */
export function setBgDarkUI(dark) {
    document.body.classList.toggle('light-bg', !dark);
    if (dark) { 
        wrapper.style.background = THEMES[state.theme].bg; 
        if (bgToggle) bgToggle.innerHTML = iconHTML('moon') + '<span>背景</span>'; 
    }
    else { 
        wrapper.style.background = LIGHT_BG; 
        if (bgToggle) bgToggle.innerHTML = iconHTML('sun') + '<span>背景</span>'; 
    }
}

/** 更新自动模式按钮 UI。 */
export function setAutoUI(on) {
    if (!autoBtn) return;
    autoBtn.classList.toggle('active-toggle', on);
    autoBtn.setAttribute('aria-pressed', on);
    autoBtn.innerHTML = on ? iconHTML('pause') + '<span>自动</span>' : iconHTML('play') + '<span>自动</span>';
}

/** 更新保留路径按钮 UI。 */
export function setPreserveUI(on) {
    if (!preserveBtn) return;
    preserveBtn.classList.toggle('active-toggle', on);
    preserveBtn.setAttribute('aria-pressed', on);
}

/** 更新动态背景按钮 UI。 */
export function setDynamicBgUI(on) {
    if (!dynamicBgBtn) return;
    dynamicBgBtn.classList.toggle('active-toggle', on);
    dynamicBgBtn.setAttribute('aria-pressed', on);
}

// ============================================================
//  设置菜单
// ============================================================

/** 构建设置菜单 HTML 并绑定项点击处理器。 */
export function buildSettingsMenu() {
    const cbModes = [
        { id: 'normal', label: '正常视觉' },
        { id: 'protanopia', label: '红色盲模拟' },
        { id: 'deuteranopia', label: '绿色盲模拟' },
        { id: 'tritanopia', label: '蓝色盲模拟' },
    ];
    settingsMenu.innerHTML = `
        <div class="menu-item" id="mi-sound">
            <span class="mi-label">${iconHTML('volume')}音效反馈</span>
            <span class="mi-check">${state.soundOn ? '✓' : ''}</span>
        </div>
        <div class="menu-item" id="mi-hc">
            <span class="mi-label">${iconHTML('contrast')}高对比度</span>
            <span class="mi-check">${state.highContrast ? '✓' : ''}</span>
        </div>
        <div class="menu-divider"></div>
        <div class="menu-item" style="font-size:var(--fs-xs);color:var(--text-dim);cursor:default;pointer-events:none;">色盲模拟</div>
        ${cbModes.map(m => `<div class="menu-item cb-mode" data-mode="${m.id}"><span class="mi-label">${iconHTML('eye')}${m.label}</span><span class="mi-check">${state.colorBlind === m.id ? '✓' : ''}</span></div>`).join('')}
        <div class="menu-divider"></div>
        <div class="menu-item" id="mi-demo">
            <span class="mi-label">${iconHTML('music')}音频演示模式</span>
            <span class="mi-check">${state.demoMode ? '✓' : ''}</span>
        </div>
        <div class="menu-item" id="mi-audiofile"><span class="mi-label">${iconHTML('music')}使用音频文件（回退）</span></div>
        <div class="menu-item" id="mi-svg"><span class="mi-label">${iconHTML('download')}导出 SVG</span></div>
        <div class="menu-divider"></div>
        <div class="menu-item" id="mi-challenge"><span class="mi-label">${iconHTML('sparkle')}今日挑战</span></div>
    `;
    // 绑定
    $('mi-sound').onclick = () => {
        state.soundOn = !state.soundOn;
        sfx.init();
        buildSettingsMenu();
        showToast(state.soundOn ? '音效已开启' : '音效已关闭', null);
        if (state.soundOn) sfx.success();
        persistState();
    };
    $('mi-hc').onclick = () => {
        state.highContrast = !state.highContrast;
        document.body.classList.toggle('hc', state.highContrast);
        buildSettingsMenu();
        persistState();
    };
    settingsMenu.querySelectorAll('.cb-mode').forEach(el => {
        el.onclick = () => {
            state.colorBlind = el.dataset.mode;
            applyColorBlind();
            buildSettingsMenu();
            persistState();
        };
    });
    $('mi-svg').onclick = () => { settingsMenu.classList.remove('show'); exportParticleSVG(); showToast('SVG 已导出', null); };
    $('mi-audiofile').onclick = () => { settingsMenu.classList.remove('show'); pickAudioFile(); };
    // Phase 6.2：音频演示模式开关。若音频模式已开启，切换后重启到新模式。
    $('mi-demo').onclick = () => {
        const wasActive = state.audioMode;
        state.demoMode = !state.demoMode;
        if (wasActive) {
            // 先停当前模式，再以新模式重启
            deactivateAudio();
            setAudioMode(true);
        }
        buildSettingsMenu();
        persistState();
        showToast(state.demoMode
            ? '演示模式已开启 · 点击音频按钮即可（无需共享系统音频）'
            : '演示模式已关闭 · 音频按钮将唤起系统音频共享', null);
    };
    // Phase 6.4：今日挑战提示
    $('mi-challenge').onclick = () => {
        settingsMenu.classList.remove('show');
        showToast('🎯 今日挑战：' + getTodayChallenge(), 6000);
    };
}

/** 构建音频样式菜单 HTML 并绑定项点击处理器。 */
export function buildAudioStyleMenu() {
    audioStyleMenu.innerHTML = `
        <div class="menu-item" style="font-size:var(--fs-xs);color:var(--text-dim);cursor:default;pointer-events:none;">音频粒子样式</div>
        ${AUDIO_STYLES.map(s => `
            <div class="menu-item audio-style-item" data-style="${s.id}">
                <span class="mi-label">${s.name}</span>
                <span class="mi-desc">${s.desc}</span>
                <span class="mi-check">${state.audioStyle === s.id ? '✓' : ''}</span>
            </div>
        `).join('')}
    `;
    audioStyleMenu.querySelectorAll('.audio-style-item').forEach(el => {
        el.onclick = () => {
            state.audioStyle = el.dataset.style;
            audioStyleMenu.classList.remove('show');
            persistState();
            showToast(`音频样式：${el.querySelector('.mi-label').textContent}`, null);
        };
    });
}

/** 应用色盲模拟滤镜到画布。 */
export function applyColorBlind() {
    const map = { normal: 'none', protanopia: 'url(#cb-protanopia)', deuteranopia: 'url(#cb-deuteranopia)', tritanopia: 'url(#cb-tritanopia)' };
    canvas.style.filter = map[state.colorBlind];
}

/**
 * 定位菜单到按钮旁边。
 * @param {HTMLElement} menu 菜单元素
 * @param {HTMLElement} button 按钮元素
 */
export function positionMenu(menu, button) {
    if (!menu || !button) return;
    const btnRect = button.getBoundingClientRect();
    const toolbar = $('toolbar');
    const toolbarCollapsed = toolbar && toolbar.classList.contains('collapsed');
    const left = toolbarCollapsed ? 20 : btnRect.right + 8;
    const top = btnRect.top + btnRect.height / 2;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.transform = 'translateY(-50%) scale(0.95)';
}

// ============================================================
//  确认对话框
// ============================================================

let _confirmCallback = null;

/**
 * 显示确认对话框。
 * @param {string} title 标题
 * @param {string} message 提示信息
 * @param {() => void} onConfirm 确认回调
 */
export function showConfirm(title, message, onConfirm) {
    if (!confirmModal || !confirmOverlay) return;
    confirmTitle.textContent = title;
    confirmMessage.textContent = message;
    _confirmCallback = onConfirm;
    confirmOverlay.classList.add('show');
    confirmModal.classList.add('show');
}

/** 关闭确认对话框。 */
export function closeConfirm() {
    if (!confirmModal || !confirmOverlay) return;
    confirmOverlay.classList.remove('show');
    confirmModal.classList.remove('show');
    _confirmCallback = null;
}

function _initConfirmDialog() {
    const confirmOk = $('confirmOk');
    const confirmCancel = $('confirmCancel');
    const confirmOverlayEl = $('confirmOverlay');
    if (confirmOk) confirmOk.onclick = () => { const cb = _confirmCallback; closeConfirm(); if (cb) cb(); };
    if (confirmCancel) confirmCancel.onclick = closeConfirm;
    if (confirmOverlayEl) confirmOverlayEl.onclick = closeConfirm;
}

// ============================================================
//  快捷键面板
// ============================================================

/** 打开快捷键参考面板。 */
export function openShortcuts() {
    if (!shortcutsModal || !shortcutsOverlay) return;
    shortcutsOverlay.classList.add('show');
    shortcutsModal.classList.add('show');
}

/** 关闭快捷键参考面板。 */
export function closeShortcuts() {
    if (!shortcutsModal || !shortcutsOverlay) return;
    shortcutsOverlay.classList.remove('show');
    shortcutsModal.classList.remove('show');
}

/** 切换参数二级菜单的显隐。 */
export function toggleParamsMenu() {
    if (!paramsMenu) return;
    paramsMenu.classList.toggle('show');
}

/** 关闭参数二级菜单。 */
export function closeParamsMenu() {
    if (!paramsMenu) return;
    paramsMenu.classList.remove('show');
}

// ============================================================
//  控制面板展开行（滑块）
// ============================================================

/** 切换展开行（滑块组）的显隐。 */
export function toggleExpand() {
    if (!expandRow || !moreBtn) return;
    const collapsed = expandRow.classList.toggle('collapsed');
    moreBtn.innerHTML = iconHTML(collapsed ? 'chevronDown' : 'chevronUp');
    moreBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

/** 设置展开行状态（恢复持久化时调用）。 */
export function setExpand(expanded) {
    if (!expandRow || !moreBtn) return;
    expandRow.classList.toggle('collapsed', !expanded);
    moreBtn.innerHTML = iconHTML(expanded ? 'chevronUp' : 'chevronDown');
    moreBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

// ============================================================
//  保存对话框
// ============================================================

let saveMood = 3;

/** 打开保存对话框，重置默认值。 */
export function openSaveModal() {
    $('saveName').value = '流光·' + new Date().toLocaleDateString('zh-CN');
    $('saveNote').value = '';
    $('saveTags').value = '';
    saveMood = 3;
    updateStars();
    saveModal.classList.add('show');
}

/** 关闭保存对话框。 */
export function closeSaveModal() { saveModal.classList.remove('show'); }

/** 获取保存对话框数据（含标签解析：逗号分隔 → 去空 → 去重 → 限 5 个）。 */
export function getSaveData() {
    const rawTags = $('saveTags').value.trim();
    const tags = rawTags
        ? [...new Set(rawTags.split(/[,，]/).map(t => t.trim()).filter(Boolean))].slice(0, 5)
        : [];
    return {
        name: $('saveName').value.trim() || '未命名流光',
        note: $('saveNote').value.trim(),
        mood: saveMood,
        tags,
    };
}

function updateStars() {
    $('saveStars').querySelectorAll('.star-btn').forEach(b => {
        b.classList.toggle('on', parseInt(b.dataset.v) <= saveMood);
    });
}

// ============================================================
//  画廊渲染
// ============================================================

/** 关闭画廊抽屉。 */
export function closeGallery() {
    galleryDrawer.classList.remove('show');
    galleryOverlay.classList.remove('show');
}

/**
 * 渲染画廊网格并绑定操作回调（Phase 4.7 标签筛选 + Phase 6.1 批量选择）。
 * @param {Array} items 作品列表（含 id/thumb/name/createdAt/mood/tags）
 * @param {Object} handlers 回调集合
 *   - onLoad(id) 加载作品
 *   - onRename(id, el) 重命名
 *   - onDelete(id, el) 删除
 *   - onFilter(tag|null) 点击 chip 筛选（null 表示「全部」）
 *   - onToggleSelect(id) 切换选中（批量模式）
 *   - onBatchDelete() 批量删除
 *   - onExitSelect() 退出批量模式
 *   - onSelectAll() 全选/取消全选
 * @param {string[]} tags 所有可选标签（用于渲染顶部 chips）
 * @param {string|null} activeTag 当前激活的筛选标签（null = 全部）
 * @param {Object} opts 批量模式选项 { selectMode: boolean, selected: Set<number> }
 */
export function renderGallery(items, handlers, tags = [], activeTag = null, opts = {}) {
    const selectMode = !!(opts && opts.selectMode);
    const selected = (opts && opts.selected) || new Set();
    // 顶部标签筛选 chips（批量模式隐藏，避免与批量工具栏冲突）
    const chipsHTML = (!selectMode && tags.length) ? `
        <div class="tag-chips">
            <button class="tag-chip ${activeTag === null ? 'active' : ''}" data-tag="">全部</button>
            ${tags.map(t => `<button class="tag-chip ${activeTag === t ? 'active' : ''}" data-tag="${escapeHTML(t)}">${escapeHTML(t)}</button>`).join('')}
        </div>` : '';
    // 批量模式工具栏
    const batchBarHTML = selectMode ? `
        <div class="batch-bar">
            <button class="batch-btn" id="batchExit">${iconHTML('close')}退出</button>
            <span class="batch-count">已选 ${selected.size} 项</span>
            <button class="batch-btn" id="batchSelectAll">${selected.size > 0 && selected.size === items.length ? '取消全选' : '全选'}</button>
            <button class="batch-btn del ${selected.size === 0 ? 'disabled' : ''}" id="batchDelete">${iconHTML('trash')}删除</button>
        </div>` : '';
    galleryBody.innerHTML = chipsHTML + batchBarHTML + '<div class="gallery-grid' + (selectMode ? ' select-mode' : '') + '">' + items.map(it => `
        <div class="gallery-item${selectMode ? ' selectable' : ''}${selectMode && selected.has(it.id) ? ' selected' : ''}" data-id="${it.id}">
            ${selectMode ? `<span class="gi-check ${selected.has(it.id) ? 'on' : ''}">${iconHTML('check')}</span>` : ''}
            <img src="${it.thumb}" alt="${it.name}" loading="lazy" />
            ${!selectMode ? `<div class="gi-actions">
                <button class="gi-act-btn" data-act="rename" title="重命名">${iconHTML('rename')}</button>
                <button class="gi-act-btn del" data-act="delete" title="删除">${iconHTML('trash')}</button>
            </div>` : ''}
            <div class="gi-info">
                <div class="gi-name">${escapeHTML(it.name)}</div>
                <div class="gi-meta">
                    <span>${formatDate(it.createdAt)}</span>
                    <span class="gi-mood">${'★'.repeat(it.mood || 3)}</span>
                </div>
                ${(it.tags || []).length ? `<div class="gi-tags">${it.tags.map(t => `<span class="gi-tag">${escapeHTML(t)}</span>`).join('')}</div>` : ''}
            </div>
        </div>
    `).join('') + '</div>';
    // 绑定 chip 筛选（非批量模式）
    if (!selectMode) {
        galleryBody.querySelectorAll('.tag-chip').forEach(b => {
            b.onclick = () => handlers.onFilter(b.dataset.tag || null);
        });
    }
    // 绑定批量工具栏
    if (selectMode) {
        const exitBtn = $('batchExit'), delBtn = $('batchDelete'), allBtn = $('batchSelectAll');
        if (exitBtn) exitBtn.onclick = () => handlers.onExitSelect && handlers.onExitSelect();
        if (allBtn) allBtn.onclick = () => handlers.onSelectAll && handlers.onSelectAll();
        if (delBtn) delBtn.onclick = () => { if (selected.size > 0) handlers.onBatchDelete && handlers.onBatchDelete(); };
    }
    // 绑定 item 事件
    galleryBody.querySelectorAll('.gallery-item').forEach(el => {
        const id = parseInt(el.dataset.id);
        if (selectMode) {
            // 批量模式：点击整卡片切换选中
            el.onclick = () => handlers.onToggleSelect && handlers.onToggleSelect(id);
        } else {
            el.querySelector('img').onclick = () => handlers.onLoad(id);
            el.querySelectorAll('.gi-act-btn').forEach(b => {
                b.onclick = (e) => {
                    e.stopPropagation();
                    const act = b.dataset.act;
                    if (act === 'rename') handlers.onRename(id, el);
                    else if (act === 'delete') handlers.onDelete(id, el);
                };
            });
        }
    });
}

/** Phase 5.3：画廊加载骨架屏（6 个 shimmer 占位块）。 */
export function renderGallerySkeleton() {
    galleryBody.innerHTML = '<div class="skeleton-grid">' +
        Array.from({ length: 6 }).map(() => '<div class="skeleton-item"></div>').join('') +
        '</div>';
}

/** Phase 5.3：画廊空状态（图标 + 说明 + CTA）。onTrySample 点击「试试示例作品」回调。 */
export function renderGalleryEmpty(onTrySample) {
    galleryBody.innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">🖼</div>
            <div class="empty-title">还没有作品</div>
            <div class="empty-desc">点击「保存」记录你的第一幅流光</div>
            <button class="empty-cta" id="emptyTrySample">试试示例作品</button>
        </div>`;
    const cta = $('emptyTrySample');
    if (cta) cta.onclick = () => onTrySample && onTrySample();
}

// ============================================================
//  灵感画廊（Phase 6.3）
// ============================================================

/** 关闭灵感画廊抽屉。 */
export function closeInspDrawer() {
    if (inspDrawer) inspDrawer.classList.remove('show');
    if (inspOverlay) inspOverlay.classList.remove('show');
}

/**
 * 渲染灵感画廊：展示预设作品和形状模板的缩略图网格。
 * @param {Function} onLoad(preset) 点击预设时回调，传入预设对象
 */
export function renderInspirations(onLoad) {
    if (!inspBody) return;
    
    const allPresets = [
        ...SHAPE_PRESETS.map(p => ({ ...p, type: 'shape' })),
        ...INSPIRATIONS.map(p => ({ ...p, type: 'inspiration' }))
    ];
    
    inspBody.innerHTML = `
        <div class="insp-intro">点击任意灵感预设，一键套用主题、形状与参数组合，开启你的创作。</div>
        <div class="insp-grid">
            ${allPresets.map((p, i) => `
                <div class="insp-item" data-idx="${i}">
                    <img src="${renderInspirationThumb(p)}" alt="${escapeHTML(p.name)}" loading="lazy" />
                    <div class="insp-info">
                        <div class="insp-name">${escapeHTML(p.name)}</div>
                        <div class="insp-desc">${escapeHTML(p.desc)}</div>
                        <div class="insp-tags">
                            <span class="insp-tag">${escapeHTML(p.theme)}</span>
                            <span class="insp-tag">${escapeHTML(p.shape)}</span>
                            ${p.template ? `<span class="insp-tag template">模板</span>` : ''}
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>`;
    inspBody.querySelectorAll('.insp-item').forEach(el => {
        el.onclick = () => {
            const idx = parseInt(el.dataset.idx);
            onLoad && onLoad(allPresets[idx]);
        };
    });
}

// ============================================================
//  AI 与分享对话框（Phase 7）
// ============================================================

/** 打开 AI 对话框。 */
export function openAIModal() {
    if (!aiModal) return;
    aiModal.classList.add('show');
    aiOverlay.classList.add('show');
    // 重置到风格迁移 tab
    _switchAITab('style');
}

/** 关闭 AI 对话框。 */
export function closeAIModal() {
    if (aiModal) aiModal.classList.remove('show');
    if (aiOverlay) aiOverlay.classList.remove('show');
    const loading = $('aiLoading');
    if (loading) loading.classList.add('hidden');
}

/** 切换 AI 对话框 tab。 */
function _switchAITab(tab) {
    document.querySelectorAll('.ai-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
    });
    const stylePanel = $('aiPanelStyle'), emotionPanel = $('aiPanelEmotion');
    if (stylePanel) stylePanel.classList.toggle('hidden', tab !== 'style');
    if (emotionPanel) emotionPanel.classList.toggle('hidden', tab !== 'emotion');
}

/** 显示/隐藏 AI 加载态。 */
export function setAILoading(loading, text) {
    const el = $('aiLoading');
    if (el) {
        el.classList.toggle('hidden', !loading);
        if (text) {
            const textEl = el.querySelector('div:last-child');
            if (textEl) textEl.textContent = text;
        }
    }
}

/** 打开分享对话框。 */
export function openShareModal() {
    if (!shareModal) return;
    shareModal.classList.add('show');
    shareOverlay.classList.add('show');
    const preview = $('shareCardPreview');
    if (preview) preview.innerHTML = '<div class="share-preview-tip">点击「生成卡片」预览</div>';
}

/** 关闭分享对话框。 */
export function closeShareModal() {
    if (shareModal) shareModal.classList.remove('show');
    if (shareOverlay) shareOverlay.classList.remove('show');
}

/** 显示分享卡片预览图。 */
export function setShareCardPreview(dataURL) {
    const preview = $('shareCardPreview');
    if (preview) {
        preview.innerHTML = `<img src="${dataURL}" alt="分享卡片" /><button class="share-download-btn" id="shareDownloadBtn">下载卡片</button>`;
        const dl = $('shareDownloadBtn');
        if (dl) dl.onclick = () => {
            const a = document.createElement('a');
            a.download = '流光绘卷-分享卡片.png';
            a.href = dataURL; a.click();
        };
    }
}

// ============================================================
//  图层面板
// ============================================================

/** 关闭图层面板抽屉。 */
export function closeLayerPanel() {
    if (layerDrawer) layerDrawer.classList.remove('show');
    if (layerOverlay) layerOverlay.classList.remove('show');
}

/**
 * 渲染图层列表。
 * @param {{layers: Array<{id,name,visible,opacity,active}>, activeId: number}} snap 图层状态摘要
 * @param {Object} handlers 操作回调集合
 *   - onSelect(id) 选中为活跃图层
 *   - onToggleVisible(id) 切换显隐
 *   - onOpacity(id, v) 设置不透明度 [0,1]
 *   - onAdd() 新增图层
 *   - onRemove(id) 删除图层
 *   - onMove(id, dir) 移动顺序 (-1 下移 / 1 上移)
 *   - onRename(id, name) 重命名
 *   - onMerge() 合并所有图层
 */
const BLEND_MODES = [
    { value: 'source-over', label: '正常' },
    { value: 'multiply', label: '正片叠底' },
    { value: 'screen', label: '滤色' },
    { value: 'overlay', label: '叠加' },
    { value: 'soft-light', label: '柔光' },
    { value: 'hard-light', label: '强光' },
    { value: 'difference', label: '差值' },
    { value: 'exclusion', label: '排除' },
];

export function renderLayers(snap, handlers) {
    if (!layerBody) return;
    const list = snap.layers.slice().reverse();
    layerBody.innerHTML = `
        <div class="layer-toolbar">
            <button class="layer-act" data-act="add" title="新建图层">${iconHTML('plus')}</button>
            <button class="layer-act" data-act="merge" title="合并所有图层">${iconHTML('merge')}</button>
            <span class="layer-count">${snap.layers.length}/8</span>
        </div>
        <div class="layer-list">
            ${list.map(l => `
                <div class="layer-item ${l.active ? 'active' : ''} ${!l.visible ? 'hidden-layer' : ''}" data-id="${l.id}">
                        <div class="layer-name" data-act="rename" title="点击重命名">${escapeHTML(l.name)}</div>
                        <div class="layer-controls">
                            <button class="layer-vis" data-act="vis" title="${l.visible ? '隐藏' : '显示'}">${iconHTML(l.visible ? 'eye' : 'eyeOff')}</button>
                            <select class="layer-blend" data-act="blend" title="混合模式">
                                ${BLEND_MODES.map(m => `<option value="${m.value}" ${l.blendMode === m.value ? 'selected' : ''}>${m.label}</option>`).join('')}
                            </select>
                            <input type="range" class="layer-opacity" min="0" max="1" step="0.05" value="${l.opacity}" data-act="opacity" title="不透明度 ${Math.round(l.opacity * 100)}%" />
                            <button class="layer-act" data-act="up" title="上移">${iconHTML('arrowUp')}</button>
                            <button class="layer-act" data-act="down" title="下移">${iconHTML('arrowDown')}</button>
                            <button class="layer-act del" data-act="del" title="删除">${iconHTML('trash')}</button>
                        </div>
                    </div>
            `).join('')}
        </div>
    `;
    layerBody.querySelectorAll('.layer-item').forEach(el => {
        const id = parseInt(el.dataset.id);
        el.querySelector('.layer-name').onclick = () => { handlers.onSelect(id); };
        el.querySelector('[data-act="vis"]').onclick = (e) => { e.stopPropagation(); handlers.onToggleVisible(id); };
        el.querySelector('[data-act="opacity"]').oninput = (e) => { e.stopPropagation(); handlers.onOpacity(id, parseFloat(e.target.value)); };
        el.querySelector('[data-act="blend"]').onchange = (e) => { e.stopPropagation(); handlers.onBlendMode(id, e.target.value); };
        el.querySelector('[data-act="up"]').onclick = (e) => { e.stopPropagation(); handlers.onMove(id, 1); };
        el.querySelector('[data-act="down"]').onclick = (e) => { e.stopPropagation(); handlers.onMove(id, -1); };
        el.querySelector('[data-act="del"]').onclick = (e) => { e.stopPropagation(); handlers.onRemove(id); };
        el.querySelector('[data-act="rename"]').ondblclick = (e) => {
            e.stopPropagation();
            const cur = el.querySelector('.layer-name').textContent;
            const name = prompt('重命名图层：', cur);
            if (name && name.trim()) handlers.onRename(id, name.trim());
        };
    });
    layerBody.querySelector('[data-act="add"]').onclick = () => handlers.onAdd();
    layerBody.querySelector('[data-act="merge"]').onclick = () => handlers.onMerge();
}

/** 打开图层面板。 */
export function openLayerPanel() {
    if (layerDrawer) layerDrawer.classList.add('show');
    if (layerOverlay) layerOverlay.classList.add('show');
}

// ============================================================
//  撤销历史预览
// ============================================================

/**
 * 渲染撤销/重做快照网格。
 * 顶部为「当前状态」（undo 栈顶），下方依次为可撤销的更早快照；
 * 末尾灰度项为可重做的快照。
 * @param {Object} handlers { onUndoTo(targetIndex), onRedoTo(targetIndex) }
 */
export function renderUndoPreview(handlers) {
    if (!undoPreviewGrid) return;
    // undo 栈：末尾为最近（栈顶=当前），倒序后顶→底 = 最近→最早
    const undoItems = history.undo.slice().reverse();
    // redo 栈：末尾为最近可重做，正序展示（旧→新）
    const redoItems = history.redo.slice();
    if (undoItems.length === 0 && redoItems.length === 0) {
        undoPreviewGrid.innerHTML = '<div class="up-empty">暂无历史快照</div>';
        return;
    }
    let html = '';
    // 当前状态：undo 栈顶（undoItems[0]）
    undoItems.forEach((snap, i) => {
        // i=0 是当前状态，targetIndex = history.undo.length - 1 - i（剩余 undo 长度）
        const targetIndex = history.undo.length - 1 - i;
        const isCurrent = (i === 0);
        html += `<div class="up-item ${isCurrent ? 'current' : ''}" data-act="undo" data-idx="${targetIndex}" title="${isCurrent ? '当前' : '撤销到此步'}">
            <img src="${snap}" alt="快照" loading="lazy" />
            <span class="up-tag">${isCurrent ? '当前' : '#' + (history.undo.length - i)}</span>
        </div>`;
    });
    // redo 项：灰度，点击重做到该步
    redoItems.forEach((snap, i) => {
        const targetIndex = i + 1; // 重做到 redo 剩余长度 = i+1
        html += `<div class="up-item redo" data-act="redo" data-idx="${targetIndex}" title="重做到此步">
            <img src="${snap}" alt="重做快照" loading="lazy" />
            <span class="up-tag">↻${i + 1}</span>
        </div>`;
    });
    undoPreviewGrid.innerHTML = html;
    undoPreviewGrid.querySelectorAll('.up-item').forEach(el => {
        el.onclick = () => {
            const act = el.dataset.act;
            const idx = parseInt(el.dataset.idx);
            if (act === 'undo' && handlers.onUndoTo) handlers.onUndoTo(idx);
            else if (act === 'redo' && handlers.onRedoTo) handlers.onRedoTo(idx);
        };
    });
}

/** 打开撤销预览面板。 */
export function openUndoPreview() {
    if (undoPreview) { undoPreview.classList.add('show'); undoPreview.setAttribute('aria-hidden', 'false'); }
}

/** 关闭撤销预览面板。 */
export function closeUndoPreview() {
    if (undoPreview) { undoPreview.classList.remove('show'); undoPreview.setAttribute('aria-hidden', 'true'); }
}

// ============================================================
//  情绪日记
// ============================================================

/** 打开日记模态，加载并渲染近 7 天数据。 */
export async function openDiary() {
    diaryModal.classList.add('show');
    diaryOverlay.classList.add('show');
    try {
        const entries = await db.all('diary');
        drawDiaryChart(entries);
        renderDiaryList(entries);
    } catch (e) {
        $('diaryList').innerHTML = '<div style="text-align:center;color:var(--text-dim);padding:20px;">暂无日记</div>';
    }
}

/** 关闭日记模态。 */
export function closeDiary() {
    diaryModal.classList.remove('show');
    diaryOverlay.classList.remove('show');
}

/** 绘制近 7 天心情柱状图。 */
export function drawDiaryChart(entries) {
    const cv = $('diaryChart'), cx = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    cx.clearRect(0, 0, w, h);
    // 近 7 天
    const days = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
        const d = new Date(now); d.setDate(now.getDate() - i); d.setHours(0,0,0,0);
        days.push({ date: d, moods: [] });
    }
    entries.forEach(e => {
        const ed = new Date(e.date); ed.setHours(0,0,0,0);
        for (const d of days) {
            if (d.date.getTime() === ed.getTime()) { d.moods.push(e.mood || 3); break; }
        }
    });
    // 网格
    cx.strokeStyle = 'rgba(255,255,255,0.06)'; cx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
        const y = h - (i / 5) * h;
        cx.beginPath(); cx.moveTo(30, y); cx.lineTo(w - 10, y); cx.stroke();
    }
    // 柱状
    const barW = (w - 50) / 7;
    days.forEach((d, i) => {
        const x = 35 + i * barW;
        const avg = d.moods.length ? d.moods.reduce((a,b)=>a+b,0) / d.moods.length : 0;
        const barH = (avg / 5) * (h - 30);
        const grad = cx.createLinearGradient(0, h - barH - 10, 0, h - 10);
        grad.addColorStop(0, '#fbbf24'); grad.addColorStop(1, '#f59e0b');
        cx.fillStyle = grad;
        cx.fillRect(x + 8, h - barH - 10, barW - 16, barH);
        // 日期
        cx.fillStyle = 'rgba(255,255,255,0.4)';
        cx.font = '10px sans-serif'; cx.textAlign = 'center';
        cx.fillText(['日','一','二','三','四','五','六'][d.date.getDay()], x + barW / 2, h - 2);
    });
}

/** 渲染日记列表（最多 20 条）。 */
export function renderDiaryList(entries) {
    if (entries.length === 0) {
        $('diaryList').innerHTML = '<div class="empty-state"><div class="empty-icon">📝</div><div class="empty-title">还没有心情记录</div><div class="empty-desc">保存作品时会自动记录心情</div></div>';
        return;
    }
    $('diaryList').innerHTML = entries.slice(0, 20).map(e => `
        <div class="diary-entry">
            ${e.thumb ? `<img class="de-thumb" src="${e.thumb}" />` : '<div class="de-thumb"></div>'}
            <div class="de-body">
                <div class="de-head">
                    <span class="de-date">${formatDateTime(e.date)}</span>
                    <span class="de-mood">${'★'.repeat(e.mood || 3)}</span>
                </div>
                <div class="de-note">${escapeHTML(e.note || e.name || '无笔记')}</div>
            </div>
        </div>
    `).join('');
}

// ============================================================
//  新手引导
// ============================================================

const onboard = $('onboard'), onboardSpot = $('onboardSpot'), onboardCard = $('onboardCard');
const onboardSteps = [
    { title: '开始绘制', text: '在画布上按住鼠标拖动，即可生成流光粒子。试试不同速度与方向，感受流光的流动。', target: null },
    { title: '切换主题', text: '点击下方的彩色圆形按钮切换色彩主题，已有粒子会平滑过渡到新色调。', target: '.theme-btn[data-theme="ocean"]' },
    { title: '探索更多', text: '试试自动模式、保留路径、音频反应，或保存作品到作品库。点击「跳过」随时结束引导。', target: '#saveBtn' },
];
let onboardStep = 0;

function showOnboardStep() {
    const s = onboardSteps[onboardStep];
    $('obProgress').textContent = `第 ${onboardStep + 1} / ${onboardSteps.length} 步`;
    $('obTitle').textContent = s.title;
    $('obText').textContent = s.text;
    if (s.target) {
        const el = document.querySelector(s.target);
        if (el) {
            const r = el.getBoundingClientRect();
            onboardSpot.style.left = (r.left - 6) + 'px';
            onboardSpot.style.top = (r.top - 6) + 'px';
            onboardSpot.style.width = (r.width + 12) + 'px';
            onboardSpot.style.height = (r.height + 12) + 'px';
            onboardSpot.style.borderRadius = '32px';
            // 卡片定位
            const cardW = 260;
            let cx = r.left + r.width / 2 - cardW / 2;
            cx = clamp(cx, 16, window.innerWidth - cardW - 16);
            let cy = r.top - 180;
            if (cy < 16) cy = r.bottom + 16;
            onboardCard.style.left = cx + 'px';
            onboardCard.style.top = cy + 'px';
        }
    } else {
        onboardSpot.style.left = '50%'; onboardSpot.style.top = '40%';
        onboardSpot.style.width = '0'; onboardSpot.style.height = '0';
        onboardCard.style.left = (window.innerWidth / 2 - 130) + 'px';
        onboardCard.style.top = (window.innerHeight / 2 + 60) + 'px';
    }
}

/** 开始新手引导。 */
export function startOnboard() { onboardStep = 0; onboard.classList.add('show'); showOnboardStep(); }

/** 结束新手引导（标记 localStorage）。 */
export function endOnboard() { onboard.classList.remove('show'); localStorage.setItem('liuguang_onboarded', '1'); }

// ============================================================
//  启动页
// ============================================================

const splash = $('splash');

/** 隐藏启动页。 */
export function hideSplash() { splash.classList.add('gone'); }

// ============================================================
//  FPS 监控更新（由 main.js 注入的回调调用）
// ============================================================

/** 更新 FPS 监控 DOM。 */
export function onFPS(data) {
    if (fpsMonitor.classList.contains('hidden')) return;
    // Phase 5.2：粒子计数颜色随容量变化（<50% 绿 / >80% 橙 / >95% 红）
    const ratio = data.max ? data.count / data.max : 0;
    const pClass = ratio > 0.95 ? 'pcrit' : ratio > 0.8 ? 'pwarn' : 'pok';
    fpsMonitor.innerHTML = `<span>${data.fps} FPS</span> · <span class="${pClass}">${data.count}/${data.max}</span>`;
    fpsMonitor.classList.toggle('warn', data.warn);
    fpsMonitor.classList.toggle('bad', data.bad);
    if (data.degraded) showToast('性能优化：已降低粒子上限', null);
}

// ============================================================
//  initUI：绑定不依赖 particle/audio 编排的事件处理器
// ============================================================

/**
 * 初始化 UI 事件绑定。
 * 由 main.js 在所有模块加载后调用。
 * 仅绑定：滑块、FPS 监控点击、折叠、保存对话框星星/取消、
 * 画廊关闭、日记关闭、引导下一步/跳过、启动页跳过、设置按钮切换。
 */
export function initUI() {
    // 滑块（仅写 state + 更新数值显示 + 持久化）
    sizeSlider.oninput = () => { state.size = parseFloat(sizeSlider.value); sizeVal.textContent = state.size.toFixed(1); persistState(); };
    speedSlider.oninput = () => { state.speed = parseFloat(speedSlider.value); speedVal.textContent = state.speed.toFixed(1); persistState(); };
    densitySlider.oninput = () => { state.density = parseInt(densitySlider.value); densityVal.textContent = state.density; persistState(); };
    trailSlider.oninput = () => { state.trail = parseFloat(trailSlider.value); trailVal.textContent = state.trail.toFixed(2); persistState(); };
    if (eraserSizeSlider) eraserSizeSlider.oninput = () => { state.eraserSize = parseInt(eraserSizeSlider.value); eraserSizeVal.textContent = state.eraserSize; persistState(); };
    if (brushSizeSlider) brushSizeSlider.oninput = () => { state.brushSize = parseInt(brushSizeSlider.value); brushSizeVal.textContent = state.brushSize; persistState(); };
    if (brushOpacitySlider) brushOpacitySlider.oninput = () => { state.opacity = parseInt(brushOpacitySlider.value) / 100; brushOpacityVal.textContent = brushOpacitySlider.value + '%'; persistState(); };

    // FPS 监控点击隐藏
    if (fpsMonitor) fpsMonitor.addEventListener('click', () => { fpsMonitor.classList.add('hidden'); });

    // 控制面板展开行（滑块）切换
    if (moreBtn) moreBtn.addEventListener('click', toggleExpand);

    // 保存对话框
    const saveStars = $('saveStars');
    if (saveStars) {
        saveStars.querySelectorAll('.star-btn').forEach(b => {
            b.onclick = () => { saveMood = parseInt(b.dataset.v); updateStars(); };
        });
    }
    const saveCancel = $('saveCancel');
    if (saveCancel) saveCancel.onclick = closeSaveModal;

    // 画廊关闭
    const galleryClose = $('galleryClose');
    if (galleryClose) galleryClose.onclick = closeGallery;
    if (galleryOverlay) galleryOverlay.onclick = closeGallery;

    // 灵感画廊关闭
    if (inspCloseBtn) inspCloseBtn.onclick = closeInspDrawer;
    if (inspOverlay) inspOverlay.onclick = closeInspDrawer;

    // AI 对话框 tab 切换 + 文件名显示
    document.querySelectorAll('.ai-tab').forEach(b => {
        b.onclick = () => _switchAITab(b.dataset.tab);
    });
    const aiStyleFile = $('aiStyleFile');
    const aiStyleFileName = $('aiStyleFileName');
    const aiStyleClear = $('aiStyleClear');
    const updateStyleFileDisplay = () => {
        if (!aiStyleFile || !aiStyleFileName) return;
        const f = aiStyleFile.files[0];
        aiStyleFileName.textContent = f ? f.name : '未选择图片';
        if (aiStyleClear) aiStyleClear.style.display = f ? 'block' : 'none';
    };
    if (aiStyleFile) aiStyleFile.onchange = updateStyleFileDisplay;
    if (aiStyleClear) aiStyleClear.onclick = () => {
        aiStyleFile.value = '';
        updateStyleFileDisplay();
    };
    const aiCancel = $('aiCancel');
    if (aiCancel) aiCancel.onclick = closeAIModal;
    const aiCancel2 = $('aiCancel2');
    if (aiCancel2) aiCancel2.onclick = closeAIModal;
    if (aiOverlay) aiOverlay.onclick = closeAIModal;

    // 分享对话框关闭
    const shareCancel = $('shareCancel');
    if (shareCancel) shareCancel.onclick = closeShareModal;
    if (shareOverlay) shareOverlay.onclick = closeShareModal;

    // 图层面板关闭
    const layerClose = $('layerClose');
    if (layerClose) layerClose.onclick = closeLayerPanel;
    if (layerOverlay) layerOverlay.onclick = closeLayerPanel;

    // 日记关闭
    const diaryClose = $('diaryClose');
    if (diaryClose) diaryClose.onclick = closeDiary;
    if (diaryOverlay) diaryOverlay.onclick = closeDiary;

    // 引导
    const obNext = $('obNext');
    if (obNext) obNext.onclick = () => {
        onboardStep++;
        if (onboardStep >= onboardSteps.length) endOnboard();
        else showOnboardStep();
    };
    const obSkip = $('obSkip');
    if (obSkip) obSkip.onclick = endOnboard;

    // 启动页跳过
    const splashSkip = $('splashSkip');
    if (splashSkip) splashSkip.onclick = hideSplash;

    // 设置按钮切换
    if (settingsBtn && settingsMenu) {
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            buildSettingsMenu();
            settingsMenu.classList.toggle('show');
        });
    }
    
    // 参数按钮切换
    if (paramsBtn) {
        paramsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleParamsMenu();
        });
    }
    
    document.addEventListener('click', (e) => {
        if (settingsMenu && !settingsMenu.contains(e.target) && e.target !== settingsBtn) settingsMenu.classList.remove('show');
        if (audioStyleMenu && !audioStyleMenu.contains(e.target) && e.target !== audioBtn) audioStyleMenu.classList.remove('show');
        if (paramsMenu && !paramsMenu.contains(e.target) && (!paramsBtn || e.target !== paramsBtn)) closeParamsMenu();
    });

    // Phase 5.2：按钮涟漪 — pointerdown 时在点击位置注入扩散动画
    if (controls) {
        controls.addEventListener('pointerdown', (e) => {
            const btn = e.target.closest('.ctrl-btn, .theme-btn, .preset-btn, .tag-chip');
            if (!btn) return;
            const r = btn.getBoundingClientRect();
            const ripple = document.createElement('span');
            ripple.className = 'ripple';
            ripple.style.left = (e.clientX - r.left) + 'px';
            ripple.style.top = (e.clientY - r.top) + 'px';
            btn.appendChild(ripple);
            setTimeout(() => ripple.remove(), 600);
        });
    }

    // Phase 5.2：滑块预览 — 拖动时数值放大 1.5x + accent 色
    [[sizeSlider, sizeVal], [speedSlider, speedVal], [densitySlider, densityVal], [trailSlider, trailVal], [eraserSizeSlider, eraserSizeVal]].forEach(([sl, val]) => {
        if (!sl || !val) return;
        const on = () => val.classList.add('preview');
        const off = () => val.classList.remove('preview');
        sl.addEventListener('pointerdown', on);
        sl.addEventListener('pointerup', off);
        sl.addEventListener('pointerleave', off);
        sl.addEventListener('pointercancel', off);
    });

    _initConfirmDialog();
}
