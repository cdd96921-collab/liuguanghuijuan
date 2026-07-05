/**
 * timeline.js — 时间轴回放模块
 * 
 * 功能：
 *   - 记录绘制过程中的粒子快照
 *   - 支持回放控制（播放/暂停/进度/速度）
 *   - 导出为 GIF 或 WebM（需要浏览器支持）
 */

const MAX_FRAMES = 1200;
const DEFAULT_FPS = 30;

let _frames = [];
let _isRecording = false;
let _isPlaying = false;
let _playIndex = 0;
let _playSpeed = 1;
let _recordingFPS = DEFAULT_FPS;
let _lastRecordTime = 0;
let _playInterval = null;
let _onUpdate = null;
let _onPlayStateChange = null;

export const timeline = {
    setUpdateCB(fn) { _onUpdate = fn; },
    setPlayStateCB(fn) { _onPlayStateChange = fn; },

    get isRecording() { return _isRecording; },
    get isPlaying() { return _isPlaying; },
    get frameCount() { return _frames.length; },
    get currentFrame() { return _playIndex; },
    get playSpeed() { return _playSpeed; },

    startRecording() {
        _frames = [];
        _isRecording = true;
        _lastRecordTime = performance.now();
        _playIndex = 0;
        if (_onPlayStateChange) _onPlayStateChange({ recording: true, playing: false });
    },

    stopRecording() {
        _isRecording = false;
        if (_onPlayStateChange) _onPlayStateChange({ recording: false, playing: false });
    },

    recordFrame(layerManager) {
        if (!_isRecording) return;
        
        const now = performance.now();
        const interval = 1000 / _recordingFPS;
        if (now - _lastRecordTime < interval) return;
        
        _lastRecordTime = now;
        
        if (_frames.length >= MAX_FRAMES) {
            _frames.shift();
            _playIndex = Math.max(0, _playIndex - 1);
        }
        
        const layers = layerManager.layers.map(layer => {
            const canvas = document.createElement('canvas');
            canvas.width = layer.canvas.width;
            canvas.height = layer.canvas.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(layer.canvas, 0, 0);
            return {
                id: layer.id,
                visible: layer.visible,
                opacity: layer.opacity,
                blendMode: layer.blendMode,
                imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
            };
        });
        
        _frames.push({
            timestamp: now,
            layers,
        });
        
        if (_onUpdate) _onUpdate({ frameCount: _frames.length, currentFrame: _playIndex });
    },

    startPlayback() {
        if (_frames.length === 0) return;
        
        _isPlaying = true;
        _playIndex = 0;
        
        if (_onPlayStateChange) _onPlayStateChange({ recording: false, playing: true });
        
        const interval = (1000 / DEFAULT_FPS) / _playSpeed;
        
        if (_playInterval) clearInterval(_playInterval);
        
        _playInterval = setInterval(() => {
            if (_playIndex >= _frames.length) {
                this.stopPlayback();
                return;
            }
            
            const frame = _frames[_playIndex];
            if (_onUpdate) _onUpdate({ 
                frameCount: _frames.length, 
                currentFrame: _playIndex,
                progress: _playIndex / _frames.length,
            });
            
            _playIndex++;
        }, interval);
    },

    stopPlayback() {
        _isPlaying = false;
        if (_playInterval) {
            clearInterval(_playInterval);
            _playInterval = null;
        }
        if (_onPlayStateChange) _onPlayStateChange({ recording: false, playing: false });
    },

    pausePlayback() {
        _isPlaying = false;
        if (_playInterval) {
            clearInterval(_playInterval);
            _playInterval = null;
        }
        if (_onPlayStateChange) _onPlayStateChange({ recording: false, playing: false });
    },

    seekTo(index) {
        _playIndex = Math.max(0, Math.min(_frames.length - 1, Math.floor(index)));
        if (_onUpdate) _onUpdate({ 
            frameCount: _frames.length, 
            currentFrame: _playIndex,
            progress: _playIndex / _frames.length,
        });
    },

    setSpeed(speed) {
        _playSpeed = Math.max(0.25, Math.min(4, speed));
        if (_isPlaying) {
            this.stopPlayback();
            this.startPlayback();
        }
    },

    getFrame(index) {
        if (index < 0 || index >= _frames.length) return null;
        return _frames[index];
    },

    clear() {
        _frames = [];
        _playIndex = 0;
        this.stopPlayback();
        this.stopRecording();
        if (_onUpdate) _onUpdate({ frameCount: 0, currentFrame: 0 });
    },

    async exportGIF() {
        if (_frames.length === 0) return null;
        
        const progressCB = _onUpdate;
        const duration = _frames.length / DEFAULT_FPS;
        
        return new Promise((resolve) => {
            const gif = {
                width: _frames[0].layers[0].imageData.width,
                height: _frames[0].layers[0].imageData.height,
                frames: [],
                duration: duration * 1000,
            };
            
            _frames.forEach((frame, i) => {
                const canvas = document.createElement('canvas');
                canvas.width = gif.width;
                canvas.height = gif.height;
                const ctx = canvas.getContext('2d');
                
                frame.layers.forEach(layer => {
                    if (!layer.visible) return;
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = layer.imageData.width;
                    tempCanvas.height = layer.imageData.height;
                    const tempCtx = tempCanvas.getContext('2d');
                    tempCtx.putImageData(layer.imageData, 0, 0);
                    
                    ctx.globalAlpha = layer.opacity;
                    ctx.globalCompositeOperation = layer.blendMode;
                    ctx.drawImage(tempCanvas, 0, 0);
                });
                
                ctx.globalAlpha = 1;
                ctx.globalCompositeOperation = 'source-over';
                
                gif.frames.push({
                    data: ctx.getImageData(0, 0, gif.width, gif.height),
                    delay: Math.round(1000 / DEFAULT_FPS),
                });
                
                if (progressCB) progressCB({ exporting: true, progress: (i + 1) / _frames.length });
            });
            
            if (progressCB) progressCB({ exporting: false });
            resolve(gif);
        });
    },
};