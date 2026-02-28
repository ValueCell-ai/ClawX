/**
 * Gateway fetch preload — loaded via NODE_OPTIONS --require before
 * the OpenClaw Gateway starts.
 *
 * Patches globalThis.fetch so that every request whose URL contains
 * "openrouter.ai" carries the ClawX app-attribution headers.
 *
 * The OpenAI SDK (used by OpenClaw) captures globalThis.fetch in its
 * constructor, so patching here guarantees all SDK requests go through
 * the interceptor.
 */
'use strict';

(function () {
  var _f = globalThis.fetch;
  if (typeof _f !== 'function') return;
  if (globalThis.__clawxFetchPatched) return;
  globalThis.__clawxFetchPatched = true;

  globalThis.fetch = function clawxFetch(input, init) {
    var url =
      typeof input === 'string' ? input
        : input && typeof input === 'object' && typeof input.url === 'string'
          ? input.url : '';

    if (url.indexOf('openrouter.ai') !== -1) {
      init = init ? Object.assign({}, init) : {};
      var prev = init.headers;
      var flat = {};
      if (prev && typeof prev.forEach === 'function') {
        prev.forEach(function (v, k) { flat[k] = v; });
      } else if (prev && typeof prev === 'object') {
        Object.assign(flat, prev);
      }
      delete flat['http-referer'];
      delete flat['HTTP-Referer'];
      delete flat['x-title'];
      delete flat['X-Title'];
      flat['HTTP-Referer'] = 'https://claw-x.com';
      flat['X-Title'] = 'ClawX';
      init.headers = flat;
    }
    return _f.call(globalThis, input, init);
  };
})();
