/**
 * inspirations.js — 灵感画廊与每日挑战（Phase 6.3 / 6.4）
 *
 * 职责：
 *   - 提供 20+ 套预设作品参数和形状模板（太阳、月亮、云朵等），供灵感画廊展示与加载
 *   - 提供 30 条每日挑战提示，按日期循环
 *   - renderInspirationThumb：离屏 canvas 渲染预设缩略图（首次调用时生成，缓存）
 *
 * 依赖：无（纯数据 + 离屏 canvas，零外部依赖）
 *
 * 用法：
 *   import { INSPIRATIONS, getTodayChallenge, renderInspirationThumb } from './inspirations.js';
 *   const thumb = renderInspirationThumb(INSPIRATIONS[0]); // dataURL
 */

// ============================================================
//  形状模板 SVG 路径（用于画布模板引导）
// ============================================================

/**
 * 形状模板：SVG path d 属性，已标准化到 200×200 视口，中心在 (100,100)
 */
export const SHAPE_TEMPLATES = {
    sun: {
        name: '太阳',
        path: 'M100,20 L105,80 L165,85 L115,125 L125,185 L100,150 L75,185 L85,125 L35,85 L95,80 Z',
        desc: '放射光芒的太阳'
    },
    moon: {
        name: '月亮',
        path: 'M150,100 A50,50 0 1,1 100,50 A30,30 0 1,0 150,100',
        desc: '弯弯新月'
    },
    cloud: {
        name: '云朵',
        path: 'M50,100 Q30,80 40,60 Q60,40 85,50 Q100,40 115,50 Q140,35 160,55 Q185,45 195,70 Q210,65 200,90 Q215,100 200,115 Q180,130 155,120 Q140,135 115,125 Q90,135 70,120 Q50,125 40,110 Q30,115 40,100 Z',
        desc: '蓬松云朵'
    },
    wave: {
        name: '海浪',
        path: 'M20,150 Q45,120 70,145 T120,135 T170,150 T220,140 L220,180 L20,180 Z',
        desc: '波浪起伏'
    },
    heart: {
        name: '爱心',
        path: 'M100,160 C60,120 30,90 30,60 C30,35 50,20 75,20 C95,20 110,30 120,45 C130,30 145,20 165,20 C190,20 210,35 210,60 C210,90 180,120 140,160 C125,175 115,180 100,180 C85,180 75,175 60,160 Z',
        desc: '心形图案'
    },
    star: {
        name: '星星',
        path: 'M100,20 L115,80 L180,80 L125,120 L145,180 L100,145 L55,180 L75,120 L20,80 L85,80 Z',
        desc: '五角星'
    },
    snowflake: {
        name: '雪花',
        path: 'M100,10 L102,60 L152,62 L112,92 L122,142 L100,112 L78,142 L88,92 L48,62 L98,60 L100,10 M100,30 L101,50 L120,52 L108,62 L110,82 L100,72 L90,82 L92,62 L80,52 L99,50 Z',
        desc: '六角雪花'
    },
    leaf: {
        name: '树叶',
        path: 'M100,180 C50,150 20,100 30,60 C40,30 70,20 100,30 C130,20 160,30 170,60 C180,100 150,150 100,180 M100,50 Q110,100 95,140',
        desc: '枫叶形状'
    },
    bird: {
        name: '飞鸟',
        path: 'M60,120 Q100,60 140,120 Q120,100 100,110 Q80,100 60,120 M140,120 Q180,80 220,120 Q190,100 160,110',
        desc: '飞翔的鸟'
    },
    flower: {
        name: '花朵',
        path: 'M100,30 L105,55 L130,55 L110,70 L115,95 L100,80 L85,95 L90,70 L70,55 L95,55 Z M100,60 A15,15 0 1,1 100,90 A15,15 0 1,0 100,60',
        desc: '五瓣花朵'
    },
    butterfly: {
        name: '蝴蝶',
        path: 'M100,50 C70,30 40,40 50,70 C30,80 40,110 70,100 C85,95 95,85 100,80 M100,50 C130,30 160,40 150,70 C170,80 160,110 130,100 C115,95 105,85 100,80',
        desc: '蝴蝶'
    },
    tree: {
        name: '树木',
        path: 'M80,180 L120,180 L115,130 L145,130 L105,80 L165,80 L100,20 L35,80 L95,80 L55,130 L85,130 Z',
        desc: '松树'
    },
};

/**
 * 形状模板预设：将形状模板与粒子参数结合
 */
export const SHAPE_PRESETS = [
    { name: '☀ 暖阳', theme: 'fire', shape: 'circle', size: 3.5, speed: 0.6, density: 12, trail: 0.15, template: 'sun', desc: '金色光芒环绕太阳' },
    { name: '🌙 月影', theme: 'ocean', shape: 'sparkle', size: 2.0, speed: 0.3, density: 8, trail: 0.30, template: 'moon', desc: '清冷月光洒满天际' },
    { name: '☁ 云朵', theme: 'aurora', shape: 'circle', size: 2.5, speed: 0.5, density: 10, trail: 0.20, template: 'cloud', desc: '极光云朵飘浮' },
    { name: '🌊 海浪', theme: 'ocean', shape: 'star', size: 2.8, speed: 0.8, density: 14, trail: 0.12, template: 'wave', desc: '蓝色波浪翻滚' },
    { name: '❤️ 心动', theme: 'candy', shape: 'sparkle', size: 3.0, speed: 0.7, density: 11, trail: 0.18, template: 'heart', desc: '粉色爱心绽放' },
    { name: '⭐ 星光', theme: 'rainbow', shape: 'star', size: 2.2, speed: 1.2, density: 15, trail: 0.08, template: 'star', desc: '璀璨星光闪烁' },
    { name: '❄ 雪花', theme: 'aurora', shape: 'sparkle', size: 1.8, speed: 0.4, density: 9, trail: 0.25, template: 'snowflake', desc: '冬日雪花纷飞' },
    { name: '🍃 落叶', theme: 'fire', shape: 'circle', size: 2.5, speed: 0.6, density: 7, trail: 0.22, template: 'leaf', desc: '秋叶飘落' },
    { name: '🕊 飞鸟', theme: 'rainbow', shape: 'star', size: 2.0, speed: 1.0, density: 6, trail: 0.10, template: 'bird', desc: '自由飞鸟翱翔' },
    { name: '🌸 花朵', theme: 'candy', shape: 'sparkle', size: 3.2, speed: 0.5, density: 10, trail: 0.20, template: 'flower', desc: '缤纷花海' },
    { name: '🦋 蝴蝶', theme: 'candy', shape: 'star', size: 2.5, speed: 0.9, density: 8, trail: 0.15, template: 'butterfly', desc: '彩蝶飞舞' },
    { name: '🌲 森林', theme: 'aurora', shape: 'circle', size: 2.8, speed: 0.4, density: 12, trail: 0.28, template: 'tree', desc: '幽静森林' },
];

// ============================================================
//  灵感预设（12 套）
// ============================================================

/**
 * 12 套灵感预设。覆盖 5 主题 × 3 形状的不同组合，参数各异。
 * 每套字段与 main.js 的 state 子集一致，可直接 Object.assign。
 * @typedef {Object} Preset
 * @property {string} name 预设名称
 * @property {string} theme 主题（rainbow/ocean/fire/aurora/candy）
 * @property {string} shape 粒子形状（circle/star/sparkle）
 * @property {number} size 粒子大小 1-6
 * @property {number} speed 速度 0.1-2.0
 * @property {number} density 密度 1-12
 * @property {number} trail 拖尾 0.02-0.4
 * @property {string} desc 描述
 */
export const INSPIRATIONS = [
    { name: '晨雾山谷', theme: 'ocean',   shape: 'circle',   size: 2.0, speed: 0.4, density: 8,  trail: 0.15, desc: '低密度长拖尾，模拟雾气流动' },
    { name: '霓虹夜空', theme: 'rainbow', shape: 'sparkle',  size: 1.5, speed: 1.2, density: 10, trail: 0.06, desc: '高速光点，璀璨星河' },
    { name: '熔岩涌动', theme: 'fire',    shape: 'star',     size: 3.5, speed: 0.6, density: 7,  trail: 0.20, desc: '粗笔慢速，火焰厚重' },
    { name: '极光梦境', theme: 'aurora',  shape: 'circle',   size: 2.5, speed: 0.5, density: 9,  trail: 0.18, desc: '中速长拖尾，极光流转' },
    { name: '糖果泡泡', theme: 'candy',   shape: 'sparkle',  size: 3.0, speed: 0.8, density: 6,  trail: 0.10, desc: '甜美光点，轻盈跳跃' },
    { name: '深海微光', theme: 'ocean',   shape: 'sparkle',  size: 1.8, speed: 0.3, density: 7,  trail: 0.25, desc: '极慢速超长拖尾，幽蓝静谧' },
    { name: '烈焰星辰', theme: 'fire',    shape: 'sparkle',  size: 2.2, speed: 1.5, density: 8,  trail: 0.05, desc: '高速短拖尾，火星飞溅' },
    { name: '彩虹瀑布', theme: 'rainbow', shape: 'circle',   size: 4.0, speed: 0.9, density: 11, trail: 0.12, desc: '粗笔高密度，色彩倾泻' },
    { name: '极光丝带', theme: 'aurora',  shape: 'star',     size: 2.8, speed: 0.7, density: 8,  trail: 0.22, desc: '星形长拖尾，丝带飘舞' },
    { name: '蜜糖漩涡', theme: 'candy',   shape: 'star',     size: 3.2, speed: 0.6, density: 9,  trail: 0.14, desc: '中速星形，甜蜜旋转' },
    { name: '静谧湖面', theme: 'ocean',   shape: 'star',     size: 1.5, speed: 0.2, density: 5,  trail: 0.30, desc: '极慢稀疏，湖面微光' },
    { name: '狂欢乐章', theme: 'rainbow', shape: 'star',     size: 2.5, speed: 1.8, density: 12, trail: 0.04, desc: '极速高密度，狂欢迸发' },
];

// ============================================================
//  每日挑战（30 条，按日期循环）
// ============================================================

/** 30 条每日挑战提示。按 Math.floor(Date.now()/86400000) % 30 取当天挑战。 */
export const DAILY_CHALLENGES = [
    '用冷色调画一幅「雨夜」',
    '只用细笔描一片「落叶」',
    '让粒子填满整个画布',
    '用暖色调表达「清晨」',
    '画一幅只有 3 笔的作品',
    '用音频模式跟随一首歌作画',
    '尝试 5 种主题各画一笔',
    '画一个「漩涡」',
    '用喷枪画一片「星空」',
    '表达「平静」的情绪',
    '表达「热情」的情绪',
    '用保留路径画一条「河流」',
    '画一幅「火焰」主题的作品',
    '用橡皮擦创作（先画再擦出形状）',
    '画一个「心形」',
    '用极光主题画「北极」',
    '画一幅抽象作品',
    '尝试放大画布画细节',
    '用糖果主题画「童年」',
    '画一幅「海浪」',
    '闭眼画一笔，再睁眼完善它',
    '用最低密度画一幅极简作品',
    '画一幅「烟花」',
    '用文字工具在作品上署名',
    '画一个「螺旋」',
    '用海洋主题画「深海」',
    '表达「孤独」的情绪',
    '画一幅「森林」',
    '用粗笔画一个「太阳」',
    '自由创作一幅送给自己的画',
];

/**
 * 获取今日挑战（按日期循环，每日一条）。
 * @returns {string} 今日挑战文本
 */
export function getTodayChallenge() {
    const day = Math.floor(Date.now() / 86400000);
    return DAILY_CHALLENGES[day % DAILY_CHALLENGES.length];
}

// ============================================================
//  缩略图渲染（离屏 canvas，缓存）
// ============================================================

const _thumbCache = new Map();

// 主题色板（与 particle.js THEMES 同步，此处独立维护以避免循环依赖）
const THEME_PALETTE = {
    rainbow: [[0,85,60],[40,88,65],[120,75,55],[200,80,62],[280,78,60],[340,82,62]],
    ocean:   [[200,80,55],[210,75,48],[180,70,52],[160,65,45],[220,70,50],[190,78,58]],
    fire:    [[10,90,55],[25,88,58],[40,85,60],[0,82,52],[45,80,55],[15,85,57]],
    aurora:  [[140,70,55],[160,75,50],[180,68,58],[120,72,52],[100,68,48],[170,72,56]],
    candy:   [[330,80,65],[350,78,62],[20,82,68],[280,70,68],[310,75,65],[0,78,70]],
};

/**
 * 渲染预设缩略图（200×150 离屏 canvas，首次调用时生成并缓存）。
 * 绘制示例粒子图案：从左上到右下的彩色粒子流，体现主题色与形状特征。
 * 如果预设包含模板，则绘制形状轮廓作为引导。
 * @param {Preset} preset 预设对象
 * @returns {string} JPEG dataURL
 */
export function renderInspirationThumb(preset) {
    if (_thumbCache.has(preset.name)) return _thumbCache.get(preset.name);
    const tc = document.createElement('canvas');
    tc.width = 200; tc.height = 150;
    const tctx = tc.getContext('2d');
    tctx.fillStyle = '#0f0f14';
    tctx.fillRect(0, 0, 200, 150);
    
    const palette = THEME_PALETTE[preset.theme] || THEME_PALETTE.rainbow;
    
    // 如果有形状模板，先绘制模板轮廓（半透明）
    if (preset.template && SHAPE_TEMPLATES[preset.template]) {
        const template = SHAPE_TEMPLATES[preset.template];
        tctx.save();
        tctx.translate(100, 75);
        tctx.scale(0.6, 0.6);
        tctx.strokeStyle = 'rgba(255,255,255,0.2)';
        tctx.lineWidth = 2;
        tctx.beginPath();
        tctx.pathData = new Path2D(template.path);
        tctx.stroke(tctx.pathData);
        tctx.restore();
    }
    
    // 模拟粒子轨迹：沿对角线或围绕模板散布粒子
    const n = 60;
    for (let i = 0; i < n; i++) {
        const t = i / n;
        let x, y;
        
        if (preset.template && SHAPE_TEMPLATES[preset.template]) {
            x = 100 + (Math.random() - 0.5) * 140;
            y = 75 + (Math.random() - 0.5) * 100;
        } else {
            x = 20 + t * 160 + (Math.random() - 0.5) * 30;
            y = 20 + t * 110 + (Math.random() - 0.5) * 30;
        }
        
        const [h, s, l] = palette[i % palette.length];
        const r = (preset.size || 2.5) * (0.6 + Math.random() * 0.8);
        tctx.fillStyle = `hsla(${h + (Math.random() - 0.5) * 16}, ${s}%, ${l}%, ${0.5 + Math.random() * 0.4})`;
        if (preset.shape === 'star') {
            _drawStar(tctx, x, y, r * 1.5);
        } else if (preset.shape === 'sparkle') {
            _drawSparkle(tctx, x, y, r * 1.8);
        } else {
            tctx.beginPath();
            tctx.arc(x, y, r, 0, Math.PI * 2);
            tctx.fill();
        }
    }
    
    const url = tc.toDataURL('image/jpeg', 0.7);
    _thumbCache.set(preset.name, url);
    return url;
}

/** 绘制星形（5 角）。 */
function _drawStar(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 === 0 ? r : r * 0.45;
        const x = cx + Math.cos(ang) * rr, y = cy + Math.sin(ang) * rr;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
}

/** 绘制光芒（4 角十字星）。 */
function _drawSparkle(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.quadraticCurveTo(cx, cy, cx + r, cy);
    ctx.quadraticCurveTo(cx, cy, cx, cy + r);
    ctx.quadraticCurveTo(cx, cy, cx - r, cy);
    ctx.quadraticCurveTo(cx, cy, cx, cy - r);
    ctx.fill();
}
