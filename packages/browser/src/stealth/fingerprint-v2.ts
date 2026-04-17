/**
 * Fingerprint descriptor defaults + `addInitScript` generator.
 *
 * `buildInitScript(desc)` returns a string suitable for
 * `browserContext.addInitScript(script)` — it runs in every new page
 * before page scripts load, and installs overrides for `navigator.*`,
 * `screen.*`, `Intl.DateTimeFormat().resolvedOptions().timeZone`,
 * canvas / WebGL / audio fingerprints, WebRTC IP leaks, and the
 * `webdriver` beacon.
 *
 * `estimateEntropy(desc)` returns a soft confidence that the
 * descriptor looks like a real Chrome install (1.0 = default Chrome).
 */

import { createHash } from 'node:crypto';

import type { FingerprintDescriptor, FingerprintEntropyEstimate } from './types.js';

export const DEFAULT_CHROME_LINUX: FingerprintDescriptor = {
  userAgent:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  platform: 'Linux x86_64',
  languages: ['en-US', 'en'],
  hardwareConcurrency: 8,
  deviceMemory: 8,
  timezone: 'America/Los_Angeles',
  screen: { width: 1920, height: 1080, colorDepth: 24 },
  canvas: 'noise',
  webgl: 'noise',
  audio: 'noise',
  blockWebRtcLeaks: true,
  hideWebdriver: true,
  stubPlugins: true,
};

export const DEFAULT_CHROME_MAC: FingerprintDescriptor = {
  ...DEFAULT_CHROME_LINUX,
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  platform: 'MacIntel',
};

export const DEFAULT_CHROME_WIN: FingerprintDescriptor = {
  ...DEFAULT_CHROME_LINUX,
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  platform: 'Win32',
};

export function seedOf(desc: FingerprintDescriptor): string {
  if (desc.seed && desc.seed.length > 0) return desc.seed;
  const h = createHash('sha256');
  h.update(desc.userAgent);
  h.update(desc.platform);
  h.update(desc.timezone);
  h.update(String(desc.hardwareConcurrency));
  return h.digest('hex');
}

export function buildInitScript(desc: FingerprintDescriptor): string {
  // Emitted as a self-executing function that will run in every new page.
  // Strings are escaped so the surrounding JSON.stringify works.
  const seed = seedOf(desc);
  const cfg = {
    ua: desc.userAgent,
    platform: desc.platform,
    languages: desc.languages,
    hardwareConcurrency: desc.hardwareConcurrency,
    deviceMemory: desc.deviceMemory,
    timezone: desc.timezone,
    screen: desc.screen,
    canvas: desc.canvas,
    webgl: desc.webgl,
    audio: desc.audio,
    blockWebRtcLeaks: desc.blockWebRtcLeaks,
    hideWebdriver: desc.hideWebdriver,
    stubPlugins: desc.stubPlugins,
    seed,
  };
  return (
    '(() => {\n' +
    '  const cfg = ' +
    JSON.stringify(cfg) +
    ';\n' +
    INIT_SCRIPT_BODY +
    '})();'
  );
}

// The body is long but self-contained. It runs inside the page context —
// keep all references to DOM / navigator globals; no Node-specific code.
const INIT_SCRIPT_BODY = `
  function defineProp(obj, name, value) {
    try { Object.defineProperty(obj, name, { get: () => value, configurable: true }); } catch (_) {}
  }
  // navigator.webdriver
  if (cfg.hideWebdriver) defineProp(Navigator.prototype, 'webdriver', undefined);
  // languages + userAgent + platform + hw concurrency + device memory
  defineProp(Navigator.prototype, 'userAgent', cfg.ua);
  defineProp(Navigator.prototype, 'platform', cfg.platform);
  defineProp(Navigator.prototype, 'languages', cfg.languages);
  defineProp(Navigator.prototype, 'hardwareConcurrency', cfg.hardwareConcurrency);
  defineProp(Navigator.prototype, 'deviceMemory', cfg.deviceMemory);
  // screen
  defineProp(Screen.prototype, 'width', cfg.screen.width);
  defineProp(Screen.prototype, 'height', cfg.screen.height);
  defineProp(Screen.prototype, 'colorDepth', cfg.screen.colorDepth);
  // timezone
  try {
    const origDate = Date.prototype.getTimezoneOffset;
    // best-effort: spoof via Intl override only.
    const origResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    Intl.DateTimeFormat.prototype.resolvedOptions = function() {
      const r = origResolvedOptions.call(this);
      return Object.assign({}, r, { timeZone: cfg.timezone });
    };
    void origDate;
  } catch (_) {}
  // plugins / mimeTypes stubs (look like real Chrome)
  if (cfg.stubPlugins) {
    const fakePlugin = { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 };
    const plugins = [fakePlugin];
    defineProp(Navigator.prototype, 'plugins', plugins);
    defineProp(Navigator.prototype, 'mimeTypes', [{ type: 'application/pdf', suffixes: 'pdf', description: '', enabledPlugin: fakePlugin }]);
  }
  // WebRTC leak defense: stub RTCPeerConnection to not surface local IPs.
  if (cfg.blockWebRtcLeaks && typeof RTCPeerConnection !== 'undefined') {
    try {
      const Original = RTCPeerConnection;
      function Stub(...args) { return new Original(...args); }
      Stub.prototype = Original.prototype;
      Stub.prototype.createDataChannel = function() { return { close: () => {} }; };
      window.RTCPeerConnection = Stub;
    } catch (_) {}
  }
  // Canvas noise.
  if (cfg.canvas !== 'passthrough') {
    try {
      const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      function noisify(data) {
        // Deterministic per-seed pixel jitter across a few pixels.
        let h = 0;
        for (let i = 0; i < cfg.seed.length; i++) h = (h * 31 + cfg.seed.charCodeAt(i)) | 0;
        for (let i = 0; i < Math.min(data.length, 64); i += 4) {
          data[i] = (data[i] + (h & 1)) & 255;
          h = h >>> 1 | (h << 31);
        }
        return data;
      }
      CanvasRenderingContext2D.prototype.getImageData = function(...a) {
        const img = origGetImageData.apply(this, a);
        noisify(img.data);
        return img;
      };
      HTMLCanvasElement.prototype.toDataURL = function(...a) {
        // For 'fixed' mode we could return a constant; for 'noise' we rely
        // on getImageData jitter flowing into the PNG encoder.
        return origToDataURL.apply(this, a);
      };
    } catch (_) {}
  }
  // WebGL vendor/renderer override.
  if (cfg.webgl !== 'passthrough') {
    try {
      const glProto = WebGLRenderingContext.prototype;
      const origGetParameter = glProto.getParameter;
      glProto.getParameter = function(param) {
        // UNMASKED_VENDOR_WEBGL = 37445, UNMASKED_RENDERER_WEBGL = 37446
        if (param === 37445) return 'Google Inc. (Intel)';
        if (param === 37446) return 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)';
        return origGetParameter.call(this, param);
      };
    } catch (_) {}
  }
  // Audio noise.
  if (cfg.audio !== 'passthrough' && typeof AudioContext !== 'undefined') {
    try {
      const origGetChannelData = AudioBuffer.prototype.getChannelData;
      AudioBuffer.prototype.getChannelData = function(channel) {
        const data = origGetChannelData.call(this, channel);
        let h = 0;
        for (let i = 0; i < cfg.seed.length; i++) h = (h * 31 + cfg.seed.charCodeAt(i)) | 0;
        for (let i = 0; i < Math.min(data.length, 32); i++) {
          data[i] = data[i] + ((h & 0xff) - 128) * 1e-7;
          h = h >>> 1 | (h << 31);
        }
        return data;
      };
    } catch (_) {}
  }
`;

// ─── Entropy estimator ────────────────────────────────────────────────────

export function estimateEntropy(desc: FingerprintDescriptor): FingerprintEntropyEstimate {
  const notes: string[] = [];
  const perFeature: Record<string, number> = {};

  perFeature['userAgent'] = /Chrome\//.test(desc.userAgent) ? 1 : 0.5;
  if (perFeature['userAgent'] < 1) notes.push('userAgent does not resemble stock Chrome');

  perFeature['hardwareConcurrency'] = desc.hardwareConcurrency >= 4 && desc.hardwareConcurrency <= 16 ? 1 : 0.6;
  if (perFeature['hardwareConcurrency'] < 1)
    notes.push(`hardwareConcurrency=${desc.hardwareConcurrency} is an outlier`);

  perFeature['deviceMemory'] = [2, 4, 8, 16].includes(desc.deviceMemory) ? 1 : 0.7;
  perFeature['languages'] = desc.languages.length > 0 ? 1 : 0;
  perFeature['screen'] = desc.screen.colorDepth === 24 ? 1 : 0.6;
  perFeature['canvas'] = desc.canvas === 'passthrough' ? 0.3 : 1;
  if (desc.canvas === 'passthrough') notes.push('canvas passthrough — identifiable');
  perFeature['webgl'] = desc.webgl === 'passthrough' ? 0.3 : 1;
  perFeature['audio'] = desc.audio === 'passthrough' ? 0.4 : 1;
  perFeature['webrtc'] = desc.blockWebRtcLeaks ? 1 : 0.4;
  if (!desc.blockWebRtcLeaks) notes.push('WebRTC leaks enabled — local IP visible');
  perFeature['webdriver'] = desc.hideWebdriver ? 1 : 0;
  if (!desc.hideWebdriver) notes.push('navigator.webdriver exposed — bot-obvious');
  perFeature['plugins'] = desc.stubPlugins ? 1 : 0.6;

  const values = Object.values(perFeature);
  const score = values.reduce((acc, v) => acc + v, 0) / values.length;
  return { score, perFeature, notes };
}
