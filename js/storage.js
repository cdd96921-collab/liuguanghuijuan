/**
 * storage.js — 本地存储模块（IndexedDB + 缩略图）
 *
 * 职责：
 *   - 初始化 IndexedDB（liuguang_db，含 artworks / diary 两个 store）
 *   - 提供 add / all / update / del 四个 CRUD 方法（均返回 Promise）
 *   - 生成画布缩略图（320×240 JPEG，用于画廊预览）
 *
 * 依赖：
 *   - particle.js：canvas（用于 makeThumb 截图）
 *
 * 测试建议：
 *   可使用 fake-indexeddb 包在 Node 环境下单元测试 db 对象。
 *   makeThumb 依赖 DOM canvas，可在 jsdom 环境下测试。
 */

import { canvas } from './particle.js';

// ============================================================
//  IndexedDB 封装
// ============================================================

/**
 * IndexedDB 操作对象。
 * 两个 object store：
 *   - artworks：作品库（keyPath: id, autoIncrement；v2 起含 tags 字段 + byTag 多值索引）
 *   - diary：情绪日记（keyPath: id, autoIncrement）
 *
 * 用法：
 *   await db.init();              // 初始化（幂等，自动升级 v1→v2）
 *   await db.add('artworks', obj); // 新增
 *   const items = await db.all('artworks'); // 全量读取（倒序）
 *   await db.update('artworks', obj); // 覆盖写入（按 id）
 *   await db.del('artworks', id);     // 按 id 删除
 *   const items = await db.byTag('风景'); // 按标签查询（v2）
 */
export const db = {
    ready: null,

    /** 初始化数据库（幂等，返回 ready Promise）。v2 升级：为 artworks 添加 byTag 多值索引。 */
    init() {
        this.ready = new Promise((resolve, reject) => {
            const req = indexedDB.open('liuguang_db', 2);
            req.onupgradeneeded = (e) => {
                const d = req.result;
                if (!d.objectStoreNames.contains('artworks')) {
                    d.createObjectStore('artworks', { keyPath: 'id', autoIncrement: true });
                }
                if (!d.objectStoreNames.contains('diary')) {
                    d.createObjectStore('diary', { keyPath: 'id', autoIncrement: true });
                }
                // v2: 为 artworks 添加 tags 多值索引（旧记录无 tags 字段，索引忽略）
                if (e.oldVersion < 2) {
                    const store = req.transaction.objectStore('artworks');
                    if (!store.indexNames.contains('byTag')) {
                        store.createIndex('byTag', 'tags', { multiEntry: true });
                    }
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return this.ready;
    },

    /** 新增记录。 */
    async add(store, obj) {
        const d = await this.ready;
        return new Promise((res, rej) => {
            const tx = d.transaction(store, 'readwrite');
            tx.objectStore(store).add(obj);
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error);
        });
    },

    /** 全量读取（返回倒序数组，最新在前）。 */
    async all(store) {
        const d = await this.ready;
        return new Promise((res, rej) => {
            const tx = d.transaction(store, 'readonly');
            const req = tx.objectStore(store).getAll();
            req.onsuccess = () => res(req.result.reverse());
            req.onerror = () => rej(req.error);
        });
    },

    /** 覆盖写入（按 id 更新）。 */
    async update(store, obj) {
        const d = await this.ready;
        return new Promise((res, rej) => {
            const tx = d.transaction(store, 'readwrite');
            tx.objectStore(store).put(obj);
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error);
        });
    },

    /** 按 id 删除。 */
    async del(store, id) {
        const d = await this.ready;
        return new Promise((res, rej) => {
            const tx = d.transaction(store, 'readwrite');
            tx.objectStore(store).delete(id);
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error);
        });
    },

    /** 按标签查询作品（v2 索引）。返回倒序数组。 */
    async byTag(tag) {
        const d = await this.ready;
        return new Promise((res, rej) => {
            const tx = d.transaction('artworks', 'readonly');
            const store = tx.objectStore('artworks');
            if (!store.indexNames.contains('byTag')) { res([]); return; }
            const req = store.index('byTag').getAll(tag);
            req.onsuccess = () => res(req.result.reverse());
            req.onerror = () => rej(req.error);
        });
    },
};

// ============================================================
//  缩略图生成
// ============================================================

/**
 * 将当前画布缩放绘制到 320×240 的 JPEG dataURL。
 * 用于作品库预览（减小存储体积）。
 * @returns {string} JPEG dataURL
 */
export function makeThumb() {
    const tc = document.createElement('canvas');
    tc.width = 320; tc.height = 240;
    const tctx = tc.getContext('2d');
    tctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, 320, 240);
    return tc.toDataURL('image/jpeg', 0.7);
}
