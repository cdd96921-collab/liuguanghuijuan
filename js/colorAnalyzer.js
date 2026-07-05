/**
 * 智能调色板生成器
 * 从画布提取主色调，生成和谐配色方案
 */

/**
 * 从画布提取主要颜色
 * @param {CanvasRenderingContext2D} ctx 画布上下文
 * @param {number} width 画布宽度
 * @param {number} height 画布高度
 * @returns {Array} 颜色数组 [[h,s,l], ...]
 */
export function extractColors(ctx, width, height, sampleStep = 8) {
    try {
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const colorMap = {};
        const threshold = 50;
        
        for (let y = 0; y < height; y += sampleStep) {
            for (let x = 0; x < width; x += sampleStep) {
                const idx = (y * width + x) * 4;
                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];
                const a = data[idx + 3];
                
                if (a < threshold) continue;
                
                const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                if (brightness < 10 || brightness > 245) continue;
                
                const [h, s, l] = rgbToHsl(r, g, b);
                const key = `${Math.round(h / 10)}-${Math.round(s / 10)}-${Math.round(l / 10)}`;
                
                if (!colorMap[key]) {
                    colorMap[key] = { h, s, l, count: 0 };
                }
                colorMap[key].count++;
            }
        }
        
        const colors = Object.values(colorMap)
            .sort((a, b) => b.count - a.count)
            .slice(0, 8)
            .map(c => [Math.round(c.h), Math.round(c.s), Math.round(c.l)]);
        
        return colors;
    } catch (e) {
        return [];
    }
}

/**
 * RGB 转 HSL
 */
function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    
    if (max === min) {
        h = s = 0;
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }
    
    return [h * 360, s * 100, l * 100];
}

/**
 * HSL 转 RGB
 */
export function hslToRgb(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    let r, g, b;
    
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/**
 * 生成和谐配色方案
 * @param {Array} baseColors 基础颜色 [[h,s,l], ...]
 * @returns {Object} 配色方案
 */
export function generatePalettes(baseColors) {
    if (!baseColors || baseColors.length === 0) {
        return getDefaultPalettes();
    }
    
    const mainColor = baseColors[0];
    const [h, s, l] = mainColor;
    
    const palettes = {
        complementary: generateComplementary(h, s, l),
        analogous: generateAnalogous(h, s, l),
        triadic: generateTriadic(h, s, l),
        monochromatic: generateMonochromatic(h, s, l),
        splitComplementary: generateSplitComplementary(h, s, l),
    };
    
    if (baseColors.length > 1) {
        palettes.extracted = baseColors.slice(0, 6);
    }
    
    return palettes;
}

function generateComplementary(h, s, l) {
    const complement = ((h + 180) % 360 + 360) % 360;
    return [
        [h, s, l],
        [complement, s, l],
        [h, Math.max(20, s - 30), Math.min(90, l + 20)],
        [complement, Math.max(20, s - 30), Math.min(90, l + 20)],
    ];
}

function generateAnalogous(h, s, l) {
    return [
        [h, s, l],
        [(h + 30) % 360, s, l],
        [(h - 30 + 360) % 360, s, l],
        [(h + 60) % 360, Math.max(20, s - 20), l],
        [(h - 60 + 360) % 360, Math.max(20, s - 20), l],
    ];
}

function generateTriadic(h, s, l) {
    return [
        [h, s, l],
        [(h + 120) % 360, s, l],
        [(h + 240) % 360, s, l],
        [h, Math.max(20, s - 30), Math.min(90, l + 20)],
        [(h + 120) % 360, Math.max(20, s - 30), Math.min(90, l + 20)],
    ];
}

function generateMonochromatic(h, s, l) {
    return [
        [h, s, l],
        [h, s, Math.max(20, l - 20)],
        [h, s, Math.min(90, l + 20)],
        [h, Math.max(20, s - 30), l],
        [h, Math.min(100, s + 30), l],
    ];
}

function generateSplitComplementary(h, s, l) {
    const complement = ((h + 180) % 360 + 360) % 360;
    return [
        [h, s, l],
        [(complement + 15) % 360, s, l],
        [(complement - 15 + 360) % 360, s, l],
        [h, Math.max(20, s - 30), Math.min(90, l + 20)],
        [(complement + 15) % 360, Math.max(20, s - 30), Math.min(90, l + 20)],
    ];
}

function getDefaultPalettes() {
    return {
        complementary: [[200, 75, 60], [20, 75, 60], [200, 45, 80], [20, 45, 80]],
        analogous: [[200, 75, 60], [230, 75, 60], [170, 75, 60], [260, 55, 60], [140, 55, 60]],
        triadic: [[200, 75, 60], [320, 75, 60], [80, 75, 60], [200, 45, 80], [320, 45, 80]],
        monochromatic: [[200, 75, 60], [200, 75, 40], [200, 75, 80], [200, 45, 60], [200, 100, 60]],
        splitComplementary: [[200, 75, 60], [35, 75, 60], [5, 75, 60], [200, 45, 80], [35, 45, 80]],
    };
}

/**
 * 获取配色方案的背景色
 * @param {Array} palette 调色板颜色数组
 * @returns {string} 背景色
 */
export function getPaletteBackground(palette) {
    if (!palette || palette.length === 0) return '#0f0f14';
    
    const avgL = palette.reduce((sum, c) => sum + c[2], 0) / palette.length;
    const avgH = palette.reduce((sum, c) => sum + c[0], 0) / palette.length;
    
    if (avgL > 60) {
        return `hsl(${avgH}, 20%, 12%)`;
    } else {
        return '#0f0f14';
    }
}