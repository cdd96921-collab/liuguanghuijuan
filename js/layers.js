/**
 * layers.js — 图层管理模块
 *
 * 职责：
 *   - 管理多个离屏 canvas（图层），每帧合成到主 canvas
 *   - 拖尾衰减作用于活跃图层（destination-out 透明衰减，而非 bg 色覆盖）
 *   - 图层增删/上下移/显隐/不透明度/激活切换
 *   - 快照（合成所有图层）与恢复（绘到活跃图层）
 *   - 尺寸自适应（保留内容）
 *
 * 架构（Model E）：
 *   拖尾/粒子直接画到"活跃图层"的离屏 canvas；
 *   每帧主 canvas 先填 bg → 合成所有可见图层。
 *   图层保持透明，destination-out 衰减不会让图层变不透明。
 *
 * 依赖：无（纯自包含，仅 DOM canvas API）
 * 被依赖：particle.js（渲染管线）、main.js（init/编排）、ui.js（图层面板）
 */

// ============================================================
//  内部状态
// ============================================================

let _w = 0;       // CSS 像素宽
let _h = 0;       // CSS 像素高
let _dpr = 1;     // 设备像素比
let _nextId = 1;
const MAX_LAYERS = 8;

/**
 * 图层管理器。
 * layers 数组顺序即绘制顺序：index 0 在最底，length-1 在最顶。
 */
export const layerManager = {
    layers: [],          // [{id, name, canvas, ctx, visible, opacity}]
    activeId: null,
    _changeCB: null,

    /** 注册图层变化回调（ui.js 订阅以刷新图层面板）。 */
    setChangeCB(fn) { this._changeCB = fn; },

    _notify() { if (this._changeCB) this._changeCB(this.getSnapshot()); },

    /** 返回面板所需的图层状态摘要（不含 canvas 引用，避免泄漏）。 */
    getSnapshot() {
        return {
            layers: this.layers.map(l => ({
                id: l.id, name: l.name, visible: l.visible,
                opacity: l.opacity, blendMode: l.blendMode,
                active: l.id === this.activeId,
            })),
            activeId: this.activeId,
        };
    },

    /**
     * 初始化：创建默认"绘画层"。
     * @param {number} w CSS 像素宽
     * @param {number} h CSS 像素高
     * @param {number} dpr 设备像素比
     */
    init(w, h, dpr) {
        _w = w; _h = h; _dpr = dpr;
        this.layers = [];
        _nextId = 1;
        const layer = this._createLayer('绘画层');
        this.layers.push(layer);
        this.activeId = layer.id;
        this._notify();
    },

    /** 创建一个图层对象（离屏 canvas + ctx，DPR 变换已设置）。 */
    _createLayer(name) {
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.floor(_w * _dpr));
        c.height = Math.max(1, Math.floor(_h * _dpr));
        const cx = c.getContext('2d');
        cx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
        return { id: _nextId++, name, canvas: c, ctx: cx, visible: true, opacity: 1, blendMode: 'source-over' };
    },

    /** 新增图层（置顶并激活）。受 MAX_LAYERS 限制。 */
    add(name) {
        if (this.layers.length >= MAX_LAYERS) return null;
        const layer = this._createLayer(name || `图层 ${this.layers.length + 1}`);
        this.layers.push(layer);
        this.activeId = layer.id;
        this._notify();
        return layer;
    },

    /** 删除图层（至少保留一层）。 */
    remove(id) {
        if (this.layers.length <= 1) return false;
        const idx = this.layers.findIndex(l => l.id === id);
        if (idx < 0) return false;
        this.layers.splice(idx, 1);
        if (this.activeId === id) {
            const ni = Math.min(idx, this.layers.length - 1);
            this.activeId = this.layers[ni].id;
        }
        this._notify();
        return true;
    },

    /** 移动图层顺序。dir=-1 下移（向底），dir=1 上移（向顶）。 */
    move(id, dir) {
        const idx = this.layers.findIndex(l => l.id === id);
        if (idx < 0) return false;
        const ni = idx + dir;
        if (ni < 0 || ni >= this.layers.length) return false;
        const tmp = this.layers[idx];
        this.layers[idx] = this.layers[ni];
        this.layers[ni] = tmp;
        this._notify();
        return true;
    },

    /** 设置活跃图层。 */
    setActive(id) {
        if (this.layers.some(l => l.id === id)) {
            this.activeId = id;
            this._notify();
            return true;
        }
        return false;
    },

    /** 获取活跃图层对象。 */
    getActive() {
        return this.layers.find(l => l.id === this.activeId) || this.layers[0] || null;
    },

    /** 切换图层显隐。 */
    setVisible(id, visible) {
        const l = this.layers.find(x => x.id === id);
        if (!l) return false;
        l.visible = visible;
        this._notify();
        return true;
    },

    /** 设置图层不透明度。 */
    setOpacity(id, opacity) {
        const l = this.layers.find(x => x.id === id);
        if (!l) return false;
        l.opacity = Math.max(0, Math.min(1, opacity));
        this._notify();
        return true;
    },

    /** 设置图层混合模式。 */
    setBlendMode(id, mode) {
        const l = this.layers.find(x => x.id === id);
        if (!l) return false;
        l.blendMode = mode;
        this._notify();
        return true;
    },

    /** 重命名图层。 */
    rename(id, name) {
        const l = this.layers.find(x => x.id === id);
        if (!l) return false;
        l.name = name;
        this._notify();
        return true;
    },

    /**
     * 尺寸自适应：所有图层重设尺寸，保留原内容（按设备像素缩放复制）。
     * @param {number} w 新 CSS 宽
     * @param {number} h 新 CSS 高
     * @param {number} dpr 新 DPR
     */
    resize(w, h, dpr) {
        _w = w; _h = h; _dpr = dpr;
        for (const layer of this.layers) {
            const oldCanvas = layer.canvas;
            const newW = Math.max(1, Math.floor(w * dpr));
            const newH = Math.max(1, Math.floor(h * dpr));
            const c = document.createElement('canvas');
            c.width = newW; c.height = newH;
            const cx = c.getContext('2d');
            cx.setTransform(dpr, 0, 0, dpr, 0, 0);
            // 复制旧内容（设备像素 → 设备像素，全幅拉伸）
            cx.save();
            cx.setTransform(1, 0, 0, 1, 0, 0);
            cx.drawImage(oldCanvas, 0, 0, newW, newH);
            cx.restore();
            layer.canvas = c;
            layer.ctx = cx;
        }
    },

    /**
     * 合成所有可见图层到目标 ctx。
     * 目标 ctx 应已设置好 DPR 变换；图层按数组顺序绘制（底→顶）。
     * @param {CanvasRenderingContext2D} targetCtx 主 canvas 的 ctx
     */
    composite(targetCtx) {
        for (const layer of this.layers) {
            if (!layer.visible || layer.opacity <= 0) continue;
            targetCtx.globalAlpha = layer.opacity;
            targetCtx.globalCompositeOperation = layer.blendMode;
            // drawImage 用 CSS 尺寸（_w × _h），由 targetCtx 的 DPR 变换映射到设备像素
            targetCtx.drawImage(layer.canvas, 0, 0, _w, _h);
        }
        targetCtx.globalAlpha = 1;
        targetCtx.globalCompositeOperation = 'source-over';
    },

    /**
     * 对活跃图层应用拖尾衰减（destination-out 模式，直接透明擦除）。
     * @param {number} alpha 衰减强度 [0.05, 0.9]
     */
    applyTrailFade(alpha) {
        const layer = this.getActive();
        if (!layer) return;
        const cx = layer.ctx;
        cx.globalCompositeOperation = 'destination-out';
        cx.fillStyle = `rgba(0,0,0,${alpha})`;
        cx.fillRect(0, 0, _w, _h);
        cx.globalCompositeOperation = 'source-over';
    },

    /** 清空活跃图层。 */
    clearActive() {
        const layer = this.getActive();
        if (!layer) return;
        const cx = layer.ctx;
        cx.save();
        cx.setTransform(1, 0, 0, 1, 0, 0);
        cx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        cx.restore();
    },

    /** 清空所有图层。 */
    clearAll() {
        for (const layer of this.layers) {
            const cx = layer.ctx;
            cx.save();
            cx.setTransform(1, 0, 0, 1, 0, 0);
            cx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
            cx.restore();
        }
    },

    /**
     * 合成所有图层 → 返回 PNG dataURL（用于历史快照、保存）。
     * @returns {string} PNG dataURL
     */
    snapshot() {
        const tc = document.createElement('canvas');
        tc.width = Math.max(1, Math.floor(_w * _dpr));
        tc.height = Math.max(1, Math.floor(_h * _dpr));
        const tctx = tc.getContext('2d');
        tctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
        this.composite(tctx);
        return tc.toDataURL('image/png');
    },

    /**
     * 从 dataURL 恢复到活跃图层（清空其它图层）。
     * @param {string} dataURL PNG dataURL
     * @returns {Promise<void>}
     */
    restore(dataURL) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                this.clearAll();
                const layer = this.getActive();
                if (layer) {
                    const cx = layer.ctx;
                    cx.save();
                    cx.setTransform(1, 0, 0, 1, 0, 0);
                    cx.drawImage(img, 0, 0, layer.canvas.width, layer.canvas.height);
                    cx.restore();
                }
                resolve();
            };
            img.onerror = () => resolve();
            img.src = dataURL;
        });
    },

    /** 合并所有图层到活跃图层（合并后其它图层清空，内容并入活跃层）。 */
    mergeAll() {
        if (this.layers.length <= 1) return;
        const target = this.getActive();
        if (!target) return;
        const snap = this.snapshot();
        // 同步等待图片加载较繁琐，用 Image 同步路径
        const img = new Image();
        img.onload = () => {
            this.clearAll();
            const cx = target.ctx;
            cx.save();
            cx.setTransform(1, 0, 0, 1, 0, 0);
            cx.drawImage(img, 0, 0, target.canvas.width, target.canvas.height);
            cx.restore();
            this._notify();
        };
        img.src = snap;
    },
};

/**
 * 返回当前图层尺寸（CSS 像素 + DPR），供 main.js 导入图片时计算居中缩放。
 * @returns {{w: number, h: number, dpr: number}}
 */
export function getDims() {
    return { w: _w, h: _h, dpr: _dpr };
}
