(function () {
  const WARMUP_ENABLED = true;
  const START_DELAY_MS = 1200;
  const PHASE2_DELAY_MS = 2500;
  const INTER_REQUEST_MS = 120;
  const CONCURRENCY = 2;

  if (!WARMUP_ENABLED) return;
  if (window.__eeTrackWarmupInstalled) return;
  window.__eeTrackWarmupInstalled = true;

  function getAssetVersion() {
    try {
      const el = document.querySelector('link[href*="style.css?v="]') ||
                 document.querySelector('script[src*="script.js?v="]');
      if (!el) return '';
      const url = new URL(el.getAttribute('href') || el.getAttribute('src'), location.href);
      return url.searchParams.get('v') || '';
    } catch (_) {
      return '';
    }
  }

  const ASSET_VERSION = getAssetVersion();

  function withVersion(url) {
    if (!ASSET_VERSION) return url;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'v=' + encodeURIComponent(ASSET_VERSION);
 }

  function unique(list) {
    return Array.from(new Set((list || []).filter(Boolean)));
  }

  const phase1 = unique([
    withVersion('trackdiagram.css'),
    withVersion('trackdiagram.js'),
    'img/track/ebene1/ebene1_base.svg',
    'img/track/ebene0/ebene0_base.svg'
  ]);

  const phase2 = unique([
    'img/track/ebene1/weiche_w9_g.svg',
    'img/track/ebene1/weiche_w10_g.svg',
    'img/track/ebene1/weiche_w11_g.svg',
    'img/track/ebene1/grant_1_2_red.svg',
    'img/track/ebene1/grant_2_3_red.svg',
    'img/track/ebene1/block_e1_b1_undef.svg',
    'img/track/ebene1/block_e1_b2_undef.svg',
    'img/track/ebene1/block_e1_b3_undef.svg',
    'img/track/ebene1/bhf2_red.svg',
    'img/track/ebene1/bhf3_red.svg',
    'img/track/ebene0/weiche_w0_g.svg',
    'img/track/ebene0/weiche_w1_g.svg',
    'img/track/ebene0/weiche_w2_g.svg',
    'img/track/ebene0/weiche_w3_g.svg',
    'img/track/ebene0/weiche_w4_g.svg',
    'img/track/ebene0/weiche_w5_g.svg',
    'img/track/ebene0/weiche_w6_g.svg',
    'img/track/ebene0/weiche_w7_g.svg',
    'img/track/ebene0/weiche_w8_g.svg',
    'img/track/ebene0/grant_3_4_red.svg',
    'img/track/ebene0/grant_4_1_red.svg',
    'img/track/ebene0/grant_4_5_red.svg',
    'img/track/ebene0/grant_6_4_red.svg',
    'img/track/ebene0/block_e0_b1_undef.svg',
    'img/track/ebene0/block_e0_b3_undef.svg',
    'img/track/ebene0/block_e0_b4_undef.svg',
    'img/track/ebene0/block_e0_b5_undef.svg',
    'img/track/ebene0/block_e0_b6_undef.svg',
    'img/track/ebene0/bhf0_red.svg',
    'img/track/ebene0/bhf1_red.svg'
  ]);

  function warmUrl(url) {
    return new Promise((resolve) => {
      try {
        const isCss = /\.css(?:\?|$)/i.test(url);
        const isJs = /\.js(?:\?|$)/i.test(url);
        const isSvg = /\.svg(?:\?|$)/i.test(url);

        if (isCss) {
          const link = document.createElement('link');
          link.rel = 'prefetch';
          link.as = 'style';
          link.href = url;
          link.onload = link.onerror = () => resolve();
          document.head.appendChild(link);
          setTimeout(resolve, 1500);
          return;
        }

        if (isJs) {
          const link = document.createElement('link');
          link.rel = 'prefetch';
          link.as = 'script';
          link.href = url;
          link.onload = link.onerror = () => resolve();
          document.head.appendChild(link);
          setTimeout(resolve, 1500);
          return;
        }

        if (isSvg) {
          const img = new Image();
          img.decoding = 'async';
          img.onload = img.onerror = () => resolve();
          img.src = url;
          setTimeout(resolve, 1500);
          return;
        }
      } catch (_) {}
      resolve();
    });
  }

  function runQueue(urls) {
    urls = unique(urls);
    let index = 0;
    let active = 0;

    function pump() {
      while (active < CONCURRENCY && index < urls.length) {
        const url = urls[index++];
        active += 1;
        warmUrl(url).finally(() => {
          active -= 1;
          setTimeout(pump, INTER_REQUEST_MS);
        });
      }
    }

    pump();
  }

  function startWarmup() {
    runQueue(phase1);
    setTimeout(() => runQueue(phase2), PHASE2_DELAY_MS);
  }

  function scheduleWarmup() {
    const start = () => setTimeout(startWarmup, START_DELAY_MS);
    if ('requestIdleCallback' in window) {
      requestIdleCallback(start, { timeout: 2000 });
    } else {
      setTimeout(start, 0);
    }
  }

  if (document.readyState === 'complete') {
    scheduleWarmup();
  } else {
    window.addEventListener('load', scheduleWarmup, { once: true });
  }
})();