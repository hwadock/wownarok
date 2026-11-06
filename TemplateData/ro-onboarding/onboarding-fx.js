(function () {
  'use strict';
  if (window.RoOnboardingFx) return;
  var base = 'TemplateData/ro-onboarding/';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var active = [], observer = null, root = null, timer = null, host = null, loadingHost = null;
  var runtime = null, serial = 0, bursts = new Set();
  var style = document.createElement('style');
  style.textContent = '@keyframes roFxEnter{from{opacity:0;transform:translateY(18px) scale(.97)}to{opacity:1;transform:none}}@keyframes roFxRise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}@keyframes roFxBurst{to{opacity:0;transform:scale(1.7)}}@keyframes roFxOrbit{to{transform:rotate(360deg)}}.ro-fx-enter{animation:roFxEnter .42s cubic-bezier(.16,1,.3,1) both!important}.ro-fx-child{animation:roFxRise .3s ease-out both}.ro-fx-burst{position:fixed;pointer-events:none;z-index:10005;width:24px;height:24px;border:2px solid #f2cf86;border-radius:50%;animation:roFxBurst .35s ease-out forwards}.ro-fx-canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3}.ro-fx-orbit{position:absolute;inset:-10px;border:2px dashed #dcb26a88;border-radius:50%;pointer-events:none;animation:roFxOrbit 8s linear infinite}@media(prefers-reduced-motion:reduce){.ro-fx-enter,.ro-fx-child,.ro-fx-orbit{animation:none!important}}';
  document.head.appendChild(style);
  function loadRuntime() {
    if (runtime) return runtime;
    runtime = new Promise(function (resolve) {
      if (window.rive && window.rive.Rive) { resolve(window.rive); return; }
      var script = document.createElement('script'), done = false;
      var limit = setTimeout(function () { finish(null); }, 8000);
      function finish(api) { if (done) return; done = true; clearTimeout(limit); resolve(api); }
      script.src = base + 'rive.js'; script.async = true;
      script.onload = function () { finish(window.rive && window.rive.Rive ? window.rive : null); };
      script.onerror = function () { finish(null); };
      document.head.appendChild(script);
    });
    return runtime;
  }
  function release() {
    serial++;
    active.forEach(function (item) { if (item.resize) item.resize.disconnect(); if (item.player) item.player.cleanup(); item.canvas.remove(); });
    active = []; host = loadingHost = null;
  }
  function mount(target, artboard, generation) {
    loadRuntime().then(function (api) {
      if (!api || reduce.matches || generation !== serial || !target.isConnected) return;
      api.RuntimeLoader.setWasmUrl(base + 'rive.wasm');
      api.RuntimeLoader.setWasmFallbackUrl(base + 'rive.wasm');
      var canvas = document.createElement('canvas'); canvas.className = 'ro-fx-canvas'; canvas.setAttribute('aria-hidden', 'true'); canvas.tabIndex = -1;
      target.style.position = 'relative'; target.appendChild(canvas);
      var item = { canvas: canvas, player: null, resize: null }; active.push(item);
      try {
        item.player = new api.Rive({canvas:canvas,src:base+'onboarding.riv',artboard:artboard,autoplay:true,shouldDisableRiveListeners:true,enableRiveAssetCDN:false,
          layout:new api.Layout({fit:api.Fit.Fill,alignment:api.Alignment.Center}),
          onLoad:function(){if(generation!==serial || !canvas.isConnected)return;item.player.resizeDrawingSurfaceToCanvas(Math.min(devicePixelRatio||1,2));canvas.dataset.roRiveReady='true';},
          onLoadError:function(){if(item.resize)item.resize.disconnect();canvas.style.display="none";canvas.dataset.roRiveFailed="true";if(item.player){item.player.cleanup();item.player=null;}}
        });
        item.resize = new ResizeObserver(function(){if(item.player && canvas.isConnected)item.player.resizeDrawingSurfaceToCanvas(Math.min(devicePixelRatio||1,2));});item.resize.observe(target);
      } catch (_) { if(item.player)item.player.cleanup();item.player=null;canvas.style.display="none";canvas.dataset.roRiveFailed="true"; }
    });
  }
  function reconcile() {
    timer = null;
    if (!root || !root.isConnected) { stop(); return; }
    var next = root.querySelector('#ro-name-card>div>div'), medallion = root.querySelector('#ro-face-medallion');
    if (next === host && (!host || host.querySelector('.ro-fx-canvas')) && medallion === loadingHost) return;
    // Avoid re-mounting while the local runtime is loading.
    if(next===host && medallion===loadingHost && active.length===0)return;
    release(); host=next;loadingHost=medallion;var generation=serial;
    if (!next) return;
    if (!reduce.matches) { next.classList.remove('ro-fx-enter'); void next.offsetWidth;next.classList.add('ro-fx-enter'); }
    Array.from(next.children).forEach(function(child,i){if(!reduce.matches){child.classList.add('ro-fx-child');child.style.animationDelay=Math.min(i*35,180)+'ms';}});
    mount(next,'Sparkles',generation);
    if(medallion){var orbit=document.createElement('div');orbit.className='ro-fx-orbit';medallion.appendChild(orbit);mount(medallion,'Loading',generation);}
  }
  function schedule(){if(timer===null)timer=setTimeout(reconcile,0);}
  function press(e){var b=e.target.closest('button');if(!b || b.disabled || reduce.matches)return;if(b.animate)b.animate([{transform:'scale(1)'},{transform:'scale(.96)'},{transform:'scale(1)'}],{duration:180,easing:'ease-out'});var dot=document.createElement('div');dot.className='ro-fx-burst';dot.style.left=(e.clientX-12)+'px';dot.style.top=(e.clientY-12)+'px';document.body.appendChild(dot);bursts.add(dot);setTimeout(function(){dot.remove();bursts.delete(dot);},400);}
  function visibility(){active.forEach(function(item){if(item.player){if(document.hidden||reduce.matches)item.player.pause();else item.player.play();}});}
  function stop(){if(observer)observer.disconnect();observer=null;if(timer!==null)clearTimeout(timer);timer=null;if(root)root.removeEventListener('pointerdown',press);root=null;release();bursts.forEach(function(x){x.remove()});bursts.clear();document.removeEventListener('visibilitychange',visibility);reduce.removeEventListener('change',visibility);}
  window.RoOnboardingFx={attach:function(next){if(root!==next){stop();root=next;observer=new MutationObserver(schedule);observer.observe(root,{childList:true,subtree:true});root.addEventListener('pointerdown',press);document.addEventListener('visibilitychange',visibility);reduce.addEventListener('change',visibility);}schedule();},stop:stop,stats:function(){return {players:active.length,observing:!!observer,canvases:document.querySelectorAll('.ro-fx-canvas').length};}};
})();
