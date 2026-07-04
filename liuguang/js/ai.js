/**
 * ai.js — AI 集成模块（Phase 7）
 *
 * 职责：
 *   - styleTransfer(imageFile)：上传图片 → 调用 qwen-vision → 解析 JSON 调色板与粒子参数
 *   - analyzeEmotion(text)：输入日记文本 → 调用 qwen → 返回匹配主题名
 *   - _callAPI(messages)：fetch 封装，含 30s 超时 + 1 次重试
 *
 * 依赖：无外部依赖（纯 fetch + JSON 解析）
 *
 * 说明：
 *   - API 采用阿里云百炼兼容模式（OpenAI 兼容接口）
 *   - API_KEY 为占位符，用户需替换为真实 Key（见 TODO）
 *   - 风格迁移不直接生成粒子，仅生成调色板与参数（轻量、快速、可控）
 *   - 情绪识别仅映射到已有 5 主题之一，不返回自定义色板
 *
 * 用法：
 *   import { styleTransfer, analyzeEmotion } from './ai.js';
 *   const result = await styleTransfer(file); // {colors, size, speed, density, trail}
 *   const theme = await analyzeEmotion('今天心情很低落'); // 'ocean'
 */

// ============================================================
//  API 配置
// ============================================================

const API_URL = 'https://integrate.api.nvidia.com/v1';
const API_MODEL = 'minimaxai/minimax-m3';
const API_KEY = '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';
const REQUEST_TIMEOUT = 30000; // 30s

// ============================================================
//  请求封装
// ============================================================

/**
 * 调用兼容 OpenAI 格式的聊天接口。
 * @param {Array} messages OpenAI 消息数组
 * @param {boolean} isVision 是否为视觉请求（图片消息）
 * @returns {Promise<string>} 模型回复文本
 * @throws {Error} 网络错误、超时、HTTP 错误码、空回复
 */
async function _callAPI(messages, isVision = false) {
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` };
    const body = JSON.stringify({
        model: API_MODEL,
        messages,
        temperature: isVision ? 1.0 : 0.6,
        max_tokens: isVision ? 8192 : 200,
        top_p: 0.95,
    });

    const doFetch = () => new Promise((resolve, reject) => {
        const controller = new AbortController();
        const timer = setTimeout(() => { controller.abort(); reject(new Error('请求超时（30s）')); }, REQUEST_TIMEOUT);
        fetch(`${API_URL}/chat/completions`, { method: 'POST', headers, body, signal: controller.signal })
            .then(async (res) => {
                clearTimeout(timer);
                if (!res.ok) {
                    const txt = await res.text().catch(() => '');
                    reject(new Error(`HTTP ${res.status} ${res.statusText}${txt ? ': ' + txt.slice(0, 200) : ''}`));
                    return;
                }
                resolve(res.json());
            })
            .catch((e) => { clearTimeout(timer); reject(e); });
    });

    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const data = await doFetch();
            const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
            if (!content) throw new Error('模型返回空内容');
            return content.trim();
        } catch (e) {
            lastErr = e;
            // 401/403（鉴权失败）不重试，直接抛出
            if (String(e.message).includes('HTTP 401') || String(e.message).includes('HTTP 403')) break;
            // 超时或网络错误重试一次
            if (attempt === 0) await new Promise(r => setTimeout(r, 800));
        }
    }
    throw lastErr || new Error('请求失败');
}

// ============================================================
//  功能 1：AI 风格迁移
// ============================================================

/**
 * 将图片转 base64（dataURL）。
 * @param {File} file
 * @returns {Promise<string>}
 */
function _fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('文件读取失败'));
        reader.readAsDataURL(file);
    });
}

/**
 * 从模型回复中提取 JSON 对象（兼容 ```json 代码块包裹）。
 * @param {string} text
 * @returns {Object|null}
 */
function _extractJSON(text) {
    if (!text) return null;
    // 去除 ```json ... ``` 包裹
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenceMatch ? fenceMatch[1] : text;
    // 找到第一个 { ... } 块
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
        return JSON.parse(candidate.slice(start, end + 1));
    } catch (e) { return null; }
}

/**
 * 校验并规范化调色板与参数。
 * @param {Object} raw
 * @returns {Object|null} {colors, size, speed, density, trail}
 */
function _normalizeStyleResult(raw) {
    if (!raw || !Array.isArray(raw.colors) || raw.colors.length < 3) return null;
    // 规范化 colors：每个元素 [h(0-360), s(0-100), l(0-100)]
    const colors = raw.colors.map(c => {
        if (!Array.isArray(c) || c.length < 3) return null;
        const [h, s, l] = c;
        return [
            Math.max(0, Math.min(360, Number(h) || 0)),
            Math.max(0, Math.min(100, Number(s) || 60)),
            Math.max(0, Math.min(100, Number(l) || 60)),
        ];
    }).filter(Boolean);
    if (colors.length < 3) return null;
    const clamp = (v, lo, hi, def) => {
        const n = Number(v); if (isNaN(n)) return def;
        return Math.max(lo, Math.min(hi, n));
    };
    return {
        colors,
        size: clamp(raw.size, 1, 6, 2.5),
        speed: clamp(raw.speed, 0.1, 2, 0.7),
        density: clamp(raw.density, 1, 12, 6),
        trail: clamp(raw.trail, 0.02, 0.4, 0.09),
    };
}

/**
 * AI 风格迁移：分析图片色彩风格，返回调色板与粒子参数。
 * @param {File} imageFile 图片文件
 * @returns {Promise<Object>} {colors:[[h,s,l],...], size, speed, density, trail}
 * @throws {Error} API 错误或解析失败
 */
export async function styleTransfer(imageFile) {
    if (!imageFile) throw new Error('请先选择图片');
    if (!imageFile.type.startsWith('image/')) throw new Error('仅支持图片文件');
    const dataURL = await _fileToDataURL(imageFile);
    // 限制 base64 体积：超过 2MB 的图片警告（vision 接口对大图较慢）
    if (dataURL.length > 2 * 1024 * 1024) {
        // 不阻断，仅提示调用方可优化
    }
    const messages = [
        {
            role: 'system',
            content: '你是一个色彩分析专家。分析用户提供的图片，提取其色彩风格特征，返回适合粒子绘画应用的调色板与参数。必须只返回 JSON，不要任何额外文字。',
        },
        {
            role: 'user',
            content: [
                { type: 'text', text: '分析这张图片的色彩风格，返回 JSON 格式：{"colors":[[h,s,l],...4到6个颜色点],"size":1到6的数字,"speed":0.1到2的数字,"density":1到12的整数,"trail":0.02到0.4的数字}。其中 h 为色相0-360，s 为饱和度0-100，l 为亮度0-100。只返回 JSON。' },
                { type: 'image_url', image_url: { url: dataURL } },
            ],
        },
    ];
    const reply = await _callAPI(messages, true);
    const parsed = _extractJSON(reply);
    const result = _normalizeStyleResult(parsed);
    if (!result) throw new Error('无法解析模型返回的调色板，请重试');
    return result;
}

// ============================================================
//  功能 2：情绪识别
// ============================================================

const EMOTION_THEMES = ['rainbow', 'ocean', 'fire', 'aurora', 'candy'];

/**
 * AI 情绪识别：分析日记文本情绪，返回最匹配的主题名。
 * @param {string} text 日记文本
 * @returns {Promise<string>} 主题名（rainbow/ocean/fire/aurora/candy）
 * @throws {Error} API 错误或解析失败
 */
export async function analyzeEmotion(text) {
    if (!text || !text.trim()) throw new Error('请输入日记文本');
    const messages = [
        {
            role: 'system',
            content: '你是一个情绪分析助手。根据用户输入的文字判断情绪，从给定主题中选择最匹配的一个。只返回主题名，不要任何额外文字。',
        },
        {
            role: 'user',
            content: `分析这段日记文字的情绪，从 [rainbow, ocean, fire, aurora, candy] 中选最匹配的主题。\n- rainbow（彩虹）：多彩、欢快、充满活力\n- ocean（海洋）：平静、忧郁、深沉\n- fire（火焰）：热烈、愤怒、激情\n- aurora（极光）：梦幻、宁静、空灵\n- candy（糖果）：甜美、温馨、轻松\n\n日记：「${text.trim()}」\n\n只返回一个主题名（rainbow/ocean/fire/aurora/candy）。`,
        },
    ];
    const reply = await _callAPI(messages, false);
    // 从回复中提取主题名（兼容可能的额外文字）
    const lower = reply.toLowerCase();
    const found = EMOTION_THEMES.find(t => lower.includes(t));
    if (!found) throw new Error('无法识别情绪主题，请重试');
    return found;
}
