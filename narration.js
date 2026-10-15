const VOICES = new Set(['yunxi', 'xiaoxiao', 'local']);
const validRate = value => Math.max(1, Math.min(2, Number(value) || 1));

function staticConfiguration(manifest, baseURL) {
  if (!manifest) return null;
  const voices = (Array.isArray(manifest.voices) ? manifest.voices : [])
    .map(voice => typeof voice === 'string' ? {id: voice} : voice)
    .filter(voice => voice && typeof voice.id === 'string' && voice.id);
  if (!voices.length) voices.push({id: manifest.defaultVoice || 'yunxi'});
  const voiceIds = new Set(voices.map(voice => voice.id));
  const defaultVoice = voiceIds.has(manifest.defaultVoice) ? manifest.defaultVoice : voices[0].id;
  return {voices, voiceIds, defaultVoice, events: manifest.events || {},
    baseURL: baseURL || globalThis.document?.baseURI || globalThis.location?.href};
}

/** One reusable audio player; event and source generations invalidate stale work. */
export class NarrationController extends EventTarget {
  constructor({enabled = true, voice = 'yunxi', rate = 1,
    staticManifest = null, staticBaseURL,
    fetch: fetchImpl = globalThis.fetch?.bind(globalThis),
    audioFactory = () => new Audio(),
    createObjectURL = blob => URL.createObjectURL(blob),
    revokeObjectURL = url => URL.revokeObjectURL(url),
    loadTimeoutMs = 30000, stallTimeoutMs = 20000, watchdogIntervalMs = 1000,
  } = {}) {
    super();
    this._enabled = !!enabled;
    this._static = staticConfiguration(staticManifest, staticBaseURL);
    this._voice = this._normalizeVoice(voice);
    this._rate = validRate(rate);
    this._fetch = fetchImpl;
    this._createURL = createObjectURL;
    this._revokeURL = revokeObjectURL;
    this._loadTimeoutMs = loadTimeoutMs;
    this._stallTimeoutMs = stallTimeoutMs;
    this._watchdogIntervalMs = watchdogIntervalMs;
    this._generation = 0;
    this._sourceGeneration = 0;
    this._playGeneration = 0;
    this._completeEvents = new Set();
    this._eventId = null;
    this._status = 'idle';
    this._done = true;
    this._message = '';
    this._audio = audioFactory();
    this._audio.id = 'narration-audio';
    this._audio.hidden = true;
    this._audio.preload = 'auto';
    this._audio.setAttribute?.('data-narration-player', '');
    this._audio.setAttribute?.('aria-hidden', 'true');
    if (globalThis.document?.body && !this._audio.isConnected) document.body.append(this._audio);
    this._applyRate();
    this._notify();
  }

  get enabled() { return this._enabled; }
  get voice() { return this._voice; }
  get rate() { return this._rate; }
  get state() {
    return {eventId: this._eventId, status: this._status, done: this._done,
      message: this._message, voice: this._voice, enabled: this._enabled,
      ...(this._engine ? {engine: this._engine} : {})};
  }

  start(eventId, fallbackText = '') {
    this._invalidate();
    this._eventId = String(eventId);
    this._text = String(fallbackText || '');
    this._completeEvents.delete(this._eventId);
    this._done = !this._enabled;
    this._wantPause = false;
    this._attemptedLocal = this._voice === 'local';
    this._message = '';
    this._engine = undefined;
    if (!this._enabled) {
      this._status = 'done';
      this._notify();
      return Promise.resolve(this.state);
    }
    return this._loadVoice(this._generation, this._voice);
  }

  pause() {
    if (this._done || this._status === 'idle') return;
    this._wantPause = true;
    this._playGeneration++;
    this._playAbort?.abort();
    this._audio.pause();
    this._clearWatchdog();
    this._status = 'paused';
    this._notify();
  }

  resume() {
    if (!this._enabled || this._done || this._status === 'idle') return;
    this._wantPause = false;
    if (this._ready) return this._play(this._generation, this._sourceGeneration);
    this._status = 'loading';
    this._notify();
  }

  cancel() {
    this._invalidate();
    this._eventId = null;
    this._status = 'idle';
    this._done = true;
    this._wantPause = false;
    this._engine = undefined;
    this._message = '';
    this._notify();
  }

  setEnabled(value) {
    if (this._enabled === !!value) return;
    this._enabled = !!value;
    this.cancel();
  }

  setVoice(value) {
    const next = this._normalizeVoice(value);
    if (this._voice === next) return;
    this._voice = next;
    this.cancel();
  }

  setRate(value) {
    this._rate = validRate(value);
    this._applyRate();
    this._notify();
  }

  isComplete(eventId) {
    return !this._enabled || this._completeEvents.has(eventId) ||
      (this._eventId === eventId && this._done);
  }

  _normalizeVoice(value) {
    if (this._static) return this._static.voiceIds.has(value) ? value : this._static.defaultVoice;
    return VOICES.has(value) ? value : 'yunxi';
  }

  _staticSource(eventId, voice) {
    const entry = Object.hasOwn(this._static.events, eventId) ? this._static.events[eventId] : null;
    if (!entry) throw new Error('分享版尚未收录本条旁白');
    const defaultVoice = this._static.defaultVoice;
    const paths = typeof entry === 'string' ? {[defaultVoice]: entry} : entry;
    const sourceVoice = Object.hasOwn(paths, voice) && paths[voice] ? voice : defaultVoice;
    const path = Object.hasOwn(paths, sourceVoice) ? paths[sourceVoice] : null;
    // Share exports contain relative media files. Never send a static-mode request to
    // the Python API, an external audio host, or an origin-root path on GitHub Pages.
    if (typeof path !== 'string' || path.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(path) ||
        !/\.(mp3|wav|ogg|m4a|aac|opus|webm)(?:[?#].*)?$/i.test(path)) {
      throw new Error('分享版旁白文件路径无效或缺失');
    }
    const url = new URL(path, this._static.baseURL);
    const base = new URL(this._static.baseURL);
    if (url.origin !== base.origin) throw new Error('分享版旁白必须来自本地导出文件');
    return {url: url.href, voice: sourceVoice};
  }

  _applyRate() {
    this._audio.playbackRate = this._rate;
    this._audio.preservesPitch = true;
    if ('webkitPreservesPitch' in this._audio) this._audio.webkitPreservesPitch = true;
  }

  _notify() {
    if (this._audio.dataset) {
      this._audio.dataset.eventId = this._eventId || '';
      this._audio.dataset.voice = this._sourceVoice || this._voice;
      this._audio.dataset.status = this._status;
    }
    const event = new Event('change');
    Object.defineProperty(event, 'detail', {value: this.state});
    this.dispatchEvent(event);
  }

  _current(generation, sourceGeneration) {
    return generation === this._generation &&
      (sourceGeneration === undefined || sourceGeneration === this._sourceGeneration);
  }

  _invalidate() {
    this._generation++;
    this._sourceGeneration++;
    this._playGeneration++;
    this._stopSource();
  }

  _stopSource() {
    this._abort?.abort();
    this._abort = null;
    this._playAbort?.abort();
    this._playAbort = null;
    this._clearWatchdog();
    if (this._listeners) {
      for (const [name, handler] of Object.entries(this._listeners)) this._audio.removeEventListener(name, handler);
      this._listeners = null;
    }
    this._audio.pause();
    this._audio.removeAttribute?.('src');
    this._audio.load?.();
    this._ready = false;
    this._sourceVoice = null;
    if (this._objectURL) {
      this._revokeURL(this._objectURL);
      this._objectURL = null;
    }
  }

  async _loadVoice(generation, voice) {
    if (!this._current(generation)) return this.state;
    const sourceGeneration = ++this._sourceGeneration;
    this._sourceVoice = voice;
    this._engine = voice === 'local' ? 'local' : 'neural';
    this._status = this._wantPause ? 'paused' : 'loading';
    this._notify();
    const controller = new AbortController();
    this._abort = controller;
    let timer, onAbort;
    try {
      if (!this._fetch) throw new Error('浏览器不支持加载旁白');
      let sourceURL = `/api/narration?event=${encodeURIComponent(this._eventId)}&voice=${voice}`;
      if (this._static) {
        const source = this._staticSource(this._eventId, voice);
        sourceURL = source.url;
        this._sourceVoice = source.voice;
      }
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('旁白加载超过 30 秒'));
          controller.abort();
        }, this._loadTimeoutMs);
      });
      const aborted = new Promise((_, reject) => {
        onAbort = () => reject(Object.assign(new Error('旁白加载已取消'), {name: 'AbortError'}));
        controller.signal.addEventListener('abort', onAbort, {once: true});
      });
      const request = async () => {
        const response = await this._fetch(sourceURL, {signal: controller.signal});
        if (!response.ok) throw new Error(`旁白服务返回 HTTP ${response.status}`);
        const blob = await response.blob();
        if (!blob.size || /^(text\/|application\/json)/i.test(blob.type || '')) throw new Error('旁白服务没有返回有效音频');
        return blob;
      };
      const blob = await Promise.race([request(), timeout, aborted]);
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', onAbort);
      if (this._abort === controller) this._abort = null;
      if (!this._current(generation, sourceGeneration)) return this.state;
      this._objectURL = this._createURL(blob);
      this._listeners = {
        ended: () => {
          if (this._current(generation, sourceGeneration) && !this._done) this._finish('done');
        },
        error: () => this._failAttempt('旁白音频无法解码或播放', generation, sourceGeneration),
      };
      for (const [name, handler] of Object.entries(this._listeners)) this._audio.addEventListener(name, handler);
      this._audio.src = this._objectURL;
      this._ready = true;
      this._applyRate();
      if (this._wantPause) {
        this._status = 'paused';
        this._notify();
      } else {
        await this._play(generation, sourceGeneration);
      }
    } catch (error) {
      if (this._current(generation, sourceGeneration)) return this._failAttempt(error.message || '旁白加载失败', generation, sourceGeneration);
    } finally {
      clearTimeout(timer);
      if (onAbort) controller.signal.removeEventListener('abort', onAbort);
      if (this._abort === controller) this._abort = null;
    }
    return this.state;
  }

  async _play(generation, sourceGeneration) {
    if (!this._current(generation, sourceGeneration) || !this._ready || this._wantPause || this._done) return this.state;
    const playGeneration = ++this._playGeneration;
    const controller = new AbortController();
    this._playAbort?.abort();
    this._playAbort = controller;
    let timer, onAbort;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('旁白迟迟没有开始播放')), this._loadTimeoutMs);
      });
      const aborted = new Promise((_, reject) => {
        onAbort = () => reject(Object.assign(new Error('旁白播放已取消'), {name: 'AbortError'}));
        controller.signal.addEventListener('abort', onAbort, {once: true});
      });
      await Promise.race([this._audio.play(), timeout, aborted]);
      if (!this._current(generation, sourceGeneration) || playGeneration !== this._playGeneration) return this.state;
      if (this._wantPause) { this._audio.pause(); return this.state; }
      this._status = 'speaking';
      this._notify();
      this._watch(generation, sourceGeneration);
    } catch (error) {
      if (!this._current(generation, sourceGeneration) || playGeneration !== this._playGeneration) return this.state;
      if (error.name === 'NotAllowedError') this._finish('error', '浏览器阻止了声音播放，请点击播放或重读按钮重试');
      else return this._failAttempt(`旁白播放失败：${error.message || error.name || '未知错误'}`, generation, sourceGeneration);
    } finally {
      clearTimeout(timer);
      if (onAbort) controller.signal.removeEventListener('abort', onAbort);
      if (this._playAbort === controller) this._playAbort = null;
    }
    return this.state;
  }

  _failAttempt(message, generation, sourceGeneration) {
    if (!this._current(generation, sourceGeneration) || this._done) return this.state;
    this._sourceGeneration++;
    this._playGeneration++;
    this._stopSource();
    if (!this._static && !this._attemptedLocal) {
      this._attemptedLocal = true;
      this._message = '正在改用本机中文旁白';
      return this._loadVoice(generation, 'local');
    }
    this._finish('error', `${message}。当前事件继续播放，可点击重读重试。`);
    return this.state;
  }

  _finish(status, message = '') {
    this._clearWatchdog();
    this._audio.pause();
    this._status = status;
    this._done = true;
    this._message = message;
    this._completeEvents.add(this._eventId);
    this._notify();
  }

  _clearWatchdog() { clearInterval(this._watchdog); this._watchdog = null; }

  _watch(generation, sourceGeneration) {
    this._clearWatchdog();
    let lastPosition = Number(this._audio.currentTime) || 0;
    let lastProgress = Date.now();
    const began = Date.now();
    const maximumMs = Math.max(120000, (this._text?.length || 0) * 1200);
    this._watchdog = setInterval(() => {
      if (!this._current(generation, sourceGeneration) || this._done || this._wantPause) return;
      const position = Number(this._audio.currentTime) || 0;
      const duration = Number(this._audio.duration);
      if (this._audio.ended || (Number.isFinite(duration) && duration > 0 && position >= duration - .04)) {
        this._finish('done');
        return;
      }
      if (position > lastPosition + .01) { lastPosition = position; lastProgress = Date.now(); }
      if (Date.now() - lastProgress > this._stallTimeoutMs || Date.now() - began > maximumMs) {
        this._failAttempt('旁白长时间没有播放进度', generation, sourceGeneration);
      }
    }, this._watchdogIntervalMs);
  }
}

export default NarrationController;
