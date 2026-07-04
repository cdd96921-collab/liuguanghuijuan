/**
 * util.js — 纯工具函数模块（零依赖）
 *
 * 职责：提供数学、颜色、字符串、日期等无副作用纯函数。
 * 所有函数不依赖任何外部状态，可独立单元测试（Node 原生测试运行器）。
 *
 * 导出接口：
 *   - lerp(a, b, t)                线性插值
 *   - rand(a, b)                   [a, b) 随机数
 *   - clamp(v, lo, hi)             数值钳制
 *   - lerpHue(a, b, t)             色相最短弧插值（0-360）
 *   - hexToRgba(hex, a)            #rrggbb → rgba() 字符串
 *   - escapeHTML(s)                HTML 特殊字符转义
 *   - formatDate(ts)               时间戳 → "今天 HH:MM" 或 "M/D"
 *   - formatDateTime(ts)           时间戳 → "M/D HH:MM"
 */

// ---------- 数学 ----------
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => Math.random() * (b - a) + a;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------- 色相 ----------
/**
 * 色相最短弧插值：在 0-360 色环上沿最短路径从 a 过渡到 b。
 * @param {number} a 起始色相 [0,360)
 * @param {number} 目标色相 [0,360)
 * @param {number} t 插值因子 [0,1]
 * @returns {number} 插值后的色相 [0,360)
 */
export function lerpHue(a, b, t) {
    let d = ((b - a + 540) % 360) - 180;
    return (a + d * t + 360) % 360;
}

// ---------- 颜色 ----------
/**
 * 将 #rrggbb 十六进制颜色转为 rgba() 字符串。
 * @param {string} hex 形如 "#rrggbb" 的颜色
 * @param {number} a 透明度 [0,1]
 * @returns {string} "rgba(r,g,b,a)"
 */
export function hexToRgba(hex, a) {
    const h = hex.replace('#', '');
    return `rgba(${parseInt(h.substr(0,2),16)},${parseInt(h.substr(2,2),16)},${parseInt(h.substr(4,2),16)},${a})`;
}

/**
 * RGB → HSL 转换（吸管工具取色后用于粒子覆盖色）。
 * @param {number} r 红 [0,255]
 * @param {number} g 绿 [0,255]
 * @param {number} b 蓝 [0,255]
 * @returns {[number, number, number]} [h:0-360, s:0-100, l:0-100]
 */
export function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
            case g: h = ((b - r) / d + 2); break;
            case b: h = ((r - g) / d + 4); break;
        }
        h *= 60;
    }
    return [h, s * 100, l * 100];
}

// ---------- 字符串 ----------
/**
 * 转义 HTML 特殊字符，防止 XSS（用于画廊/日记等动态内容）。
 * @param {string} s 原始字符串
 * @returns {string} 转义后的字符串
 */
export function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ---------- 日期 ----------
/**
 * 格式化时间戳为友好显示：今天显示"今天 HH:MM"，其他显示"M/D"。
 * @param {number} ts 毫秒时间戳
 * @returns {string}
 */
export function formatDate(ts) {
    const d = new Date(ts); const now = new Date();
    if (d.toDateString() === now.toDateString()) return '今天 ' + d.toTimeString().slice(0, 5);
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 格式化时间戳为 "M/D HH:MM" 格式。
 * @param {number} ts 毫秒时间戳
 * @returns {string}
 */
export function formatDateTime(ts) {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
