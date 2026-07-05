/**
 * share.js — 分享导出模块（Phase 7）
 *
 * 职责：
 *   - generateShareCard(artwork, artist)：1080×1080 分享卡片（作品图 + 署名 + 日期 + QR 码）
 *   - exportWebM(durationSec)：MediaRecorder 录制 canvas 流 → 下载 WebM
 *   - 内嵌精简版 QR 码生成器（byte 模式，EC level L，version 1-10）
 *
 * 依赖：
 *   - particle.js：canvas（captureStream）
 *   - ui.js：showToast
 *
 * 用法：
 *   import { generateShareCard, exportWebM } from './share.js';
 *   generateShareCard(artwork, '流光').then(dataURL => { ... });
 *   exportWebM(10); // 录制 10 秒
 */

import { canvas } from './particle.js';
import { showToast } from './ui.js';

// ============================================================
//  内嵌 QR 码生成器（精简版，byte 模式，EC level L）
// ============================================================
// 基于 Kazuhiko Arase 的 qrcode-generator 算法精简实现。
// 支持 version 1-10，byte 模式，纠错等级 L。仅满足分享卡片需求。

// 伽罗瓦域 GF(256) 运算表
const _QR_EXP = new Int32Array(512);
const _QR_LOG = new Int32Array(256);
(function _initGF() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
        _QR_EXP[i] = x;
        _QR_LOG[x] = i;
        x <<= 1;
        if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) _QR_EXP[i] = _QR_EXP[i - 255];
})();

// RS 纠错码生成
function _rsGenPoly(degree) {
    const poly = [1];
    for (let i = 0; i < degree; i++) {
        const next = new Array(poly.length + 1).fill(0);
        for (let j = 0; j < poly.length; j++) {
            next[j] ^= poly[j];
            next[j + 1] ^= _QR_EXP[(_QR_LOG[poly[j]] + i) % 255];
        }
        poly.splice(0, poly.length, ...next);
    }
    return poly;
}

function _rsEncode(data, ecLen) {
    const gen = _rsGenPoly(ecLen);
    const buf = data.concat(new Array(ecLen).fill(0));
    for (let i = 0; i < data.length; i++) {
        const coef = buf[i];
        if (coef === 0) continue;
        for (let j = 0; j < gen.length; j++) {
            buf[i + j] ^= _QR_EXP[(_QR_LOG[gen[j]] + _QR_LOG[coef]) % 255];
        }
    }
    return buf.slice(data.length);
}

// 每个版本的容量信息（EC level L，byte 模式）：[总数据码字数, 纠错码字数 per block, 块数]
// 仅列 version 1-10
const _QR_CAPACITY = {
    1: [19, 7, 1], 2: [34, 10, 1], 3: [55, 15, 1], 4: [80, 20, 1], 5: [108, 26, 1],
    6: [134, 18, 2], 7: [154, 20, 2], 8: [192, 24, 2], 9: [230, 30, 2], 10: [271, 18, 4],
};
// 每个版本的（除定位图案外）尺寸 = 17 + 4*version
const _QR_SIZE = (v) => 17 + 4 * v;

/**
 * 生成 QR 码矩阵（boolean[][]，true = 黑/暗模块）。
 * @param {string} text 编码文本（UTF-8）
 * @returns {boolean[][]|null} 二维矩阵，失败返回 null
 */
function _generateQR(text) {
    // UTF-8 编码
    const bytes = [];
    for (let i = 0; i < text.length; i++) {
        let c = text.charCodeAt(i);
        if (c < 0x80) bytes.push(c);
        else if (c < 0x800) { bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
        else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
            // 代理对（4 字节 UTF-8）
            const c2 = text.charCodeAt(++i);
            const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
            bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        } else { bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
    }

    // 选择版本（容量需容纳 byte 模式头 + 数据）
    let version = 1;
    for (; version <= 10; version++) {
        const cap = _QR_CAPACITY[version][0];
        // byte 模式：4 位模式 + 长度位（v1-9 为 8 位，v10-26 为 16 位）+ 数据*8
        const lenBits = version <= 9 ? 8 : 16;
        const totalBits = 4 + lenBits + bytes.length * 8;
        if (totalBits <= cap * 8) break;
    }
    if (version > 10) return null; // 文本过长
    const [totalCW, ecLen, blocks] = _QR_CAPACITY[version];
    const size = _QR_SIZE(version);

    // 构建位流
    const bits = [];
    const pushBits = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    pushBits(0b0100, 4); // byte 模式
    pushBits(bytes.length, version <= 9 ? 8 : 16); // 长度
    for (const b of bytes) pushBits(b, 8);
    // 填充终止符
    const totalBits = totalCW * 8;
    for (let i = 0; i < 4 && bits.length < totalBits; i++) bits.push(0);
    // 字节对齐
    while (bits.length % 8 !== 0) bits.push(0);
    // 填充码字 0xec 0x11
    const padBytes = [0xec, 0x11];
    let pi = 0;
    while (bits.length < totalBits) { pushBits(padBytes[pi % 2], 8); pi++; }

    // 转为码字数组
    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
        let b = 0;
        for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
        codewords.push(b);
    }

    // 分块 + 纠错
    const blockData = [];
    const blockEc = [];
    const dataPerBlock = Math.floor(totalCW / blocks);
    const extra = totalCW - dataPerBlock * blocks; // 前 extra 块多 1 个数据码字
    let idx = 0;
    for (let b = 0; b < blocks; b++) {
        const dLen = dataPerBlock + (b < extra ? 1 : 0);
        const d = codewords.slice(idx, idx + dLen); idx += dLen;
        blockData.push(d);
        blockEc.push(_rsEncode(d, ecLen));
    }

    // 交错数据 + 纠错码字
    const interleaved = [];
    const maxData = dataPerBlock + (extra > 0 ? 1 : 0);
    for (let i = 0; i < maxData; i++) {
        for (let b = 0; b < blocks; b++) {
            if (i < blockData[b].length) interleaved.push(blockData[b][i]);
        }
    }
    for (let i = 0; i < ecLen; i++) {
        for (let b = 0; b < blocks; b++) interleaved.push(blockEc[b][i]);
    }

    // 转回位流
    const finalBits = [];
    for (const cw of interleaved) {
        for (let i = 7; i >= 0; i--) finalBits.push((cw >> i) & 1);
    }

    // 构建矩阵 + 功能图案
    const matrix = Array.from({ length: size }, () => new Array(size).fill(null)); // null=未定,true=暗,false=亮
    const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

    // 定位图案（三个角）
    const placeFinder = (r0, c0) => {
        for (let r = -1; r <= 7; r++) {
            for (let c = -1; c <= 7; c++) {
                const rr = r0 + r, cc = c0 + c;
                if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
                const isDark = (r === 0 || r === 6 || c === 0 || c === 6) || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
                matrix[rr][cc] = isDark;
                reserved[rr][cc] = true;
            }
        }
    };
    placeFinder(0, 0); placeFinder(0, size - 7); placeFinder(size - 7, 0);

    // 对齐图案（version 2+）
    const alignPos = { 2: [18], 3: [22], 4: [26], 5: [30], 6: [34], 7: [22, 38], 8: [24, 42], 9: [26, 46], 10: [28, 50] };
    if (alignPos[version]) {
        for (const r of alignPos[version]) {
            for (const c of alignPos[version]) {
                // 跳过与定位图案重叠的位置
                if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 8) || (r >= size - 8 && c <= 8)) continue;
                for (let dr = -2; dr <= 2; dr++) {
                    for (let dc = -2; dc <= 2; dc++) {
                        const rr = r + dr, cc = c + dc;
                        const isDark = (Math.abs(dr) === 2 || Math.abs(dc) === 2) || (dr === 0 && dc === 0);
                        matrix[rr][cc] = isDark;
                        reserved[rr][cc] = true;
                    }
                }
            }
        }
    }

    // 时序图案
    for (let i = 8; i < size - 8; i++) {
        if (matrix[6][i] === null) { matrix[6][i] = i % 2 === 0; reserved[6][i] = true; }
        if (matrix[i][6] === null) { matrix[i][6] = i % 2 === 0; reserved[i][6] = true; }
    }

    // 格式信息预留位
    for (let i = 0; i < 9; i++) {
        if (matrix[8][i] === null) { reserved[8][i] = true; matrix[8][i] = false; }
        if (i < 8 && matrix[i][8] === null) { reserved[i][8] = true; matrix[i][8] = false; }
    }
    for (let i = 0; i < 8; i++) {
        const c = size - 1 - i;
        if (matrix[8][c] === null) { reserved[8][c] = true; matrix[8][c] = false; }
        const r = size - 1 - i;
        if (i > 0 && matrix[r][8] === null) { reserved[r][8] = true; matrix[r][8] = false; }
    }
    if (matrix[size - 8][8] === null) { reserved[size - 8][8] = true; matrix[size - 8][8] = true; } // 暗模块

    // 数据填充（Z 字形，从右下角向上）
    let bitIdx = 0;
    let dirUp = true;
    for (let col = size - 1; col > 0; col -= 2) {
        if (col === 6) col--; // 跳过时序列
        for (let i = 0; i < size; i++) {
            const r = dirUp ? size - 1 - i : i;
            for (let dc = 0; dc < 2; dc++) {
                const c = col - dc;
                if (!reserved[r][c] && matrix[r][c] === null) {
                    matrix[r][c] = bitIdx < finalBits.length ? finalBits[bitIdx] === 1 : false;
                    bitIdx++;
                }
            }
        }
        dirUp = !dirUp;
    }

    // 掩码 + 格式信息：尝试 8 种掩码，选惩罚值最低的
    const maskFns = [
        (r, c) => (r + c) % 2 === 0,
        (r, c) => r % 2 === 0,
        (r, c) => c % 3 === 0,
        (r, c) => (r + c) % 3 === 0,
        (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
        (r, c) => ((r * c) % 2 + (r * c) % 3) === 0,
        (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
        (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
    ];

    const applyMask = (mIdx) => {
        const m = matrix.map(row => row.slice());
        const fn = maskFns[mIdx];
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (!reserved[r][c]) m[r][c] = m[r][c] ^ fn(r, c);
            }
        }
        return m;
    };

    const calcPenalty = (m) => {
        let p = 0;
        // 规则 1：连续同色
        for (let r = 0; r < size; r++) {
            let run = 1;
            for (let c = 1; c < size; c++) {
                if (m[r][c] === m[r][c - 1]) { run++; }
                else { if (run >= 5) p += 3 + (run - 5); run = 1; }
            }
            if (run >= 5) p += 3 + (run - 5);
        }
        for (let c = 0; c < size; c++) {
            let run = 1;
            for (let r = 1; r < size; r++) {
                if (m[r][c] === m[r - 1][c]) { run++; }
                else { if (run >= 5) p += 3 + (run - 5); run = 1; }
            }
            if (run >= 5) p += 3 + (run - 5);
        }
        return p;
    };

    let bestMask = 0, bestPenalty = Infinity, bestMatrix = null;
    for (let mi = 0; mi < 8; mi++) {
        const m = applyMask(mi);
        const p = calcPenalty(m);
        if (p < bestPenalty) { bestPenalty = p; bestMask = mi; bestMatrix = m; }
    }

    // 格式信息（EC level L = 01）
    const formatBits = _encodeFormat(0b01, bestMask);
    _writeFormat(bestMatrix, formatBits, size);

    return bestMatrix;
}

// 格式信息编码（BCH 编码）
function _encodeFormat(ecLevel, mask) {
    const data = (ecLevel << 3) | mask;
    let bch = data << 10;
    const g = 0b10100110111;
    for (let i = 14; i >= 10; i--) {
        if ((bch >> i) & 1) bch ^= g << (i - 10);
    }
    const format = ((data << 10) | bch) ^ 0b101010000010010;
    return format;
}

function _writeFormat(matrix, format, size) {
    for (let i = 0; i < 15; i++) {
        const bit = ((format >> i) & 1) === 1;
        // 左上角周围
        if (i < 6) matrix[8][i] = bit;
        else if (i < 8) matrix[8][i + 1] = bit;
        else if (i === 8) matrix[7][8] = bit;
        else matrix[14 - i][8] = bit;
        // 右上 + 左下
        if (i < 8) matrix[size - 1 - i][8] = bit;
        else matrix[8][size - 15 + i] = bit;
    }
}

// ============================================================
//  分享卡片
// ============================================================

/**
 * 将 QR 矩阵绘制到 canvas 指定区域。
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x 左上角 x
 * @param {number} y 左上角 y
 * @param {number} size 绘制尺寸（像素）
 * @param {boolean[][]} matrix QR 矩阵
 */
function _drawQR(ctx, x, y, size, matrix) {
    const n = matrix.length;
    const cell = size / n;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x - 4, y - 4, size + 8, size + 8); // 白边
    ctx.fillStyle = '#0f0f14';
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (matrix[r][c]) ctx.fillRect(x + c * cell, y + r * cell, cell + 0.5, cell + 0.5);
        }
    }
}

/**
 * 生成 1080×1080 分享卡片：居中作品图 + 底部署名 + 日期 + 右下角 QR 码。
 * @param {Object} artwork 作品对象（含 thumb/dataURL, name）
 * @param {string} artist 艺术家署名
 * @returns {Promise<string>} PNG dataURL
 */
export function generateShareCard(artwork, artist) {
    return new Promise((resolve, reject) => {
        const W = 1080, H = 1080;
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const ctx = c.getContext('2d');

        // 背景：深色渐变
        const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
        bgGrad.addColorStop(0, '#0f0f14');
        bgGrad.addColorStop(1, '#1a1a24');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, W, H);

        // 作品图加载
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            // 作品区域：居中，留白边
            const imgSize = 760;
            const imgX = (W - imgSize) / 2;
            const imgY = 90;
            // 圆角裁剪
            ctx.save();
            const radius = 20;
            ctx.beginPath();
            ctx.moveTo(imgX + radius, imgY);
            ctx.arcTo(imgX + imgSize, imgY, imgX + imgSize, imgY + imgSize, radius);
            ctx.arcTo(imgX + imgSize, imgY + imgSize, imgX, imgY + imgSize, radius);
            ctx.arcTo(imgX, imgY + imgSize, imgX, imgY, radius);
            ctx.arcTo(imgX, imgY, imgX + imgSize, imgY, radius);
            ctx.closePath();
            ctx.clip();
            // 等比填充
            const ir = img.width / img.height;
            let dw = imgSize, dh = imgSize;
            if (ir > 1) dh = imgSize / ir; else dw = imgSize * ir;
            ctx.drawImage(img, imgX + (imgSize - dw) / 2, imgY + (imgSize - dh) / 2, dw, dh);
            ctx.restore();

            // 标题
            ctx.fillStyle = '#ffffff';
            ctx.font = '600 42px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(artwork.name || '未命名流光', W / 2, 900);

            // 署名 + 日期
            const dateStr = new Date().toLocaleDateString('zh-CN');
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.font = '300 26px system-ui, sans-serif';
            ctx.fillText(`流光绘卷 · ${artist || '匿名'} · ${dateStr}`, W / 2, 950);

            // QR 码（右下角）
            const qrText = `流光绘卷 · ${artwork.name || '未命名'} · ${artist || '匿名'} · ${dateStr}`;
            const qrMatrix = _generateQR(qrText);
            if (qrMatrix) {
                _drawQR(ctx, W - 180, H - 180, 140, qrMatrix);
            }

            // 品牌水印（左下）
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.font = '300 22px system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('✦ 流光绘卷', 40, H - 40);

            resolve(c.toDataURL('image/png'));
        };
        img.onerror = () => reject(new Error('作品图片加载失败'));
        img.src = artwork.dataURL || artwork.thumb;
    });
}

// ============================================================
//  WebM 动画导出
// ============================================================

let _recording = false;

/** 是否正在录制。 */
export function isRecording() { return _recording; }

/**
 * 导出 WebM 动画：录制 canvas 流指定时长后停止并下载。
 * @param {number} durationSec 录制时长（秒），默认 10
 * @returns {Promise<boolean>} 是否成功
 */
export function exportWebM(durationSec = 10) {
    return new Promise((resolve) => {
        if (_recording) { showToast('正在录制中，请稍候', null); resolve(false); return; }
        if (!canvas.captureStream) { showToast('当前浏览器不支持视频录制', null); resolve(false); return; }

        const stream = canvas.captureStream(30);
        // VP9 优先，不支持回退 VP8，再不支持用默认
        let mimeType = 'video/webm;codecs=vp9';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/webm;codecs=vp8';
            if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';
        }
        let recorder;
        try {
            recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4000000 });
        } catch (e) {
            showToast('MediaRecorder 初始化失败', null);
            resolve(false);
            return;
        }

        const chunks = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = () => {
            _recording = false;
            const blob = new Blob(chunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.download = `流光绘卷-动画-${Date.now()}.webm`;
            a.href = url; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            showToast('WebM 动画已导出', null);
            resolve(true);
        };

        _recording = true;
        recorder.start();

        // 倒计时提示
        let remaining = Math.ceil(durationSec);
        showToast(`录制中 · 剩余 ${remaining}s`, null);
        const timer = setInterval(() => {
            remaining--;
            if (remaining > 0) {
                showToast(`录制中 · 剩余 ${remaining}s`, null);
            } else {
                clearInterval(timer);
                try { recorder.stop(); } catch (e) {}
            }
        }, 1000);

        // 安全超时（避免计时器异常）
        setTimeout(() => {
            if (_recording) { clearInterval(timer); try { recorder.stop(); } catch (e) {} }
        }, durationSec * 1000 + 500);
    });
}
