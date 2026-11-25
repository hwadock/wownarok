// 로그인 카드를 엔진보다 먼저 띄우는 틀(앞) — 빌드 때 이 파일 + RoPrompt.jslib + ro-pre-tail.js 를 이어 TemplateData/ro-onboarding/ro-prompt-pre.js 로 만든다(WebGLNoUnityLogo)
// 2026-11-20 사용자 "일단 로그인 화면으로 빠르게 보내고 그때부터 받게 하면 최초 로딩이 빨라지지 않을까" — 엔진(wasm·data 43~49MB)을 받는 동안 같은 카드 코드로 로그인·신규 카드를 먼저 띄우고,
//   엔진이 보낼 곳(SendMessage)이 없는 동안 보낸 것은 줄에 모아 둔다. C# 가 처음 로그인 카드를 열 때(엔진 안의 RoLoginOpen) 떠 있는 카드를 그대로 두고 모은 것을 넘긴다(window.__roPre.hand).
(function () {
  var __roIsPre = true;   // jslib 의 RoLoginOpen 이 이 사본에서는 넘겨받기를 하지 않게
  var Q = [], pre = window.__roPre = { queue: Q, opened: 0, handed: 0 };
  var SendMessage = function (o, m, a) { if (window.__roUnitySend) window.__roUnitySend(o, m, a); else Q.push([o, m, a]); };
  var UTF8ToString = function (s) { return s == null ? "" : String(s); };
  var LibraryManager = { library: {} };
  var mergeInto = function (lib, o) { for (var k in o) { if (k.indexOf("__") > 0) continue; window[k.charAt(0) === "$" ? k.slice(1) : k] = o[k]; } };

// 웹: 브라우저 입력창(prompt)으로 글자를 받는다 — 휴대폰에서도 키보드가 바로 뜨고 한글 입력이 확실하다(접속 전 이름 정하기)
mergeInto(LibraryManager.library, {
  // 서버와 판이 달라 거절당했다 — 페이지를 새로 받아 새 판으로(NetSession.ReloadForNewVersion)
  RoSetAspect: function (mode) { if (window.roSetAspect) window.roSetAspect(mode); },   // PC 화면 비율 버튼(AspectToggleButton) — 0 = 9:16, 1 = 갤럭시 폴드8 접었을 때 1248×1972(2026-11-15 사용자)
  RoReload: function () { var u = location.href.replace(/([?&])r=\d+&?/, "$1").replace(/[?&]$/, ""); location.replace(u + (u.indexOf("?") >= 0 ? "&" : "?") + "r=" + Date.now()); },   // 주소에 새 값 — 아이폰이 옛 index.html 캐시를 쓰지 않게(2026-11-11)

  // 깐부 음성 지시 녹음 엔진(2026-11-13) — 채팅 줄 마이크(A)와 HUD '누르고 말하기'(B, RoVoiceBegin/End)가 함께 쓴다. 한 번에 하나만 녹음.
  //   녹음 → 얼굴 서버(face.txt) POST /stt(로그인 머리 X-RO-Name·X-RO-Pin) → 받아 적은 글을 NetChat.OnHtmlSend(파티 채팅)로.
  //   말한 뒤 1.5초 조용 = 저절로 보냄, 처음부터 2초 말이 없음 = 안 보내고 끔, 최대 15초. 녹음 버퍼·스트림·분석기는 끝나면 바로 버린다(아이폰 메모리),
  //   마이크 트랙을 멈춰야 RoAudioVisibility 가 소리 장치를 '재생'으로 되돌린다.
  //   알림: v.on(fn(kind, arg)) — asking · listen(소리 0~1) · transcribe · sent(글) · cancel · error(사유, 띄워도 되는 한국어) · idle.
  //   B 로 시작한 녹음만 유니티 SendMessage('RoVoice','OnVoice', 'listen|0.42' 등)로도 보낸다(받는 오브젝트가 없는 화면에서 오류가 쌓이지 않게).
  $RoVoice: function () {
    if (window.__roVoice) return window.__roVoice;
    var QUIET_MS = 1500, NOSPEECH_MS = 2000, MAX_MS = 15000;
    var v = { phase: "idle", source: "", level: 0, started: 0, run: 0, fns: [], stream: null, rec: null, ctx: null, chunks: null, timer: 0, base: "", lastSent: 0 };
    window.__roVoice = v;
    v.on = function (fn) { v.fns.push(fn); };
    var emit = function (kind, arg) {
      for (var i = 0; i < v.fns.length; i++) { try { v.fns[i](kind, arg); } catch (e) { console.warn("[깐부 음성]", e); } }
      if (v.source !== "unity" || kind === "asking" || kind === "idle") return;
      if (kind === "listen") { var now = Date.now(); if (now - v.lastSent < 100) return; v.lastSent = now; }
      var msg = kind === "listen" ? "listen|" + arg.toFixed(2) : (kind === "sent" || kind === "error") ? kind + "|" + arg : kind;
      try { SendMessage("RoVoice", "OnVoice", msg); } catch (_) {}
    };
    var release = function () {   // 녹음기·마이크·분석기를 다 놓는다
      clearTimeout(v.timer); v.timer = 0;
      if (v.rec && v.rec.state !== "inactive") { v.rec.onstop = null; try { v.rec.stop(); } catch (_) {} }
      v.rec = null;
      if (v.stream) { v.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (_) {} }); v.stream = null; }
      if (v.ctx) { try { v.ctx.close(); } catch (_) {} v.ctx = null; }
      v.chunks = null; v.level = 0;
      try { SendMessage("SoundManager", "OnHtmlMuteAll", "0"); } catch (_) {}
    };
    var done = function (kind, arg) { release(); v.phase = "idle"; emit(kind, arg); emit("idle"); v.source = ""; };
    var getBase = function () {
      if (v.base) return Promise.resolve(v.base);
      return fetch("face.txt", { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("face.txt " + r.status); return r.text(); })
        .then(function (t) { v.base = t.trim().replace(/\/+$/, ""); return v.base; });
    };
    var auth = function (hd) {
      var au = window.__roSttAuth;
      if (!au || !au.n || !au.p) {   // 로그인 유지로 바로 들어왔으면 비번이 없다 — 브라우저에 둔 유지 열쇠("이름\n~열쇠", RoLoginKey.jslib)를 비번 자리에
        try { var kp = (localStorage.getItem("ro_login_keep") || "").split("\n"); if (kp.length === 2 && kp[0] && kp[1]) au = { n: kp[0], p: (kp[1].charAt(0) === "~" ? "" : "~") + kp[1] }; } catch (_) {}   // 저장된 열쇠엔 "~" 가 없다(RoLoginKeySave) — 안 붙이면 서버가 열쇠로 안 봐 '로그인이 필요합니다'(2026-11-13 사용자)
      }
      if (au && au.n && au.p) { hd["X-RO-Name"] = encodeURIComponent(au.n); hd["X-RO-Pin"] = au.p; }
      return hd;
    };
    var upload = function (blob, type, run) {
      v.phase = "stt"; emit("transcribe");
      getBase().then(function (base) {
        return fetch(base + "/stt", { method: "POST", headers: auth({ "Content-Type": type }), body: blob });
      }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var er = new Error(j.error || ("stt " + r.status)); er.ro = !!j.error; throw er; } return j; }); })
        .then(function (j) {
          if (run !== v.run) return;
          var text = String(j.text || "").trim().slice(0, 60);
          if (!text) { done("error", "잘 못 들었어요"); return; }
          // HUD 의 누르고 말하기(source "unity")는 늘 파티 채팅으로, 채팅 줄의 마이크(source "chat")는 그 입력줄이 가는 곳으로
          SendMessage("NetChat", v.source === "unity" ? "OnHtmlPartySend" : "OnHtmlSend", text);
          done("sent", text);
        }).catch(function (e) {
          console.warn("[깐부 음성] 받아쓰기 실패", e);
          if (run === v.run) done("error", e && e.ro ? e.message : "받아쓰기 실패");
        });
    };
    var pickType = function () {
      var list = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
      if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return "";
      for (var k = 0; k < list.length; k++) if (MediaRecorder.isTypeSupported(list[k])) return list[k];
      return "";
    };
    // 녹음 시작 — source "chat"(채팅 줄) / "unity"(HUD 버튼). 이미 녹음·받아쓰는 중이면 false
    v.begin = function (source) {
      if (v.phase !== "idle") return false;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { v.source = source; emit("error", "말로 보내기를 쓸 수 없는 브라우저예요"); v.source = ""; return false; }
      var run = ++v.run;
      v.source = source; v.phase = "rec"; v.started = 0; v.finish = null; emit("asking");
      var roMic = function (c) {   // 마이크 요청 — 처리 옵션을 붙여 실패하면(허락 거절 빼고) 옵션 없이 한 번 더(아이폰 사파리, 2026-11-15)
        // 아이폰: 게임이 소리 장치를 '재생 전용'(navigator.audioSession.type = "playback", RoAudioSessionEarly·RoAudioVisibility)으로 잡아 두면
        //   마이크 요청이 InvalidStateError 로 거절된다(2026-11-15 사용자 화면) → 요청 전에 '재생+녹음'으로. 마이크가 꺼지면 RoAudioVisibility 가 재생으로 되돌린다
        try { if (navigator.audioSession && navigator.audioSession.type !== "play-and-record") navigator.audioSession.type = "play-and-record"; } catch (_) {}
        return navigator.mediaDevices.getUserMedia(c).catch(function (e) {
          if (e && (e.name === "NotAllowedError" || e.name === "SecurityError")) throw e;
          console.warn("[마이크] 옵션 붙인 요청 실패 — 옵션 없이 다시", e);
          return navigator.mediaDevices.getUserMedia({ audio: true, video: false }).catch(function (e2) {
            if (e2 && (e2.name === "NotAllowedError" || e2.name === "SecurityError")) throw e2;
            // 아이폰: 게임 소리(유니티 WebAudio)가 소리 장치를 잡고 있으면 마이크가 '없다'고 나온다 — 소리 엔진을 잠깐 멈추고 한 번 더, 받은 뒤 다시 켬
            var ac = (typeof WEBAudio !== "undefined" && WEBAudio.audioContext) ? WEBAudio.audioContext : null;
            if (!ac || !ac.suspend) throw e2;
            console.warn("[마이크] 소리 엔진 멈추고 다시", e2);
            return ac.suspend().then(function () { return navigator.mediaDevices.getUserMedia({ audio: true, video: false }); })
              .then(function (s) { try { ac.resume(); } catch (_) {} return s; }, function (e3) { try { ac.resume(); } catch (_) {} throw e3; });
          });
        }).catch(function (eF) {   // 끝내 실패 = 재생 전용으로 되돌림 — 세션 종류는 오디오를 껐다 켜야 적용된다(안 하면 배경음이 통화용으로 작게 남는다, 2026-11-15 사용자 "아이폰 소리 또 확 줄어든다")
          try {
            if (navigator.audioSession) navigator.audioSession.type = "playback";
            var acF = (typeof WEBAudio !== "undefined" && WEBAudio.audioContext) ? WEBAudio.audioContext : null;
            if (acF && acF.state === "running") acF.suspend().then(function () { acF.resume(); });
          } catch (_) {}
          throw eF;
        });
      };
      roMic({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }).then(function (stream) {
        if (run !== v.run) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
        v.stream = stream;
        var type = pickType(), rec;
        try { rec = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream); }
        catch (e) { console.warn("[깐부 음성] 녹음기 실패", e); done("error", "녹음 시작 실패"); return; }
        v.rec = rec; v.chunks = [];
        try { SendMessage("SoundManager", "OnHtmlMuteAll", "1"); } catch (_) {}   // 게임 소리가 마이크로 섞이지 않게(받아쓰기 정확도)
        var analyser = null, buf = null;
        try {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (AC) { v.ctx = new AC(); if (v.ctx.resume) v.ctx.resume(); analyser = v.ctx.createAnalyser(); analyser.fftSize = 1024; v.ctx.createMediaStreamSource(stream).connect(analyser); buf = new Float32Array(analyser.fftSize); }
        } catch (_) { analyser = null; }
        var started = Date.now(), last = started, noise = 0, noiseN = 0, loudMs = 0, quietMs = 0, heard = false, live = false;
        v.started = started;
        // 소리를 잴 수 있나 — 분석기가 없거나 오디오 장치가 멈춰 있으면(사용자 동작 밖에서 만든 아이폰 장치) 자동 끝내기 없이 손으로·최대 시간만
        var measuring = function () { return analyser && v.ctx && v.ctx.state === "running"; };
        rec.ondataavailable = function (e) { if (e.data && e.data.size && v.chunks) v.chunks.push(e.data); };
        rec.onstop = function () {
          if (run !== v.run) return;
          var bt = (rec.mimeType || type || "audio/webm").split(";")[0].trim() || "audio/webm";
          var blob = new Blob(v.chunks || [], { type: bt });
          var send = v.sendIt, big = blob.size > 1500;
          release();
          if (!send) { v.phase = "idle"; emit(v.endKind || "cancel", v.endArg); emit("idle"); v.source = ""; return; }
          if (!big) { done("error", "녹음이 안 됐어요"); return; }
          upload(blob, bt, run);
        };
        v.finish = function (send, kind, arg) {
          if (run !== v.run || !v.rec || v.rec.state === "inactive") return;
          v.sendIt = send; v.endKind = kind; v.endArg = arg;
          clearTimeout(v.timer); v.timer = 0; v.level = 0;
          v.rec.stop();
        };
        v.heardNow = function () { return heard || !live; };
        rec.start(250);
        emit("listen", 0);
        var tick = function () {   // 화면 갱신(rAF)이 아니라 타이머 — 탭이 숨으면 rAF 가 멈춰 녹음이 끝나지 않았다
          if (run !== v.run || !v.rec) return;
          var now = Date.now(), dt = Math.min(250, now - last); last = now;
          live = measuring();
          if (live) {
            analyser.getFloatTimeDomainData(buf);
            var s = 0; for (var k = 0; k < buf.length; k++) s += buf[k] * buf[k];
            var rms = Math.sqrt(s / buf.length);
            if (now - started < 300) { noise += rms; noiseN++; }
            else {
              var floor = noiseN ? noise / noiseN : 0, th = Math.max(0.015, floor * 2.5);
              if (rms > th) { loudMs += dt; quietMs = 0; if (loudMs > 150) heard = true; } else quietMs += dt;
            }
            v.level = Math.min(1, rms * 6);
            if (heard && quietMs >= QUIET_MS) { v.finish(true); return; }
            if (!heard && now - started >= NOSPEECH_MS) { v.finish(false, "error", "말이 안 들렸어요"); return; }
          } else v.level = 0;
          emit("listen", v.level);
          if (now - started >= MAX_MS) { v.finish(true); return; }
          v.timer = setTimeout(tick, 50);
        };
        v.timer = setTimeout(tick, 50);
      }).catch(function (e) {
        console.warn("[깐부 음성] 마이크 거절", e);
        if (run === v.run) done("error", "마이크를 쓸 수 없어요(" + ((e && e.name) || "?") + ")");
      });
      return true;
    };
    // 끝내기 — send true = 바로 받아쓰기·보내기(말이 안 들렸으면 안 보냄), false = 취소
    v.end = function (send) {
      if (v.phase !== "rec") return;
      if (!v.finish) { v.run++; done("cancel"); return; }   // 마이크 허락을 묻는 중
      if (!send) { v.finish(false, "cancel"); return; }
      if (!v.heardNow()) { v.finish(false, "error", "말이 안 들렸어요"); return; }
      v.finish(true);
    };
    // 받아쓰는 중에도 취소(결과를 버림)
    v.cancel = function () {
      if (v.phase === "rec") { v.end(false); return; }
      if (v.phase === "stt") { v.run++; done("cancel"); }
    };
    return v;
  },
  // HUD '누르고 말하기'(UI 세션 B) — 채팅 줄을 열지 않고 녹음. 상태는 SendMessage('RoVoice','OnVoice', …)
  RoVoiceBegin__deps: ["$RoVoice"],
  RoVoiceBegin: function () { RoVoice().begin("unity"); },
  RoVoiceEnd__deps: ["$RoVoice"],
  RoVoiceEnd: function (send) { var v = RoVoice(); if (v.source === "unity") { if (v.phase === "stt" && !send) v.cancel(); else v.end(!!send); } },

  RoChatOpen__deps: ["$RoVoice"],
  // 채팅 입력줄 — 화면 아래에 진짜 입력칸 + 보내기 버튼(휴대폰 키보드·한글 조합이 그대로 됨). 보내면 NetChat.OnHtmlSend 로 넘긴다
  RoChatOpen: function (placeholderPtr) {
    var ph = UTF8ToString(placeholderPtr);
    var bar = document.getElementById("ro-chat-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "ro-chat-bar";
      bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:9999;display:flex;gap:8px;padding:10px;" +
        "background:rgba(46,32,24,0.92);border-top:2px solid var(--ro-ui-edge,#C9963F);box-sizing:border-box;";
      var inp = document.createElement("input");
      inp.id = "ro-chat-input"; inp.type = "text"; inp.maxLength = 60; inp.autocomplete = "off";
      // 버그 신고(2026-11-16 사용자 — 개발·테스터 계정의 "/버그 …" "/bug …" 를 서버 수신함으로)만 300자, 다른 채팅은 60자
      inp.addEventListener("input", function () { inp.maxLength = /^\/(버그|bug) /i.test(inp.value) ? 300 : 60; });
      inp.style.cssText = "flex:1;min-width:0;font-size:18px;padding:10px 12px;border-radius:6px;border:1px solid var(--ro-ui-edge,#C9963F);" +
        "background:#EBDDBC;color:var(--ro-ui-bg,#2E2018);outline:none;";
      var send = document.createElement("button");
      send.textContent = "보내기";
      send.style.cssText = "font-size:18px;padding:10px 16px;border-radius:6px;border:none;background:var(--ro-ui-button,#9E3B2E);color:#EBDDBC;font-weight:bold;";
      var close = document.createElement("button");
      close.textContent = "✕";
      close.style.cssText = "font-size:18px;padding:10px 14px;border-radius:6px;border:none;background:#5a4636;color:#EBDDBC;";
      var doSend = function () {
        var v = inp.value;
        inp.value = "";
        if (v && v.trim().length) SendMessage("NetChat", "OnHtmlSend", v);
        inp.focus({ preventScroll: true });
      };
      send.onclick = doSend;
      close.onclick = function () { window.__roChatHide(); };
      inp.onkeydown = function (e) {
        e.stopPropagation();   // 입력 중 키가 게임 조작(WASD 등)으로 새지 않게
        // 빈 칸에서 엔터 = 채팅 닫기(2026-11-09 사용자 "엔터로 연 채팅창, 아무 입력 없이 다시 엔터면 닫히게") — 게임 쪽 창도 같이 닫는다
        if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); if (!inp.value.trim().length) { window.__roChatHide(); SendMessage("NetChat", "OnHtmlClose", ""); } else doSend(); }
        else if (e.key === "Escape") close.onclick();
      };
      inp.onkeyup = function (e) { e.stopPropagation(); };
      inp.onkeypress = function (e) { e.stopPropagation(); };   // 글자 입력도 게임으로 새지 않게(PC 에서 영어·숫자가 막혔다)
      // 말로 보내기 — 채팅 줄 모양(UI 세션 시안 A, 2026-11-13 사용자 'A + B 같이'). 녹음·받아쓰기는 공용 엔진 RoVoice()(HUD 버튼 B 와 같이 씀).
      //   평소 = 입력칸 왼쪽 둥근 마이크 / 듣는 중 = 마이크 붉게 빛남 + 입력칸 자리에 어두운 칸(금빛 파형 막대 + 빨간 점 '듣는 중 0:03') + 보내기 자리 '✕ 취소'
      //   받아쓰는 중 = 크림 칸에 튀는 점 셋 '받아쓰는 중…'. 다 되면 평소로(글은 파티 채팅 줄로 올라감). 좁은 화면(360)에선 막대 수를 줄여 글이 칸 밖으로 안 나가게.
      var voice = RoVoice();
      if (!document.getElementById("ro-voice-css")) {
        var vcss = document.createElement("style"); vcss.id = "ro-voice-css";
        vcss.textContent = "@keyframes roVoiceBlink{50%{opacity:.15}}@keyframes roVoiceHop{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-6px)}}" +
          "#ro-voice-box .ro-vb{width:3px;border-radius:2px;background:#FFD966;flex:0 0 3px;height:4px;transition:height .07s}" +
          "#ro-voice-box .ro-vd{width:8px;height:8px;border-radius:50%;background:#9E3B2E;display:inline-block;animation:roVoiceHop .9s infinite}";
        document.head.appendChild(vcss);
      }
      var mic = document.createElement("button");
      mic.id = "ro-chat-mic"; mic.type = "button"; mic.setAttribute("aria-label", "말로 보내기"); mic.title = "말로 보내기";
      mic.style.cssText = "flex:0 0 44px;width:44px;height:44px;align-self:center;padding:0;border-radius:50%;box-sizing:border-box;border:2px solid var(--ro-ui-edge,#C9963F);" +
        "background:var(--ro-ui-bg,#2E2018);color:#EBDDBC;transition:background .15s,box-shadow .15s;";
      mic.innerHTML = "<svg viewBox='0 0 24 24' width='22' height='22' style='display:block;margin:auto' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'>" +
        "<rect x='9' y='3' width='6' height='11' rx='3'/><path d='M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21'/></svg>";
      var box = document.createElement("div");
      box.id = "ro-voice-box";
      box.style.cssText = "display:none;flex:1;min-width:0;align-items:center;gap:8px;padding:0 10px;border-radius:6px;box-sizing:border-box;overflow:hidden;border:1px solid var(--ro-ui-edge,#C9963F);";
      var bars = document.createElement("div");
      bars.style.cssText = "display:flex;align-items:center;justify-content:center;gap:3px;height:28px;flex:1 1 auto;min-width:0;overflow:hidden;";
      var recLab = document.createElement("div");
      recLab.style.cssText = "display:flex;align-items:center;gap:6px;flex:0 0 auto;white-space:nowrap;font-size:16px;font-weight:bold;color:#EBDDBC;";
      recLab.innerHTML = "<span style='width:8px;height:8px;border-radius:50%;background:#E0402F;display:inline-block;animation:roVoiceBlink 1s infinite'></span><span></span>";
      var recTxt = recLab.lastChild;
      var sttLab = document.createElement("div");
      sttLab.style.cssText = "display:none;align-items:center;gap:10px;flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;font-size:16px;color:var(--ro-ui-bg,#2E2018);";
      sttLab.innerHTML = "<span style='display:flex;gap:5px;flex:0 0 auto'><span class='ro-vd'></span><span class='ro-vd' style='animation-delay:.15s'></span><span class='ro-vd' style='animation-delay:.3s'></span></span><span>받아쓰는 중…</span>";
      box.appendChild(bars); box.appendChild(recLab); box.appendChild(sttLab);
      var cancel = document.createElement("button");
      cancel.type = "button"; cancel.textContent = "✕ 취소";
      cancel.style.cssText = "display:none;flex:0 0 auto;white-space:nowrap;font-size:18px;padding:10px 14px;border-radius:6px;border:none;background:#5a4636;color:#EBDDBC;font-weight:bold;";
      var barEls = [];
      var fitBars = function () {   // 들어가는 만큼만(최대 17개, 폭 3·간격 3)
        var n = Math.max(3, Math.min(17, Math.floor((bars.clientWidth + 3) / 6)));
        if (n === barEls.length) return;
        bars.innerHTML = ""; barEls = [];
        for (var i = 0; i < n; i++) { var b = document.createElement("div"); b.className = "ro-vb"; bars.appendChild(b); barEls.push(b); }
      };
      var paintBars = function (lv) {
        var c = (barEls.length - 1) / 2;
        for (var i = 0; i < barEls.length; i++) {
          var w = 1 - 0.65 * Math.abs(i - c) / Math.max(1, c);   // 가운데가 높게
          barEls[i].style.height = Math.round(Math.max(4, Math.min(28, 4 + 24 * lv * w * (0.7 + 0.3 * Math.random())))) + "px";
        }
      };
      var hintTimer = 0;
      var hint = function (t, ms) {
        clearTimeout(hintTimer);
        inp.placeholder = t || (inp.dataset.ph || "");
        if (t && ms) hintTimer = setTimeout(function () { inp.placeholder = inp.dataset.ph || ""; }, ms);
      };
      var mode = "";
      var look = function (m) {
        if (m === mode) return; mode = m;
        var rec = m === "rec", stt = m === "stt", busy = rec || stt;
        mic.style.background = rec ? "var(--ro-ui-button,#9E3B2E)" : "var(--ro-ui-bg,#2E2018)";
        mic.style.boxShadow = rec ? "0 0 10px #ff5a3c99" : "";
        mic.setAttribute("aria-label", rec ? "듣는 중 · 눌러서 보내기" : stt ? "받아쓰는 중" : "말로 보내기");
        if (busy) box.style.height = (inp.offsetHeight || 44) + "px";
        inp.style.display = busy ? "none" : "";
        box.style.display = busy ? "flex" : "none";
        box.style.background = rec ? "#1d1410" : "#EBDDBC";
        bars.style.display = rec ? "flex" : "none";
        recLab.style.display = rec ? "flex" : "none";
        sttLab.style.display = stt ? "flex" : "none";
        send.style.display = busy ? "none" : "";
        close.style.display = busy ? "none" : "";
        cancel.style.display = busy ? "" : "none";
        if (rec) { fitBars(); paintBars(0); }
      };
      voice.on(function (kind, arg) {
        if (kind === "asking") { look("rec"); recTxt.textContent = "허락 대기"; }
        else if (kind === "listen") {
          look("rec");
          var sec = voice.started ? Math.floor((Date.now() - voice.started) / 1000) : 0;
          recTxt.textContent = "듣는 중 " + Math.floor(sec / 60) + ":" + (sec % 60 < 10 ? "0" : "") + (sec % 60);
          fitBars(); paintBars(arg || 0);   // 글(허락 대기 → 듣는 중 0:03)이 길어지면 막대 칸이 줄어든다 — 그때마다 막대 수를 다시 맞춘다(360폭에서 넘쳤다)
        }
        else if (kind === "transcribe") look("stt");
        else if (kind === "idle") look("idle");
        else if (kind === "sent") hint("보냄: " + arg, 2500);
        else if (kind === "error") hint(arg, 3500);
      });
      mic.onclick = function () {
        if (voice.phase === "idle") { inp.blur(); voice.begin("chat"); }
        else if (voice.phase === "rec") voice.end(true);   // 다시 누름 = 바로 끝내고 보냄(마이크 허락 전이면 취소)
      };
      cancel.onclick = function () { voice.cancel(); };
      window.__roChatMicCancel = function () { if (voice.source === "chat") voice.cancel(); };
      bar.appendChild(mic); bar.appendChild(inp); bar.appendChild(box); bar.appendChild(send); bar.appendChild(cancel); bar.appendChild(close);
      document.body.appendChild(bar);
      // 키보드가 올라와도 게임 화면(캔버스)은 그대로 두고 입력줄만 키보드 바로 위에(2026-11-11 사용자 "화면 전체가 올라가 캐릭터가 안 보인다").
      //   안드로이드 크롬 = 채팅 동안만 viewport 에 interactive-widget=overlays-content(키보드가 화면을 줄이지 않고 덮음 → 캔버스 크기 그대로라 유니티가 다시 맞추지 않는다).
      //   아이폰 = 포커스 때 스크롤하지 않고(preventScroll), 문서를 고정하고 밀리면 scrollTo(0,0) 로 되돌림. 입력줄 = visualViewport 아래끝(키보드 위)에 맞춤
      var meta = document.querySelector("meta[name=viewport]");
      var vvFix = function () {
        if (bar.style.display === "none") return;
        if (window.scrollY || window.scrollX || document.documentElement.scrollTop || document.body.scrollTop) { window.scrollTo(0, 0); document.documentElement.scrollTop = document.body.scrollTop = 0; }
        var vv = window.visualViewport; if (!vv) return;
        // 키보드 위끝 = 보이는 화면(visualViewport) 아래끝
        var kbTop = vv.offsetTop + vv.height;
        // 안드로이드 크롬 overlays-content 는 키보드가 덮기만 해 visualViewport 가 안 줄어 키보드를 못 봤다(2026-11-11 사용자 폰 — 창·입력줄이 키보드 밑에) → 크롬 VirtualKeyboard 가 알려 주는 키보드 위끝도 본다
        var vk = navigator.virtualKeyboard;
        if (vk && vk.overlaysContent && vk.boundingRect && vk.boundingRect.height > 0) kbTop = Math.min(kbTop, vk.boundingRect.top);
        // 올릴 양 = 입력줄의 원래(옮기기 전) 아래끝 - 키보드 위끝. 예전엔 '창 높이 - 키보드 위끝' 으로 빼서, 첫 열기 때 키보드가 창을 이미 줄여
        //   입력줄(bottom:0)이 벌써 키보드 위에 있는데 키보드 높이만큼 한 번 더 올려 화면 가운데로 갔다(2026-11-17 사용자 폰 v0.1.146 — 껐다 켜면 정상)
        bar.style.transform = "";
        var gap = Math.round(bar.getBoundingClientRect().bottom - kbTop);
        bar.style.transform = gap > 1 ? "translateY(" + (-gap) + "px)" : "";
        // 게임 채팅 창(유니티 HUD chat)도 키보드 + 입력줄이 덮은 만큼 올리게 — 캔버스 높이 비율을 보낸다(키보드가 없으면 0 = 원래 자리)
        var ratio = 0;
        if (gap > 1) {
          var cv = document.querySelector("#unity-canvas"), cr = cv ? cv.getBoundingClientRect() : null;
          if (cr && cr.height > 0) ratio = Math.max(0, Math.min(0.9, (cr.bottom - bar.getBoundingClientRect().top) / cr.height));
        }
        sendKb(ratio);
      };
      var lastKb = -1;
      var sendKb = function (r) { r = Math.round(r * 1000) / 1000; if (r === lastKb) return; lastKb = r; try { SendMessage("chat", "OnHtmlKeyboard", String(r)); } catch (_) {} };
      var saved = null;
      window.__roChatShow = function () {
        if (!saved) {
          var de = document.documentElement, b = document.body;
          saved = { meta: meta ? meta.getAttribute("content") : null, de: de.style.overflow, bo: b.style.overflow, bp: b.style.position, bt: b.style.top, bl: b.style.left, bw: b.style.width, bh: b.style.height };
          if (meta && !/interactive-widget/.test(saved.meta || "")) meta.setAttribute("content", (saved.meta ? saved.meta + ", " : "") + "interactive-widget=overlays-content");
          try { if (navigator.virtualKeyboard) { saved.vk = navigator.virtualKeyboard.overlaysContent; navigator.virtualKeyboard.overlaysContent = true; } } catch (_) {}
          de.style.overflow = "hidden"; b.style.overflow = "hidden"; b.style.position = "fixed"; b.style.top = "0"; b.style.left = "0"; b.style.width = "100%"; b.style.height = "100%";
        }
        vvFix();
      };
      window.__roChatHide = function () {
        if (window.__roChatMicCancel) window.__roChatMicCancel();
        bar.style.display = "none"; bar.style.transform = ""; inp.blur(); sendKb(0);
        if (saved) {
          var de = document.documentElement, b = document.body;
          if (meta && saved.meta !== null) meta.setAttribute("content", saved.meta);
          try { if (navigator.virtualKeyboard && saved.vk !== undefined) navigator.virtualKeyboard.overlaysContent = saved.vk; } catch (_) {}
          de.style.overflow = saved.de; b.style.overflow = saved.bo; b.style.position = saved.bp; b.style.top = saved.bt; b.style.left = saved.bl; b.style.width = saved.bw; b.style.height = saved.bh;
          saved = null;
        }
      };
      if (window.visualViewport) { window.visualViewport.addEventListener("resize", vvFix); window.visualViewport.addEventListener("scroll", vvFix); }
      if (navigator.virtualKeyboard) navigator.virtualKeyboard.addEventListener("geometrychange", vvFix);   // 크롬 키보드가 오르내릴 때
      window.addEventListener("scroll", vvFix, { passive: true });
      inp.addEventListener("focus", function () { vvFix(); setTimeout(vvFix, 50); setTimeout(vvFix, 300); });
      inp.addEventListener("blur", function () { setTimeout(vvFix, 50); });
    }
    var input = document.getElementById("ro-chat-input");
    input.placeholder = ph; input.dataset.ph = ph;
    bar.style.display = "flex";
    window.__roChatShow();
    input.focus({ preventScroll: true });
    // 게임 화면의 채팅 칸을 눌러 열면, 그 클릭 뒤에 게임(캔버스)이 포커스를 다시 가져가 PC 에선 글자가 안 들어갔다(2026-11-04) — 조금 뒤 한 번 더
    setTimeout(function () { if (bar.style.display !== "none") input.focus({ preventScroll: true }); }, 120);
    setTimeout(function () { if (bar.style.display !== "none" && document.activeElement !== input) input.focus({ preventScroll: true }); }, 400);
    // 아이폰(사파리·크롬)은 사용자가 누르는 그 순간(터치 처리 안)에만 focus 가 키보드를 띄운다(2026-11-11 사용자 "아이폰에서 채팅 버튼 눌러도 키보드가 안 올라올 때가 있음").
    //   게임 채팅 버튼은 한 프레임 뒤에 여기를 불러 그 순간을 놓칠 때가 있다 → 0.45초 뒤에도 입력칸에 포커스가 없으면, 다음 한 번의 터치(어디든)에서 포커스를 주고
    //   그동안 입력칸을 '눌러서 입력' 으로 빛나게 해 눌러야 함을 알린다. 키보드가 뜨면(포커스) 바로 풀린다
    setTimeout(function () {
      if (bar.style.display === "none" || document.activeElement === input) return;
      input.placeholder = "여기를 눌러 입력";
      input.style.boxShadow = "0 0 0 3px #FFD966,0 0 14px #FFD966aa";
      var once = function (e) {
        document.removeEventListener("touchend", once, true);
        if (bar.style.display === "none") return;
        if (e.target && e.target.closest && e.target.closest("#ro-chat-bar button")) return;   // 보내기·닫기 누름은 그대로
        input.focus({ preventScroll: true }); if (document.activeElement === input) calm();
      };
      document.addEventListener("touchend", once, true);
      function calm() { input.placeholder = ph; input.style.boxShadow = ""; input.removeEventListener("focus", calm); document.removeEventListener("touchend", once, true); }
      input.addEventListener("focus", calm);
    }, 450);
  },
  // 로딩 글 = 세계관 문구를 돌아가며(2026-11-23 사용자 "맵 받는 중처럼 세계관과 안 맞게 하지 말고 세계관 스토리와 어울리게" — 보기 창 '여러 문구 돌아가며'·'위 띠·Loading 도 같이').
  //   포링 로딩 화면·검은 덮개·진행률 막대가 같은 시계(2.8초)로 같은 문구를 보여 준다. 가장 긴 문구 13자 — 좁은 폰(320폭)에서도 20px 한 줄
  $RoLore: function () {
    if (window.__roLore) return window.__roLore;
    var L = ["소환진에 마력을 모으는 중", "대륙의 지도를 펼치는 중", "차원문을 여는 중", "전장의 바람을 부르는 중", "포링들이 길을 닦는 중", "모닥불을 지피는 중"];
    var lore = window.__roLore = {
      line: function () { return L[Math.floor(Date.now() / 2800) % L.length]; },
      bind: function (node) {   // 붙인 글 노드를 화면에 있는 동안 계속 바꾼다(떼어지면 멈춤) — 노드를 붙인 뒤에 부른다
        node.nodeValue = lore.line();
        var t = setInterval(function () { if (!node.isConnected) { clearInterval(t); return; } node.nodeValue = lore.line(); }, 400);
        return node;
      }
    };
    return lore;
  },
  // 팝업과 수명을 분리한 입장 배경막. 실제 플레이어/맵 준비 완료 시 RoEntryReady로만 해제한다.
  $RoEntryUI__deps: ["$RoLore"],
  $RoEntryUI: function () {
    if (window.__roEntryUI) return window.__roEntryUI;
    var ui = { cleanup: null, racePreviewSelected: false };
    ui.logoUrl = function () { return window.__roBootLogoUrl || "TemplateData/boot_logo.png?v=194c96644eb6"; };
    ui.setRacePreview = function (selected) {
      ui.racePreviewSelected = !!selected;
      if (ui.root) ui.root.style.background = selected ? "rgba(12,9,7,.76)" : "#100d0a";
    };
    ui.ensure = function () {
      if (ui.root && ui.root.isConnected) return ui;
      var root = ui.root = document.createElement("div");
      root.id = "ro-entry-overlay";
      root.style.cssText = "position:fixed;inset:0;z-index:10000;background:#100d0a;backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);overflow:auto;overscroll-behavior:contain;font-family:'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif;isolation:isolate";
      var top = ui.top = document.createElement("div");
      top.id = "ro-entry-top";
      top.style.cssText = "width:min(88vw,440px);margin:16px auto 12px;display:flex;flex-direction:column;align-items:center;gap:12px";
      var topCss = document.createElement("style"); topCss.textContent = "#ro-entry-top:empty{display:none}";   // 비어 있으면 여백 28 도 없앤다(9:21 화면 맞춤)
      root.appendChild(topCss);
      // 접속 화면 글·그림이 끌려 선택·드래그되지 않게(2026-11-11 사용자 "접속 페이지에서 텍스트들이 드래그·선택된다") — 아이폰 길게 누르기 확대경·복사 메뉴도 막고, 입력칸만 글 선택을 되살린다
      var noSel = document.createElement("style"); noSel.textContent = "#ro-entry-overlay{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}#ro-entry-overlay input,#ro-entry-overlay textarea,#ro-entry-overlay [contenteditable]:not([contenteditable=false]){-webkit-user-select:text;user-select:text;-webkit-touch-callout:default}#ro-entry-overlay img{-webkit-user-drag:none;user-drag:none}";
      root.appendChild(noSel);
      root.addEventListener("dragstart", function (e) { var t = e.target; if (!(t && t.closest && t.closest("input,textarea,[contenteditable]"))) e.preventDefault(); });
      // 첫 HTML 부팅 로고 이후에는 팝업 내부 로고만 표시한다.
      root.appendChild(top); document.body.appendChild(root);
      ui.setRacePreview(ui.racePreviewSelected);
      return ui;
    };
    // 카드를 화면 높이에 맞춘다(2026-11-09 사용자 "9:21 세로 화면에서 로그인·사진·얼굴 고르기·목소리 카드가 길쭉해 끌어 내려야 한다 — 더 이상 안 길어지게").
    //   카드 묶음(#ro-name-card)이 화면보다 길면 zoom 으로 통째로 줄인다(최소 0.8배 — 그보다 작으면 글이 너무 작아 그때만 끌어 내림).
    //   내용이 바뀔 때(오류 줄·진행 막대·단계 바뀜)·화면 크기가 바뀔 때 다시 잰다. 휴대폰 키보드가 올라와 높이가 줄어든 동안(입력칸에 글을 쓰는 중)은 줄이지 않는다.
    ui.fitCard = function (wrap) {
      if (ui.fitObs) ui.fitObs.disconnect();
      var queued = false;
      var run = function () {
        queued = false;
        if (!wrap.isConnected || !ui.root) { if (ui.fitObs) ui.fitObs.disconnect(); return; }
        var avail = ui.root.clientHeight, a = document.activeElement;
        var typing = a && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && !/^(file|checkbox|radio|button)$/.test(a.type)));
        if (typing && ui.fitH && avail < ui.fitH - 40) return;
        ui.fitH = avail;
        wrap.style.zoom = "";
        var h = wrap.offsetHeight, other = ui.root.scrollHeight - h;
        // 카드 세로는 화면 높이의 70% 까지(2026-11-11 사용자 아이폰 "너무 길게 늘어난다, 최대 이 정도 안으로" — 로그인 카드가 화면의 80% 를 넘게 차지했다). 넘으면 통째로 줄인다(최소 0.8배)
        //   zoom 이 높이에 어떻게 먹는지 브라우저마다 달라(크롬은 두 번 먹는 듯 줄었다) 줄인 뒤 실제 보이는 높이를 다시 재 한 번 맞춘다
        //   2026-11-11 사용자 "갤럭시 폴드 펼친 화면에서 카드 좌우·위아래 여백이 너무 많다" — 폭 600 이상·가로세로 0.7 이상인 터치 화면은 높이 90% 안팎까지 쓰고(아래 띠 여백이 있으면 그만큼 덜), 작으면 키운다(최대 1.8배, 폭은 화면의 92% 안)
        var wide = window.innerWidth >= 600 && window.innerWidth >= window.innerHeight * 0.7 && (navigator.maxTouchPoints > 0 || (window.matchMedia && window.matchMedia("(pointer:coarse)").matches));
        //   2026-11-11 사용자 "종족 선택 화면 꽉 차게, 가로 여백이 너무 남는다"(폴드 세로) — 종족·성별 창(ro-race-wide)은 세로 화면이면 폭을 화면 - 40px 까지 같은 비율로 키운다
        var raceWide = wrap.classList.contains("ro-race-wide") && window.innerHeight > window.innerWidth;
        if (raceWide) wide = true;
        //   넓은 화면은 other(scrollHeight - h — 내용이 화면보다 짧으면 화면 높이에 붙어 부풀어 오른다) 대신 카드 위 자리(offsetTop)와 아래 띠 여백만 뺀다
        var lim = wide ? Math.min(avail - wrap.offsetTop - (parseFloat(getComputedStyle(ui.root).paddingBottom) || 0) - 2, Math.round(window.innerHeight * 0.95))
          : Math.min(avail - other - 2, Math.round(window.innerHeight * 0.7));
        var vis = function () { return (wrap.firstChild || wrap).getBoundingClientRect().height + (h - (wrap.firstChild || wrap).offsetHeight); };
        var h0 = vis();
        if (h0 > 0 && h0 > lim) {
          var z = Math.max(0.8, lim / h0); wrap.style.zoom = z;
          var h1 = vis(); if (h1 > 0 && Math.abs(h1 - lim) > 4) wrap.style.zoom = Math.max(0.8, Math.min(1, z * lim / h1));
        } else if (wide && h0 > 0) {
          //   카드 묶음 전체(h, 틀 위·아래 여백 포함)가 같은 배율로 커지니, 틀이 실제로 몇 배 커졌는지(k)를 재 h × k 가 lim 에 맞게 한 번 더 맞춘다
          var rim0 = (wrap.firstChild || wrap).getBoundingClientRect();
          var cap = Math.min(1.8, rim0.width > 0 ? (raceWide ? (window.innerWidth <= 600 ? window.innerWidth - 40 : window.innerWidth * 0.8) : window.innerWidth * 0.92) / rim0.width : 1.8);
          var zu = Math.min(cap, lim / h);
          if (zu > 1.02 && rim0.height > 0) {
            wrap.style.zoom = zu;
            var k = (wrap.firstChild || wrap).getBoundingClientRect().height / rim0.height;
            if (k > 0 && Math.abs(h * k - lim) > 4) wrap.style.zoom = Math.max(1, Math.min(cap, zu * lim / (h * k)));
            var over = ui.root.scrollHeight - avail;   // 키워서 끌어 내려야 하게 됐으면(브라우저마다 zoom 계산이 달라) 넘친 만큼 되돌린다
            if (over > 1) wrap.style.zoom = Math.max(1, parseFloat(wrap.style.zoom) - (over + 2) / h);
          }
        }
        // 폭 375 휴대폰에서 판 양옆이 잘림(QA 새 유저 v153) — 배율이 어떻게 먹었든 틀이 화면 폭 - 24px 를 넘으면 넘친 만큼 줄인다(브라우저마다 zoom 계산이 달라 두 번 잰다)
        for (var gi = 0; gi < 2; gi++) {
          var rw = (wrap.firstChild || wrap).getBoundingClientRect().width, maxW = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth) - 24;
          if (!(maxW > 0 && rw > maxW + 1)) break;
          wrap.style.zoom = (parseFloat(wrap.style.zoom) || 1) * maxW / rw;
        }
      };
      var later = function () { if (!queued) { queued = true; setTimeout(run, 16); } };
      if (window.ResizeObserver) { ui.fitObs = new ResizeObserver(later); ui.fitObs.observe(wrap.firstChild || wrap); if (ui.top) ui.fitObs.observe(ui.top); }
      if (!ui.fitResize) { ui.fitResize = true; window.addEventListener("resize", function () { var w = document.getElementById("ro-name-card"); if (w && ui.root) ui.fitCard(w); }); }
      later();
    };
    ui.hideBusy = function () { if (ui.busyPanel) ui.busyPanel.remove(); ui.busyPanel = null; };
    // 로딩 화면(2026-11-11 사용자 "다시 깔끔하게 — 빈 화면에 '로딩' 이라고 써 있고, 가방 멘 포링이 뽀잉뽀잉") — 덮개 바탕 그대로, 가운데 포링이 제자리에서 통통(0.7초, 착지 납작·뜰 때 길쭉·그림자 커졌다 작아짐) + '로딩' 과 점 세 개.
    //   title 은 화면에 안 쓰고 읽기 프로그램용 aria-label 로만. 카드가 떠 있는 채로 부르면 카드 아래에 작게(카드와 안 겹치게). 그림 = Assets/_RO/Net/WebUI/loading_poring.webp(WebGLNoUnityLogo 가 복사)
    ui.busy = function (title) {
      ui.ensure(); ui.hideBusy();
      if (!document.getElementById("ro-entry-spin-style")) {
        var style = document.createElement("style"); style.id = "ro-entry-spin-style";
        style.textContent = "@keyframes roEntrySpin{to{transform:rotate(360deg)}}"
          + "@keyframes roLoadHop{0%{transform:translateY(0) scale(1.14,.86)}12%{transform:translateY(-8%) scale(.86,1.16)}50%{transform:translateY(-62%) scale(.97,1.04);animation-timing-function:cubic-bezier(.55,0,.85,.4)}86%{transform:translateY(-4%) scale(.9,1.12)}100%{transform:translateY(0) scale(1.14,.86)}}"
          + "@keyframes roLoadShadow{0%,100%{transform:scale(1.15);opacity:.55}50%{transform:scale(.55);opacity:.22}}"
          + "@keyframes roLoadDot1{0%,24%{opacity:0}25%,100%{opacity:1}}@keyframes roLoadDot2{0%,49%{opacity:0}50%,100%{opacity:1}}@keyframes roLoadDot3{0%,74%{opacity:0}75%,100%{opacity:1}}"
          + "#ro-entry-busy .hop{animation:roLoadHop .7s cubic-bezier(.2,.7,.4,1) infinite;transform-origin:50% 100%}"
          + "#ro-entry-busy .shd{animation:roLoadShadow .7s ease-in-out infinite}"
          + "#ro-entry-busy .dot{opacity:0;animation:roLoadDot1 1.4s linear infinite}#ro-entry-busy .dot:nth-child(2){animation-name:roLoadDot2}#ro-entry-busy .dot:nth-child(3){animation-name:roLoadDot3}"
          + "@media (prefers-reduced-motion:reduce){#ro-entry-busy .hop,#ro-entry-busy .shd{animation:none}}";
        ui.root.appendChild(style);
      }
      var small = !!ui.root.querySelector("#ro-name-card");   // 카드가 있으면 카드 아래에 작게
      var pw = small ? 32 : 60;   // 2026-11-11 사용자 "로딩 포링 반으로, 너무 크다"(64·120 → 32·60) — 그림자·튀는 높이는 pw 비율이라 같이 줄어든다
      var panel = ui.busyPanel = document.createElement("div"); panel.id = "ro-entry-busy";
      panel.setAttribute("role", "status"); panel.setAttribute("aria-live", "polite"); panel.setAttribute("aria-label", title || "불러오는 중");
      panel.style.cssText = small ? "margin:14px auto 28px;display:flex;flex-direction:column;align-items:center;gap:3px;color:#EBDDBC;pointer-events:none"
        : "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#EBDDBC;pointer-events:none;padding-bottom:6vh;box-sizing:border-box";
      var stage = document.createElement("div"); stage.setAttribute("aria-hidden", "true");
      stage.style.cssText = "position:relative;width:" + pw + "px;height:" + Math.round(pw * 1.3) + "px";
      var shd = document.createElement("div"); shd.className = "shd";
      shd.style.cssText = "position:absolute;left:18%;right:18%;bottom:0;height:" + Math.round(pw * 0.13) + "px;border-radius:50%;background:radial-gradient(#f2c77a33,#f2c77a00 70%)";
      var hop = document.createElement("img"); hop.className = "hop"; hop.alt = ""; hop.draggable = false;
      hop.src = "TemplateData/ro-onboarding/loading_poring.webp";
      hop.style.cssText = "position:absolute;left:0;bottom:" + Math.round(pw * 0.05) + "px;width:100%;height:auto;display:block";
      stage.appendChild(shd); stage.appendChild(hop);
      var label = document.createElement("div"); label.setAttribute("aria-hidden", "true");
      label.style.cssText = "font-size:" + (small ? 16 : 20) + "px;font-weight:400;letter-spacing:1px;text-shadow:0 2px 0 #0008;max-width:92vw;text-align:center";
      var loreT = document.createTextNode(""); label.appendChild(loreT);   // 'Loading' → 세계관 문구(돌아감)
      for (var i = 0; i < 3; i++) { var d = document.createElement("span"); d.className = "dot"; d.textContent = "."; label.appendChild(d); }
      panel.appendChild(stage); panel.appendChild(label); ui.root.appendChild(panel);
      RoLore().bind(loreT);
      if (ui.prog) ui.progress(ui.prog.p, ui.prog.label);   // 받는 중에 로딩 화면이 새로 뜨면 막대를 이 화면으로 옮긴다
      // 너무 오래 걸리면 빠져나갈 길(2026-11-11 사용자 아이폰 v.0.079 "'접속 중입니다'만 뜨고 안 들어감, 새 버전 받으란 화면도 없음") —
      //   월드 열기·접속이 멈춰도 이 화면엔 끝이 없었다. 45초가 지나도 같은 판이면 '다시 시도' 버튼: 주소에 새 값을 붙여(?r=) index.html·옛 캐시까지 새로 받는다
      setTimeout(function () {
        if (!panel.isConnected || ui.busyPanel !== panel) return;
        var again = document.createElement("button"); again.type = "button"; again.textContent = "다시 시도";
        again.style.cssText = "pointer-events:auto;margin-top:6px;padding:10px 26px;font:inherit;font-size:16px;font-weight:900;color:#452108;border:3px solid #d7891b;border-top-color:#fff1a9;border-radius:16px;background:linear-gradient(#ffe78a,#ffc336 48%,#efa214);box-shadow:inset 0 2px #fff8,0 4px 0 #793b0d;cursor:pointer";
        again.onclick = function () {
          again.disabled = true;
          var u = location.href.replace(/([?&])r=\d+&?/, "$1").replace(/[?&]$/, "");
          location.replace(u + (u.indexOf("?") >= 0 ? "&" : "?") + "r=" + Date.now());
        };
        panel.appendChild(again);
      }, 45000);
    };
    ui.cancel = function () { if (ui.cleanup) { var fn = ui.cleanup; ui.cleanup = null; fn(); } ui.hideBusy(); };
    // 월드·첫 존 묶음 받는 진행률(2026-11-23 사용자 "진행률 표시" — 프롤로그 뒤 포링 로딩만 보여 멈춘 줄 알았다) — 게임이 RoLoadProgress(0~1, 글)로 알린다. p < 0 = 숨김.
    //   포링 로딩 화면이 떠 있으면 그 아래에, 없으면(빛기둥 같은 게임 화면) 화면 아래쪽에 띄운다. 막대 색 = BootLoader 의 금빛 막대와 같게
    // 유료 생성(얼굴·목소리) 요청에 기기 번호 머리글(2026-11-23 서버 세션 — 기기당 제한) — 게임이 RoDeviceSet 으로 알려 준 값(NetSession.DeviceId), 엔진이 뜨기 전이면 지난번에 남긴 값. 없으면 안 붙인다
    ui.devHeaders = function (h) {
      var d = ""; try { d = window.__roDevice || localStorage.getItem("ro_device_id") || ""; } catch (_) {}
      if (/^[0-9a-f]{32}$/.test(d)) h["X-RO-Device"] = d;
      return h;
    };
    ui.progress = function (p, label) {
      if (!(p >= 0)) { ui.prog = null; if (ui.progEl) ui.progEl.remove(); ui.progEl = null; return; }
      p = Math.min(1, p); ui.prog = { p: p, label: label || "" };
      var host = ui.busyPanel && ui.busyPanel.isConnected ? ui.busyPanel : document.body;
      var el = ui.progEl;
      if (!el || !el.isConnected || el.parentNode !== host) {
        if (el) el.remove();
        el = ui.progEl = document.createElement("div"); el.id = "ro-load-prog"; el.setAttribute("aria-hidden", "true");
        el.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;color:#EBDDBC;font:400 13px/1.3 'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif;text-shadow:0 2px 0 #0008" +
          (host === document.body ? ";position:fixed;left:50%;bottom:max(12vh,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:2147481000" : ";margin-top:4px");
        el.innerHTML = "<div style='box-sizing:border-box;width:min(64vw,260px);height:14px;padding:2px;border:2px solid #C9963F;border-radius:99px;background:#291a0f;box-shadow:0 2px 6px #0008'>" +
          "<div style='height:100%;width:0;border-radius:99px;background:linear-gradient(#ffe38c,#f2b540);transition:width .25s linear'></div></div><div></div>";
        var again = host !== document.body ? host.querySelector("button") : null;   // 포링 화면의 '다시 시도' 버튼보다 위에
        if (again) host.insertBefore(el, again); else host.appendChild(el);
        // 글 = [문구] + %. 글을 안 주면(빈 값) 화면 아래 막대는 세계관 문구를 돌려 보이고, 포링 화면 안 막대는 포링 아래 같은 문구가 있으니 %만
        el.loreT = el.lastChild.appendChild(document.createTextNode("")); el.pctT = el.lastChild.appendChild(document.createTextNode(""));
        if (ui.prog.label) el.loreT.nodeValue = ui.prog.label; else if (host === document.body) RoLore().bind(el.loreT);
      }
      el.firstChild.firstChild.style.width = (p * 100).toFixed(1) + "%";
      el.pctT.nodeValue = (el.loreT.nodeValue ? " " : "") + Math.round(p * 100) + "%";
      ui.progPlace();
    };
    // 화면 아래쪽 막대(포링 화면이 없을 때) 자리 = 게임 캔버스 기준(QA v0.1.183 — PC 좁은 창 337폭에서 창 아래 12vh 에 띄워 게임 화면 밖 흰 바탕에 뜨고
    //   '전체 화면' 버튼과 겹쳤다. PC 는 게임이 9:16 기둥이라 창 아래 ≠ 게임 아래). 캔버스 아래끝에서 높이 12% 위, 폭은 캔버스의 64%(최대 260). 창 크기가 바뀌면 다시
    ui.progPlace = function () {
      var el = ui.progEl; if (!el || el.parentNode !== document.body) return;
      if (!ui.progResize) { ui.progResize = true; window.addEventListener("resize", function () { ui.progPlace(); }); }
      var cv = document.getElementById("unity-canvas"), r = cv ? cv.getBoundingClientRect() : null;
      if (!r || r.width < 10 || r.height < 10) { el.style.left = "50%"; el.style.bottom = "max(12vh,env(safe-area-inset-bottom))"; el.firstChild.style.width = "min(64vw,260px)"; return; }
      var vh = document.documentElement.clientHeight || window.innerHeight;
      el.style.left = Math.round(r.left + r.width / 2) + "px";
      el.style.bottom = "max(" + Math.max(0, Math.round(vh - r.bottom + r.height * 0.12)) + "px,env(safe-area-inset-bottom))";
      el.firstChild.style.width = Math.round(Math.min(r.width * 0.64, 260)) + "px";
    };
    ui.ready = function () { ui.progress(-1); window.__roInWorld = 1; if (window.RoOnboardingFx) window.RoOnboardingFx.stop(); ui.cancel(); if (ui.root) ui.root.remove(); ui.root = ui.top = null; var dock = document.getElementById("ro-install-dock"); if (dock) dock.remove(); };
    window.__roEntryUI = ui;
    return ui;
  },
  RoRaceBackdropReady__deps: ["$RoEntryUI"],
  RoRaceBackdropReady: function (ready) { RoEntryUI().setRacePreview(Number(ready) !== 0); },
  // 월드·존 묶음 받는 진행률(게임 → 로딩 화면) — p 0~1, 음수면 숨김. 글 = "맵 받는 중" 같은 짧은 말(빈 값이면 %만)
  // 게임 기기 번호(NetSession.DeviceId)를 카드 쪽에 알림 — 얼굴·목소리 생성 요청 머리글 X-RO-Device 에 쓴다. 다음 방문 때 엔진보다 먼저 뜨는 카드도 쓰게 남겨 둔다
  RoDeviceSet: function (idPtr) {
    var d = UTF8ToString(idPtr);
    if (!/^[0-9a-f]{32}$/.test(d)) return;
    window.__roDevice = d; try { localStorage.setItem("ro_device_id", d); } catch (_) {}
  },
  RoLoadProgress__deps: ["$RoEntryUI"],
  RoLoadProgress: function (p, labelPtr) { RoEntryUI().progress(p, labelPtr ? UTF8ToString(labelPtr) : ""); },
  RoEntryReady__deps: ["$RoEntryUI"],
  // 유령 프롤로그 웹 훅(2026-11-26 사용자 "계정보다 플레이 먼저 해 보게", .claude/plan_ghost_intro.md) — 첫 방문인지는 index(ro-pre-load)가 한 번 정해
  //   window.__roGhost 에 두고(저장된 이름·로그인 유지 열쇠·ro_ghost_done 이 모두 없음, 주소 ?ghost=1 강제 / ?ghost=0 끔), C# 는 같은 답을 읽기만 한다(두 쪽 판단이 엇갈리지 않게).
  //   C# 순서: 부트 뒤 RoGhostIntroWanted() == 1 이면 로그인 카드 대신 혼자 장면 → 장면이 그려지면 RoGhostIntroReady() → 천사·화이트아웃 끝에 RoGhostIntroDone() = 생성 흐름(종족 선택부터).
  RoGhostIntroWanted: function () { return window.__roGhost ? 1 : 0; },
  RoGhostIntroReady__deps: ["$RoEntryUI"],
  RoGhostIntroReady: function () {   // 혼자 장면이 그려지기 시작 — 먼저 띄운 로딩 화면·위쪽 띠를 걷는다(유니티 화면을 가리지 않게)
    var pre = window.__roPre; if (pre) pre.ghostBusy = 0;
    var bar = document.getElementById("ro-pre-bar"); if (bar) bar.remove();
    var u = RoEntryUI(); u.hideBusy();
    if (u.root && !document.getElementById("ro-name-card")) { u.root.remove(); u.root = u.top = null; }
  },
  RoGhostIntroDone__deps: ["$RoNewFlow", "$RoEntryUI"],
  RoGhostIntroDone: function () {   // 화이트아웃 뒤 — 이 기기는 프롤로그를 봤다고 남기고(다음엔 로그인 카드), 하얀 화면에서 어두워지며 종족 선택부터 지금 생성 흐름 그대로
    try { localStorage.setItem("ro_ghost_done", "1"); } catch (_) {}
    window.__roGhost = 0;
    RoNewFlow("");
    var root = RoEntryUI().root;
    if (root) { root.style.transition = "none"; root.style.background = "#fff"; void root.offsetWidth; root.style.transition = "background 1.2s ease"; root.style.background = "#100d0a"; setTimeout(function () { root.style.transition = ""; }, 1300); }
  },
  RoEntryReady: function () {
    // 월드에 들어온 계정 이름을 로그인 카드 이름 칸용(ro_login_name)으로 남긴다(QA 새 유저 v153 "로그아웃 뒤 이름 칸에 예전 이름") —
    //   로그인 카드만 저장해서 새 계정 만들기·로그인 유지 자동 접속으로 들어오면 옛 이름이 남았다. 이름 = 이번에 보낸 이름(__roSttAuth, 로그인 카드·새로 시작) 또는 유지 열쇠의 이름(ro_login_keep "이름\n열쇠")
    try {
      var au = window.__roSttAuth, n = au && au.n ? String(au.n) : "";
      if (!n) { var kp = (localStorage.getItem("ro_login_keep") || "").split("\n"); if (kp.length === 2 && kp[0]) n = kp[0]; }
      n = n.trim(); if (n) localStorage.setItem("ro_login_name", n);
    } catch (_) {}
    RoEntryUI().ready();
  },
  // 햄버거 메뉴 '프롤로그 다시 보기'(2026-11-11 사용자) — 새 계정 프롤로그(RoPrologue)를 그대로 다시 튼다. 다시 볼 때만 왼쪽 위 '닫기'(Esc 도), 이미 떠 있으면 무시. race 0 = 인간 · 1 = 오크
  RoPrologueReplay__deps: ["$RoPrologue"],
  RoPrologueReplay: function (race) {
    if (document.getElementById("ro-prologue")) return;
    var stop = null, btn = null, onKey = null;
    var cleanup = function () { if (btn) { btn.remove(); btn = null; } if (onKey) { window.removeEventListener("keydown", onKey, true); onKey = null; } };
    stop = RoPrologue(Number(race) === 1 ? 1 : 0, function () { stop = null; cleanup(); });
    btn = document.createElement("button"); btn.type = "button"; btn.textContent = "닫기 ✕";
    btn.style.cssText = "position:fixed;top:max(14px,env(safe-area-inset-top));left:14px;z-index:10002;font-family:'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:14px;font-weight:800;padding:7px 14px;border:2px solid #C9963F;border-radius:999px;background:#2E2018dd;color:#fff1cd;cursor:pointer";
    var close = function () { if (stop) { var f = stop; stop = null; f(); } cleanup(); };
    btn.onclick = close;
    onKey = function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    window.addEventListener("keydown", onKey, true);
    document.body.appendChild(btn);
  },

  // 줄 서기(2026-11-10 서버 세션 요청, 사용자 "줄을 서 주세요 안내 — 기다리고 다음 차례가 되면 풀리고 나오게", 시안 Concept/ui/rive/queue_wait/)
  //   /face/start·/voice/start 가 202 {queued, pos, wait, ticket} 면 3초마다 GET /<kind>/queue?ticket 으로 묻는다(15초 안 물으면 서버가 자리를 버린다 —
  //   탭이 다시 보이면 바로 묻는다). promise = {job, expect}(내 차례·작업 시작) | {gone:true}(자리 사라짐 404·400) | {cancelled:true}.
  //   cancel() = 줄에서 빠진다(POST /<kind>/queue/cancel). pos 1 = 바로 다음 차례.
  $RoQueueWait: function (base, kind, first, onUpdate) {
    var ticket = first.ticket, done = false, timer = null, ac = null, finish = null;
    var onVis = function () { if (document.visibilityState === "visible" && !done) ask(); };
    var promise = new Promise(function (res) {
      finish = function (v) {
        if (done) return;
        done = true; clearTimeout(timer); timer = null;
        if (ac) { var a = ac; ac = null; a.abort(); }
        document.removeEventListener("visibilitychange", onVis);
        res(v);
      };
    });
    var ask = function () {
      if (done) return;
      clearTimeout(timer); timer = null;
      if (ac) ac.abort();
      var my = ac = new AbortController(), t = setTimeout(function () { my.abort(); }, 8000);
      fetch(base + "/" + kind + "/queue?ticket=" + encodeURIComponent(ticket), { cache: "no-store", signal: my.signal })
        .then(function (r) {
          clearTimeout(t);
          if (r.status === 404 || r.status === 400) return { gone: true };
          if (!r.ok) throw new Error("queue " + r.status);
          return r.json();
        }).then(function (j) {
          if (done || my !== ac) return;
          ac = null;
          if (j.gone) { finish({ gone: true }); return; }
          if (j.queued === false) { finish(j.job ? { job: j.job, expect: Number(j.expect) || 0 } : { gone: true }); return; }
          if (onUpdate) onUpdate(Number(j.pos) || 1, Number(j.wait) || 0);
          timer = setTimeout(ask, 3000);
        }).catch(function (e) {
          clearTimeout(t);
          if (done || my !== ac) return;
          ac = null;
          console.warn("[줄 서기] 묻기 실패 — 3초 뒤 다시", e);
          timer = setTimeout(ask, 3000);
        });
    };
    document.addEventListener("visibilitychange", onVis);
    if (onUpdate) onUpdate(Number(first.pos) || 1, Number(first.wait) || 0);
    timer = setTimeout(ask, 3000);
    return {
      promise: promise,
      cancel: function () {
        if (done) return;
        finish({ cancelled: true });
        fetch(base + "/" + kind + "/queue/cancel?ticket=" + encodeURIComponent(ticket), { method: "POST" }).catch(function () {});
      }
    };
  },
  // 줄 서기 화면(시안 queue_wait 를 HTML 로) — 작업실 문 앞 밧줄, 앞사람(최대 3명)과 나(금색 + '나'), 앞사람이 문으로 들어가면 한 칸씩 앞으로.
  //   update(pos, wait) · turn(cb) = 밧줄이 풀리고 문이 번쩍, 내가 들어간 뒤 cb(약 1.7초) · note(글)
  $RoQueueScene: function (kind) {
    if (!document.getElementById("ro-queue-style")) {
      var css = document.createElement("style"); css.id = "ro-queue-style";
      css.textContent =
        ".ro-q{position:relative;height:150px;margin:4px 0 10px;border-radius:14px;overflow:hidden;border:1px solid #6b4a30;background:radial-gradient(ellipse at 70% 100%,#79573555,transparent 70%),#1d1410}" +
        ".ro-q-ground{position:absolute;left:0;right:0;bottom:22px;height:2px;background:#6b4a30}" +
        ".ro-q-door{position:absolute;right:5%;bottom:22px;height:90px;width:auto;animation:roQGlow 1.4s ease-in-out infinite alternate}" +
        ".ro-q-door.ro-q-flash{animation:roQFlash .9s ease-out forwards}" +
        "@keyframes roQGlow{from{filter:drop-shadow(0 0 4px #f2c25533)}to{filter:drop-shadow(0 0 14px #f2c255cc)}}" +
        "@keyframes roQFlash{0%{filter:brightness(2.2) drop-shadow(0 0 26px #fff3c4)}100%{filter:brightness(1.15) drop-shadow(0 0 16px #f2c255cc)}}" +
        ".ro-q-label{position:absolute;right:calc(5% - 12px);width:86px;bottom:3px;text-align:center;font-size:11px;color:#ecd2a4}" +
        ".ro-q-post{position:absolute;left:66%;bottom:22px;height:36px;width:auto;margin-left:-5px}" +
        ".ro-q-rope{position:absolute;left:calc(66% + 2px);bottom:47px;width:42px;height:auto;transform-origin:0 50%;transition:transform .5s cubic-bezier(.5,0,.6,1.5),opacity .4s .35s}" +
        ".ro-q-rope.ro-q-down{transform:rotate(80deg);opacity:0}" +
        ".ro-q-fig{position:absolute;bottom:22px;width:40px;margin-left:-20px;transition:left .9s ease-in-out,opacity .45s}" +
        ".ro-q-fig img{display:block;height:56px;width:auto;margin:0 auto;animation:roQBob .38s ease-in-out infinite alternate}" +
        ".ro-q-me img{height:58px;filter:drop-shadow(0 0 5px #f2c25599)}" +
        ".ro-q-me::before{content:'나';position:absolute;top:-21px;left:50%;transform:translateX(-50%);padding:1px 7px;border-radius:8px;background:#f2c255;color:#2E2018;font-size:11px;font-weight:800;animation:roQTag 1s ease-in-out infinite alternate}" +
        "@keyframes roQBob{from{transform:translateY(0)}to{transform:translateY(-3px)}}" +
        "@keyframes roQTag{from{margin-top:0}to{margin-top:-4px}}" +
        ".ro-q-more{position:absolute;left:5%;bottom:40px;font-size:12px;font-weight:800;color:#ecd2a4}" +
        ".ro-q-pop{position:absolute;left:0;right:0;top:14px;text-align:center;font-size:26px;font-weight:900;color:#FFD966;text-shadow:0 2px 0 #2E2018,0 0 14px #f2c255aa;animation:roPop .3s cubic-bezier(.3,1.6,.45,1)}" +
        ".ro-q-line{text-align:center;font-size:18px;font-weight:800;color:#f3e3c3}" +
        ".ro-q-hi{color:#FFD966;font-weight:900}" +
        ".ro-q-sub{text-align:center;font-size:13px;color:#ecd2a4;margin-top:4px}" +
        ".ro-q-note{text-align:center;font-size:12px;color:#FFD966;margin-top:6px;min-height:0}";
      document.head.appendChild(css);
    }
    var SLOTS = [57, 45, 33, 21], DOOR = "calc(95% - 32px)", IMG = "TemplateData/ro-onboarding/queue/";   // 그림 = GPT 2.6(Assets/_RO/Net/WebUI/queue, WebGLNoUnityLogo 가 복사)
    var el = document.createElement("div");
    var stage = document.createElement("div"); stage.className = "ro-q"; stage.setAttribute("aria-hidden", "true");
    stage.innerHTML = "<div class='ro-q-ground'></div><img class='ro-q-door' alt='' src='" + IMG + "door.png'><div class='ro-q-label'>" + (kind === "voice" ? "녹음 작업실" : "사진 작업실") +
      "</div><img class='ro-q-post' alt='' src='" + IMG + "post.png'><img class='ro-q-rope' alt='' src='" + IMG + "rope.png'><div class='ro-q-more'></div>";
    var door = stage.querySelector(".ro-q-door"), rope = stage.querySelector(".ro-q-rope"), more = stage.querySelector(".ro-q-more");
    var line1 = document.createElement("div"); line1.className = "ro-q-line"; line1.setAttribute("aria-live", "polite");
    var line2 = document.createElement("div"); line2.className = "ro-q-sub";
    var noteEl = document.createElement("div"); noteEl.className = "ro-q-note";
    el.appendChild(stage); el.appendChild(line1); el.appendChild(line2); el.appendChild(noteEl);
    var others = [], me = null, ahead = -1, turned = false, made = 0;
    var person = function (isMe, slot) {
      var f = document.createElement("div"); f.className = "ro-q-fig" + (isMe ? " ro-q-me" : "");
      f.style.left = SLOTS[slot] + "%";
      f.innerHTML = "<img alt='' src='" + IMG + (isMe ? "person_me" : ["person_a", "person_b", "person_c"][made % 3]) + ".png' style='animation-delay:-" + ((made++ * 0.17) % 0.38).toFixed(2) + "s'>";
      stage.appendChild(f); return f;
    };
    var walkIn = function (f) { f.style.left = DOOR; setTimeout(function () { f.style.opacity = "0"; }, 600); setTimeout(function () { f.remove(); }, 1200); };
    var fmt = function (w) { return w < 60 ? w + "초" : Math.ceil(w / 60) + "분"; };
    var q = { el: el };
    q.update = function (pos, wait) {
      if (turned) return;
      var n = Math.max(0, (pos | 0) - 1), shown = Math.min(n, 3);
      if (!me) me = person(true, 0);
      var d = ahead >= 0 ? Math.min(Math.max(0, ahead - n), others.length) : 0;
      for (var i = 0; i < d; i++) walkIn(others.shift());
      while (others.length > shown) others.pop().remove();
      while (others.length < shown) {
        var f = person(false, others.length); f.style.opacity = "0"; others.push(f);
        (function (g) { requestAnimationFrame(function () { requestAnimationFrame(function () { g.style.opacity = ""; }); }); })(f);
      }
      others.forEach(function (o, k) { o.style.left = SLOTS[k] + "%"; });
      me.style.left = SLOTS[shown] + "%";
      more.textContent = n > 3 ? "+" + (n - 3) + "명" : "";
      line1.innerHTML = n ? "앞에 <span class='ro-q-hi'>" + n + "명</span>이 기다리고 있어요" : "<span class='ro-q-hi'>곧 내 차례예요!</span>";
      line2.textContent = wait > 0 ? "예상 대기 약 " + fmt(wait) : "곧 시작해요";
      ahead = n;
    };
    q.turn = function (cb) {
      if (turned) return;
      turned = true;
      others.forEach(walkIn); others = [];
      more.textContent = "";
      rope.classList.add("ro-q-down"); door.classList.add("ro-q-flash");
      var pop = document.createElement("div"); pop.className = "ro-q-pop"; pop.textContent = "내 차례예요!"; stage.appendChild(pop);
      line1.textContent = "줄이 풀렸어요"; line2.textContent = "작업실로 들어가는 중…"; noteEl.textContent = "";
      setTimeout(function () { if (me) walkIn(me); }, 650);
      setTimeout(cb, 1700);
    };
    q.note = function (t) { noteEl.textContent = t || ""; };
    return q;
  },

  // 접속 카드 공용 틀 — 로고 + 바랜 금 테두리(깎은 모서리) 카드와 칸·버튼 만들기. RoLoginOpen·RoNewCharOpen 이 같이 쓴다(2026-11-04 계정)
  $RoCard__deps: ["$RoEntryUI"],
  $RoCard: function (total) {
    var entry = RoEntryUI().ensure();
    entry.hideBusy();
    var old = document.getElementById("ro-name-card");
    if (old) old.remove();
    var wrap = document.createElement("div");
    wrap.id = "ro-name-card";
    wrap.style.cssText = "position:relative;display:flex;flex-direction:column;" +
      "align-items:center;justify-content:flex-start;padding-bottom:max(24px,env(safe-area-inset-bottom));box-sizing:border-box;font-family:'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif;";
    var cut = "polygon(22px 0,100% 0,100% calc(100% - 22px),calc(100% - 22px) 100%,0 100%,0 22px)";
    var btnCut = "polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px)";
    var css = document.createElement("style");
    css.textContent = ":root[data-ro-ui-race=orc]{--ro-ui-edge:#a38b7c;--ro-ui-bg:#291b19;--ro-ui-button:#8f3025;}" + ".ro-off .ro-sym{stroke:var(--ro-ui-edge,#C9963F)}.ro-on .ro-sym{stroke:var(--ro-ui-bg,#2E2018)}" +
      "@keyframes roPop{from{transform:scale(.8);opacity:0}to{transform:scale(1);opacity:1}}" +
      "@keyframes roSlide{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}" +
      "@keyframes roShake{0%,100%{transform:none}20%,60%{transform:translateX(-7px)}40%,80%{transform:translateX(7px)}}";
    css.id = "ro-entry-style";
    if (!document.getElementById(css.id)) entry.root.appendChild(css);
    var rim = document.createElement("div");
    rim.style.cssText = "width:min(88vw,440px);padding:2px;background:var(--ro-ui-edge,#C9963F);clip-path:" + cut + ";animation:roPop .22s cubic-bezier(.3,1.5,.45,1);";
    var card = document.createElement("div");
    card.style.cssText = "background:var(--ro-ui-bg,#2E2018);clip-path:" + cut + ";padding:24px 24px 22px;";
    rim.appendChild(card); wrap.appendChild(rim);
    // 카드가 나타나는(roPop .22s)·바뀌는(roSlide .18s) 연출 중엔 누름을 막는다(QA 새 유저 v153 "'다음'을 누르려 했는데 그 자리에 있던 '로그인'이 눌렸다") — 연출 끝 + 여유 뒤 되돌림
    var lockTap = function (el, ms) { el.style.pointerEvents = "none"; clearTimeout(el.__roTapT); el.__roTapT = setTimeout(function () { el.style.pointerEvents = ""; }, ms); };
    lockTap(wrap, 300);
    entry.root.appendChild(wrap);
    entry.fitCard(wrap);
    // Local Rive visuals never gate account, upload, preview or input readiness.
    if (window.RoOnboardingFx) window.RoOnboardingFx.attach(entry.root);
    else if (!window.__roFxLoading) {
      window.__roFxLoading = true;
      var fxScript = document.createElement("script"); fxScript.src = "TemplateData/ro-onboarding/onboarding-fx.js";
      fxScript.onload = function () { if (window.RoOnboardingFx && entry.root && entry.root.isConnected) window.RoOnboardingFx.attach(entry.root); };
      fxScript.onerror = function () { window.__roFxLoading = false; };
      document.head.appendChild(fxScript);
    }


    var c = { wrap: wrap, card: card, rim: rim };
    c.raceShell = function (step, heading, subtitle, total) {
      total = total || 5;
      step = step || 1; heading = heading || "종족 선택"; if (subtitle == null) subtitle = "어느 편에 설지 맹세하세요";   // "" = 부제목 없음
      wrap.classList.add("ro-race-card"); wrap.classList.remove("ro-race-wide");   // 넓은 창(ro-race-wide)은 종족·성별 단계가 다시 붙인다
      if (!document.getElementById("ro-race-shell-style")) {
        var css = document.createElement("style"); css.id = "ro-race-shell-style";
        css.textContent = ".ro-race-card{padding-top:max(18px,env(safe-area-inset-top))}.ro-race-card>div{width:min(90vw,420px,calc(100vw - 24px))!important;box-sizing:border-box;padding:7px!important;border:2px solid #8d4c12;border-radius:30px;clip-path:none!important;background:linear-gradient(135deg,#ffedaa,#eeb340 24%,#a75b12 55%,#f8cb65)!important;box-shadow:0 12px 36px #0009,inset 0 2px 2px #fff7}.ro-race-card>div>div{padding:18px 20px 24px!important;border:3px solid #71401e;border-radius:22px;clip-path:none!important;background:radial-gradient(ellipse at top,#71462c,#352014 80%)!important;color:#fff1cd}.ro-race-card .ro-race-next{border:3px solid #d7891b!important;border-top-color:#fff1a9!important;border-radius:18px!important;clip-path:none!important;background:linear-gradient(#ffe78a,#ffc336 48%,#efa214)!important;color:#452108!important;box-shadow:inset 0 2px #fff8,0 5px 0 #793b0d!important;font-weight:900!important}.ro-race-card .ro-race-next:disabled,:root[data-ro-ui-race=orc] .ro-race-card .ro-race-next:disabled{opacity:.45!important;filter:grayscale(.6)!important;cursor:default}#ro-entry-overlay:has(.ro-race-card)>#ro-entry-top{display:none}@media(orientation:portrait){.ro-race-card.ro-race-wide>div{width:min(calc(100vw - 40px),560px)!important}}.ro-race-card>div>div{min-width:0;overflow-wrap:anywhere}@media(max-width:400px){.ro-race-card>div>div{padding:16px 14px 20px!important}.ro-race-card h1{font-size:26px!important}}";
        entry.root.appendChild(css);
      }
      return "<div style='text-align:center;margin-bottom:16px'>" + (step <= total ? "<div style='color:#f3ca73;font-weight:800;letter-spacing:.12em;font-size:13px'>◆　" + step + " / " + total + "　◆</div>" : "") + "<h1 style='font-size:30px;line-height:1.25;letter-spacing:-.04em;font-weight:900;margin:10px 0 8px;text-shadow:0 3px #3b1c0b;color:#fff1cd'>" + heading + "</h1>" + (subtitle ? "<div style='font-size:14px;color:#f3d5a0;font-weight:700'>" + subtitle + "</div>" : "") + "</div>";
    };
    var themeStyle = document.getElementById("ro-vnext-theme");
    if (!themeStyle) { themeStyle = document.createElement("style"); themeStyle.id = "ro-vnext-theme"; themeStyle.textContent = "\n:root[data-ro-ui-race=orc] .ro-race-card>div{border-color:#342823!important;border-radius:22px!important;background:linear-gradient(135deg,#c7b9a3,#605149 25%,#a6927b 49%,#392e2b 72%,#a38d77)!important;box-shadow:0 12px 36px #000a,inset 0 2px #eee6!important}\n:root[data-ro-ui-race=orc] .ro-race-card>div>div{border-color:#65392d!important;border-radius:15px!important;background:radial-gradient(ellipse at top,#51432c,#281d1a 80%)!important}\n:root[data-ro-ui-race=orc] .ro-race-card .ro-race-next{border-color:#66392b!important;border-top-color:#d3a879!important;background:linear-gradient(#ac5540,#833326 55%,#61261e)!important;color:#fff0c8!important;box-shadow:inset 0 2px #e8ad6a66,0 5px 0 #291c16!important}\n.ro-face-select{padding-top:max(8px,env(safe-area-inset-top))!important}\n.ro-face-select>div{width:min(94vw,440px)!important}\n.ro-face-select>div>div{padding:12px 14px!important}\n.ro-face-select h1{font-size:clamp(18px,5vw,25px);line-height:1.2;margin:0 0 4px;text-align:center;color:#fff1cd}\n.ro-face-section{font-size:12px;color:#f3ca73;text-align:center;font-weight:800;margin:8px 0 5px}\n.ro-face-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}\n.ro-face-select .ro-face-tile{aspect-ratio:1.12!important;border-radius:14px!important;background:linear-gradient(#62412b,#2c1c13)!important}\n.ro-face-select .ro-face-tile[aria-pressed=true]{border-color:#ffe18b!important;box-shadow:0 0 10px #f5bd4d99,inset 0 0 0 1px #fff2b5}\n.ro-face-select .ro-face-tile[aria-pressed=true]:after{content:'\u2713';position:absolute;right:3px;top:3px;border-radius:50%;background:#df9d28;color:#fff9da;width:20px;height:20px;font-size:15px;font-weight:900}\n:root[data-ro-ui-race=orc] .ro-face-select .ro-face-tile{background:linear-gradient(#4c5031,#251e18)!important;border-radius:8px!important}\n:root[data-ro-ui-race=orc] .ro-face-select .ro-face-tile[aria-pressed=true]{border-color:#dba465!important;box-shadow:0 0 10px #bd563a88}\n.ro-face-select #ro-character-preview{width:100%!important;margin-top:10px;padding:7px!important;border-radius:16px!important}\n.ro-face-select .ro-race-next{margin-top:8px!important;padding:10px 0!important;font-size:18px!important}\n@media(max-height:740px){.ro-face-select>div>div{padding:9px 12px!important}.ro-face-section{margin:5px 0 3px}.ro-face-select .ro-face-tile{aspect-ratio:1.35!important}}\n\n@media(max-height:780px){.ro-face-select{padding-bottom:8px!important}.ro-face-select>div>div{padding:8px 12px!important}.ro-face-select .ro-face-tile{aspect-ratio:1.6!important}.ro-face-select #ro-character-preview>div:first-child{height:100px!important;width:66.67px!important}.ro-face-select .ro-head-scale button{height:24px!important}.ro-face-select h1{font-size:19px!important}.ro-face-select .ro-face-section{margin:4px 0 3px!important}.ro-face-select #ro-character-preview{margin-top:6px!important}}\n\n:root[data-ro-ui-race=orc] .ro-race-card>div{position:relative}\n:root[data-ro-ui-race=orc] .ro-race-card>div:before{content:'';position:absolute;inset:-2px;pointer-events:none;border-radius:22px;background:linear-gradient(135deg,#6b2920 0 26px,transparent 27px) top left,linear-gradient(225deg,#6b2920 0 26px,transparent 27px) top right,linear-gradient(45deg,#6b2920 0 26px,transparent 27px) bottom left,linear-gradient(315deg,#6b2920 0 26px,transparent 27px) bottom right;background-size:42px 42px;background-repeat:no-repeat;z-index:2}\n:root[data-ro-ui-race=orc] .ro-race-card input:not([type=range]):not([type=checkbox]){border-color:#a38b7c!important}\n:root[data-ro-ui-race=orc] .ro-race-card input:focus{border-color:#e1aa65!important;box-shadow:0 0 0 2px #ba704b44}\n:root[data-ro-ui-race=orc] .ro-race-card .ro-face-section{color:#e9c495}\n"; entry.root.appendChild(themeStyle); }
    c.head = function (step, title, sub) {
      return "<div style='color:var(--ro-ui-edge,#C9963F);font-size:14px;font-weight:700;letter-spacing:.2em'>WOWnarok ONLINE" + (step ? " · " + step + "/" + total : "") + "</div>" +
        "<div style='color:#EBDDBC;font-size:26px;font-weight:800;margin:6px 0 4px'>" + title + "</div>" +
        "<div style='color:#EBDDBC;opacity:.65;font-size:14px;margin-bottom:16px'>" + sub + "</div>";
    };
    c.mainBtn = function (text) {
      var b = document.createElement("button");
      b.textContent = text;
      b.style.cssText = "margin-top:16px;width:100%;font-size:20px;font-weight:800;padding:13px 0;border:2px solid var(--ro-ui-edge,#C9963F);" +
        "background:var(--ro-ui-button,#9E3B2E);color:#EBDDBC;cursor:pointer;font-family:inherit;clip-path:" + btnCut + ";";
      return b;
    };
    // 버금 버튼(입체 — 밑면 두께·밝은 윗선, 누르면 내려앉음). 'ro-default-face-hot' 이면 금빛으로 숨 쉼
    c.defaultFaceBtn = function (text) {
      if (!document.getElementById("ro-default-face-style")) {
        var st2 = document.createElement("style"); st2.id = "ro-default-face-style";
        st2.textContent = ".ro-default-face{display:block;width:100%;margin:12px 0 0;padding:11px 0;font:inherit;font-size:17px;font-weight:800;color:#2E2018;cursor:pointer;" +
          "border:2px solid #6b4a24;border-radius:10px;background:linear-gradient(#f4dfae,#d9b46a);box-shadow:inset 0 2px #fff6d8,inset 0 -3px #b98a3e,0 5px #5a3c1c,0 7px 10px #0007;transition:transform .08s,box-shadow .08s}" +
          ".ro-default-face:active{transform:translateY(4px);box-shadow:inset 0 2px #fff6d8,inset 0 -3px #b98a3e,0 1px #5a3c1c,0 2px 4px #0007}" +
          ".ro-default-face.ro-default-face-hot{animation:roDefaultHot 1.1s ease-in-out infinite}" +
          "@keyframes roDefaultHot{50%{background:linear-gradient(#fff0c4,#f2c77a);box-shadow:inset 0 2px #fff6d8,inset 0 -3px #b98a3e,0 5px #5a3c1c,0 0 18px #FFD966}}";
        document.head.appendChild(st2);
      }
      var b = document.createElement("button"); b.type = "button"; b.className = "ro-default-face"; b.textContent = text; return b;
    };
    // 2026-11-11 사용자 "성별 선택도 종족 선택과 창 크기 똑같게" — 종족 창 높이(c.raceH, 종족 '다음' 때 잼)보다 짧으면 before 앞에 빈 칸
    c.padTo = function (before) {
      var d = ((c.raceH || 0) - card.offsetHeight) * 0.5;   // 2026-11-11 사용자 "중간 빈 공간이 너무 남는다, 중간값으로" — 모자란 높이의 절반만
      if (d > 1) { var sp = document.createElement("div"); sp.style.height = d + "px"; before.before(sp); }
    };
    c.anim = function () { card.style.animation = "none"; void card.offsetWidth; card.style.animation = "roSlide .18s ease-out"; lockTap(card, 260); };
    c.shake = function () { rim.style.animation = "none"; void rim.offsetWidth; rim.style.animation = "roShake .3s ease-out"; };
    c.backBtn = function (text, fn) {
      var b = document.createElement("button");
      b.textContent = text;
      b.style.cssText = "background:none;border:none;color:var(--ro-ui-edge,#C9963F);font-size:14px;cursor:pointer;font-family:inherit;padding:4px 0";
      b.onclick = fn;
      return b;
    };
    // 아래 '뒤로가기' 버튼(2026-11-16 사용자 "새 모험가·처음으로 글자 삭제하고 하단에 다음 아래 뒤로가기 버튼") — 위쪽 표시 줄·되돌아가기 링크 대신.
    //   '다음'과 같은 폭, 버금 버튼(입체·누르면 내려앉음) 모양에 한 단계 어두운 가죽색. hidden = 높이만 차지(보이지 않음, 카드 높이 맞춤용)
    c.stepBack = function (fn, hidden) {
      c.defaultFaceBtn("");   // 버금 버튼 모양(ro-default-face) 스타일을 먼저 넣는다
      if (!document.getElementById("ro-step-back-style")) {
        var st3 = document.createElement("style"); st3.id = "ro-step-back-style";
        st3.textContent = ".ro-default-face.ro-step-back{margin-top:10px;color:#F3DDB0;border-color:#2b1a0e;background:linear-gradient(#6e4c31,#4a311f);" +
          "box-shadow:inset 0 2px #a8805a66,inset 0 -3px #2e1c10,0 5px #1c110a,0 7px 10px #0007}" +
          ".ro-default-face.ro-step-back:active{transform:translateY(4px);box-shadow:inset 0 2px #a8805a66,inset 0 -3px #2e1c10,0 1px #1c110a,0 2px 4px #0007}" +
          ":root[data-ro-ui-race=orc] .ro-default-face.ro-step-back{border-radius:8px;background:linear-gradient(#5a4a3c,#3a2e26);box-shadow:inset 0 2px #b09a8044,inset 0 -3px #241a14,0 5px #17100c,0 7px 10px #0007}";
        document.head.appendChild(st3);
      }
      var b = document.createElement("button"); b.type = "button"; b.className = "ro-default-face ro-step-back"; b.textContent = "뒤로가기";
      if (hidden) { b.style.visibility = "hidden"; b.tabIndex = -1; b.setAttribute("aria-hidden", "true"); } else b.onclick = fn;
      return b;
    };
    // 지금까지 고른 것 한 줄 + 뒤로 가기
    c.pickedRow = function (html, back) {
      var p = document.createElement("div");
      p.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin:-6px 0 12px;color:#EBDDBC;font-size:15px";
      p.innerHTML = "<span>" + html + "</span>";
      p.appendChild(back);
      return p;
    };
    // 입력칸 — 입력 중 키가 게임 조작(WASD 등)으로 새지 않게 막고, Enter 면 onEnter
    c.input = function (label, onEnter) {
      var l = document.createElement("div");
      l.textContent = label;
      l.style.cssText = "color:var(--ro-ui-edge,#C9963F);font-size:14px;font-weight:700;margin:10px 0 6px";
      var inp = document.createElement("input");
      inp.autocomplete = "off";
      inp.style.cssText = "box-sizing:border-box;width:100%;font-size:20px;font-weight:700;padding:12px 14px;border:2px solid var(--ro-ui-edge,#C9963F);" +
        "border-radius:4px;background:#EBDDBC;color:var(--ro-ui-bg,#2E2018);outline:none;font-family:inherit;";
      inp.onkeydown = function (e) {
        e.stopPropagation();
        if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); onEnter(); }
      };
      inp.onkeyup = function (e) { e.stopPropagation(); };
      inp.onkeypress = function (e) { e.stopPropagation(); };   // 글자 입력도 게임으로 새지 않게(PC 에서 영어·숫자가 막혔다)
      card.appendChild(l); card.appendChild(inp);
      return inp;
    };
    // 성별 칸(2026-11-11 사용자 시안 Concept/ui/gender_select/board_tint.png 의 C안·덧칠 약 — "더미 같고 심심하다", "오크면 오크 남녀 문양, 인간이면 인간스럽게",
    //   "남성은 회색에 푸른 톤, 여성은 붉은 톤에 밝게, 살짝만"). 종족 칸과 같은 결 = 진영 무늬 바탕 + 성별 덧칠(무늬 위·마크 아래) + 빛무리 + 실루엣 문장(GPT 2.6) + 이름·칭호 + 얇은 종족 테두리.
    //   orc = 오크 그림·색(참이면 오크). 그림 TemplateData/ro-onboarding/race/gender_<종족>_<m|f>.webp
    c.genderTiles = function (get, set, orc) {
      var RD = "TemplateData/ro-onboarding/race/", key = orc ? "orc" : "human";
      var title = orc ? ["부족의 전사", "부족의 사냥꾼"] : ["왕국의 검사", "왕국의 수호 기사"];
      var edge = orc ? "#D6603C" : "#E7BE69";
      var tint = ["#6F7C8C", "#C9707A"], halo = ["#A9BCD2", "#F2A3AB"];   // 남 회청 / 여 장밋빛 — 색 섞기 0.4 + 밝힘 0.08
      var FRAME_FIT = { human: "left:-3.4%;top:-.85%;width:103.88%;height:102.21%", orc: "left:-1.19%;top:-1.54%;width:102.15%;height:102.39%" };   // 종족 칸과 같은 테두리 맞춤
      var row = document.createElement("div"), tiles = [];
      row.style.cssText = "display:flex;gap:12px;margin:14px 0 10px";
      var paint = function () {
        var g = get(), any = g === 0 || g === 1;
        tiles.forEach(function (t, idx) {
          var on = g === idx;
          t.setAttribute("aria-pressed", on ? "true" : "false");
          t.style.boxShadow = on ? "0 0 18px " + halo[idx] + "cc,0 6px 18px #0006" : "0 4px 12px #0005";
          t.style.filter = on ? "brightness(1.08)" : any ? "brightness(.55) saturate(.7)" : "none";
          t.style.transform = on ? "scale(1.04)" : any ? "scale(.97)" : "none";
          var chk = t.querySelector(".ro-gender-check");
          chk.style.opacity = on ? "1" : "0"; chk.style.transform = on ? "scale(1)" : "scale(.4)";
          t.querySelector(".ro-gender-halo").style.opacity = on ? ".85" : ".35";
        });
      };
      ["남자", "여자"].forEach(function (name, idx) {
        var t = document.createElement("button"); t.type = "button"; t.className = "ro-gender-tile";
        t.style.cssText = "position:relative;flex:1;min-width:0;aspect-ratio:5/6;max-height:42vh;padding:0;border:0;border-radius:12px;overflow:hidden;color:#F6E6C5;cursor:pointer;font-family:inherit;" +
          "background:#000 url(" + RD + "pattern_" + key + ".webp) center/128px repeat;transition:box-shadow .15s,filter .18s,transform .18s";
        t.innerHTML =
          "<span aria-hidden='true' style='position:absolute;inset:0;background:linear-gradient(180deg,transparent 55%,#0E0905e6 84%)'></span>" +
          "<span aria-hidden='true' style='position:absolute;inset:0;background:" + tint[idx] + ";mix-blend-mode:color;opacity:.4'></span>" +
          "<span aria-hidden='true' style='position:absolute;inset:0;background:" + tint[idx] + ";mix-blend-mode:screen;opacity:.08'></span>" +
          "<span class='ro-gender-halo' aria-hidden='true' style='position:absolute;left:50%;top:38%;width:84%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle," + halo[idx] + " 0,transparent 66%);transition:opacity .18s'></span>" +
          "<img alt='' draggable='false' style='position:absolute;left:50%;top:38%;width:84%;max-height:62%;object-fit:contain;transform:translate(-50%,-50%);filter:drop-shadow(0 6px 6px #0009)' src='" + RD + "gender_" + key + "_" + (idx ? "f" : "m") + ".webp'>" +
          "<span style='position:absolute;left:0;right:0;bottom:7%;display:flex;flex-direction:column;align-items:center;gap:1px;padding:0 8px'>" +
            "<span style='font-size:clamp(20px,6.2vw,26px);font-weight:900;text-shadow:0 2px 0 #000c,0 0 6px #000a'>" + name + "</span>" +
            "<span style='font-size:clamp(11px,3.3vw,14px);font-weight:800;color:" + edge + ";text-shadow:0 1px 0 #000c'>" + title[idx] + "</span></span>" +
          "<img alt='' draggable='false' aria-hidden='true' style='position:absolute;" + FRAME_FIT[key] + ";pointer-events:none' src='" + RD + "frame_" + key + ".webp'>" +
          "<span class='ro-gender-check' aria-hidden='true' style='position:absolute;right:9%;top:6%;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:" + edge + ";color:#2E2018;font-size:18px;font-weight:900;border:2px solid #2E2018;box-shadow:0 2px 6px #0007;transition:transform .18s,opacity .18s'>✓</span>";
        t.onclick = function () { set(idx); paint(); };
        tiles.push(t); row.appendChild(t);
      });
      paint(); return row;
    };
    // 종족 칸(2026-11-10 사용자 시안 Concept/ui/race_select/board4.jpg — "멋들어진 종족 문양, 주변에 약간의 치장, 진영에 어울리는 심플한 패턴 배경, 테두리도 종족 느낌(과하지 않게)",
    //   "설명은 프롤로그 스토리와 연결되는 웅장한 느낌"). 그림 = GPT 2.6(문양·무늬·테두리), 파일 TemplateData/ro-onboarding/race/(WebGLNoUnityLogo 가 복사).
    //   칸 = 진영 무늬 바탕 + 문양 빛무리 + 장식 문양 + 이름·칭호·한 줄 + 얇은 종족 테두리(위에 덮음). 칸 아래 판 = 고른 종족의 맹세(프롤로그 문장).
    c.raceTiles = function (get, set) {
      var RD = "TemplateData/ro-onboarding/race/";
      var info = [
        { key: "human", name: "인간", title: "빛의 왕국 기사단", desc: "무너진 성문 앞에서 검을 든 이들의 후예", quote: "“단 한 놈의 오크도 용서하지 않으리”", story: "초원 너머 성벽 안, 오래된 평화가 불타던 밤", edge: "#E7BE69", glow: "#F5C96A" },
        { key: "orc", name: "오크", title: "붉은 대지의 부족", desc: "핏빛 달 아래 맹세한 전사의 피", quote: "“성벽이 무너질 때까지 북은 멈추지 않는다”", story: "조상의 토템을 부순 자들에게 피의 대가를", edge: "#D6603C", glow: "#E0703F" }
      ];
      var wrap = document.createElement("div");
      var row = document.createElement("div"), tiles = [];
      row.style.cssText = "display:flex;gap:12px;margin:14px 0 10px";
      var longQ = info.reduce(function (a, d) { return d.quote.length > a.length ? d.quote : a; }, ""), longS = info.reduce(function (a, d) { return (d.story || "").length > a.length ? d.story : a; }, "");
      var oath = document.createElement("div");   // 고른 종족의 맹세 판
      oath.style.cssText = "box-sizing:border-box;min-height:66px;margin:0 0 4px;padding:10px 12px;border:2px solid #6E5A42;border-radius:14px;background:#1A100A;text-align:center;display:flex;flex-direction:column;justify-content:center;gap:4px;transition:border-color .15s,opacity .2s";
      var oathQ = document.createElement("div"), oathS = document.createElement("div");
      oathQ.style.cssText = "font-size:16px;font-weight:900;line-height:1.35;text-shadow:0 2px 0 #0008";
      oathS.style.cssText = "font-size:13px;color:#E1D2B8";
      oath.appendChild(oathQ); oath.appendChild(oathS);
      var paint = function () {
        var any = get() === 0 || get() === 1;
        tiles.forEach(function (tile, idx) {
          var on = get() === idx;
          tile.setAttribute("aria-pressed", on ? "true" : "false");
          // 고른 표시를 강하게(QA B3) — 고른 카드는 밝게·크게·빛무리, 다른 카드는 어둡게
          tile.style.boxShadow = on ? "0 0 18px " + info[idx].glow + "cc,0 6px 18px #0006" : "0 4px 12px #0005";
          tile.style.filter = on ? "brightness(1.08)" : any ? "brightness(.55) saturate(.7)" : "none";
          tile.style.transform = on ? "scale(1.04)" : any ? "scale(.97)" : "none";
          var chk = tile.querySelector(".ro-race-check");
          chk.style.opacity = on ? "1" : "0"; chk.style.transform = on ? "scale(1)" : "scale(.4)";
          tile.querySelector(".ro-race-halo").style.opacity = on ? ".85" : ".35";
        });
        var sel = any ? info[get()] : null;
        oath.style.opacity = sel ? "1" : ".0";
        oath.style.borderColor = sel ? sel.edge : "#6E5A42";
        oathQ.textContent = sel ? sel.quote : longQ; oathQ.style.color = sel ? sel.edge : "#E1D2B8";
        oathS.textContent = sel ? sel.story : longS;   // 고르기 전에도 가장 긴 글을 보이지 않게(투명) 넣어 판 높이를 미리 잡는다 — 고르는 순간 판이 커져 카드 맞춤 배율이 1 로 떨어져 카드가 팍 작아졌다(2026-11-25 사용자 "종족 고르면 팝업 사이즈가 왜 달라지지")
      };
      // 테두리 그림(428×600)의 투명 여백(인간 왼14·위5·오른2·아래8px, 오크 왼5·위9·오른4·아래5px)만큼 키워 불투명 테두리를 칸(뒷판) 가장자리에 맞춘다
      var FRAME_FIT = { human: "left:-3.4%;top:-.85%;width:103.88%;height:102.21%", orc: "left:-1.19%;top:-1.54%;width:102.15%;height:102.39%" };
      info.forEach(function (item, idx) {
        var tile = document.createElement("button"); tile.type = "button"; tile.className = "ro-race-tile";
        tile.style.cssText = "position:relative;flex:1;min-width:0;aspect-ratio:5/7;max-height:46vh;padding:0;border:0;border-radius:12px;overflow:hidden;color:#F6E6C5;cursor:pointer;font-family:inherit;" +
          "background:#000 url(" + RD + "pattern_" + item.key + ".webp) center/128px repeat;transition:box-shadow .15s,filter .18s,transform .18s";
        tile.innerHTML =
          "<span aria-hidden='true' style='position:absolute;inset:0;background:linear-gradient(180deg,transparent 52%,#0E0905e6 82%)'></span>" +
          "<span class='ro-race-halo' aria-hidden='true' style='position:absolute;left:50%;top:31%;width:72%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle," + item.glow + " 0,transparent 66%);transition:opacity .18s'></span>" +
          "<img alt='' draggable='false' style='position:absolute;left:50%;top:31%;width:72%;max-height:44%;object-fit:contain;transform:translate(-50%,-50%);filter:drop-shadow(0 6px 6px #0009)' src='" + RD + "emblem_" + item.key + ".webp'>" +
          "<span style='position:absolute;left:0;right:0;bottom:15%;display:flex;flex-direction:column;align-items:center;gap:2px;padding:0 10px'>" +
            "<span style='font-size:clamp(20px,6.4vw,28px);font-weight:900;text-shadow:0 2px 0 #000c,0 0 6px #000a'>" + item.name + "</span>" +
            "<span style='font-size:clamp(12px,3.5vw,15px);font-weight:800;color:" + item.edge + ";text-shadow:0 1px 0 #000c'>" + item.title + "</span>" +
            "<span style='font-size:clamp(10px,2.7vw,12px);color:#E1D2B8;line-height:1.3;text-shadow:0 1px 0 #000c'>" + item.desc + "</span></span>" +
          "<img alt='' draggable='false' aria-hidden='true' style='position:absolute;" + FRAME_FIT[item.key] + ";pointer-events:none' src='" + RD + "frame_" + item.key + ".webp'>" +
          "<span class='ro-race-check' aria-hidden='true' style='position:absolute;right:9%;top:6%;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:" + item.edge + ";color:#2E2018;font-size:18px;font-weight:900;border:2px solid #2E2018;box-shadow:0 2px 6px #0007;transition:transform .18s,opacity .18s'>✓</span>";
        // 종족 외침(2026-11-11 사용자 "종족 선택할 때도 성우 사운드") — race_voice/<human|orc>.mp3(사운드 세션), 다시 누르면 앞 소리를 끊고 새로.
        //   음량 = 프롤로그 나레이션과 같은 0.7. 파일이 없거나 재생이 막혀도 흐름은 그대로(조용히 넘어감)
        tile.onclick = function () {
          set(idx); paint();
          try {
            var prev = window.__roRaceVoice; if (prev) { prev.pause(); prev.src = ""; }
            var a = new Audio("TemplateData/ro-onboarding/race_voice/" + item.key + ".mp3"); a.volume = 0.7;
            window.__roRaceVoice = a;
            var p = a.play(); if (p && p.catch) p.catch(function () {});
          } catch (_) {}
        };
        tiles.push(tile); row.appendChild(tile);
      });
      wrap.appendChild(row); wrap.appendChild(oath);
      paint(); return wrap;
    };
    // 빨간 오류 줄
    c.errLine = function () {
      var err = document.createElement("div");
      err.style.cssText = "min-height:20px;margin-top:10px;color:#FF8A73;font-size:15px;font-weight:700;text-align:center";
      return err;
    };
    // 이름 + 비밀번호(숫자 4자리) 두 칸 — 로그인 카드·새로 시작이 같이 쓴다. { name, pin, check() = 오류 글(없으면 "") }
    // 비밀번호 숫자 4칸(2026-11-09 사용자 "비번도 4자리면 그냥 4칸으로") — 진짜 입력칸은 투명하게 4칸 위에 덮어 키보드·붙여넣기·자동 채움은 그대로. 돌려주는 함수 = 칸 다시 칠하기
    // 2026-11-23 비밀번호 숫자 8자리(사용자, 시안 C안 '한 칸 입력' — RO_server Concept/server_dash/pin8/mock.html 값 그대로): 긴 칸 하나에 점 len 개(빈 자리는 고리) + 오른쪽 'n/len' + 눈 버튼
    c.pinBoxes = function (inp, height, len) {
      len = len || 8;
      var pinBox = document.createElement("div");
      pinBox.style.cssText = "position:relative;display:grid;grid-template-columns:minmax(0,1fr) 40px;gap:10px;margin:12px 0";   // 맨 오른쪽 = 눈 버튼
      inp.before(pinBox); pinBox.appendChild(inp); inp.classList.add("ro-pin");
      // 2026-11-11 사용자 "비번 화면이 가끔 칸이 아니라 텍스트 입력칸으로 보인다" — 저장된 비번 자동 채움·아이폰 '강력한 암호' 노란 칸이 그림 칸을 덮었다 → 입력칸 자체를 opacity 0 으로(누르기·키보드·붙여넣기·자동 채움은 그대로)
      inp.style.cssText = "position:absolute;inset:0;width:100%;height:100%;box-sizing:border-box;border:0;background:transparent;color:transparent;caret-color:transparent;z-index:2;font-size:28px;outline:none;letter-spacing:0;opacity:0;-webkit-appearance:none;appearance:none";
      var one = document.createElement("span"); one.setAttribute("aria-hidden", "true");
      one.style.cssText = "display:flex;align-items:center;height:" + (height || 58) + "px;border:3px solid #b47a3d;border-radius:14px;background:linear-gradient(#28150d,#472717);box-shadow:inset 0 3px 6px #0008;padding:0 12px 0 14px;min-width:0;pointer-events:none;transition:border-color .12s";
      var dotRow = document.createElement("span"); dotRow.style.cssText = "flex:1;display:flex;align-items:center;justify-content:space-between;padding-right:12px";
      var dots = [];
      for (var i = 0; i < len; i++) { var dot = document.createElement("span"); dotRow.appendChild(dot); dots.push(dot); }
      var cnt = document.createElement("span"); cnt.style.cssText = "flex:none;font-size:14px;font-weight:800;color:#e7c99d;padding-left:10px;border-left:2px solid #b47a3d66";
      one.appendChild(dotRow); one.appendChild(cnt); pinBox.appendChild(one);
      // 눈 버튼(2026-11-19 사용자 "눈 뜨기 버튼으로 누르는 비번을 보이게 하는 옵션도 넣자") — 기본은 가림, 누르면 숫자가 보이고 다시 누르면 가림.
      //   입력칸은 그대로 password(투명)라 칸 안 글자만 바뀐다. pointerdown·mousedown 을 막아 휴대폰 키보드가 닫히지 않게(포커스 유지). 탭을 떠나면(document.hidden)·단계가 바뀌면(paint.hide) 다시 가림
      var shown = false, eye = document.createElement("button"); eye.type = "button";
      eye.style.cssText = "position:relative;z-index:3;align-self:center;width:40px;height:40px;padding:0;border:0;border-radius:50%;background:#fff2d11a;color:#e7c99d;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent";
      var eyeOpen = "<svg width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z'/><circle cx='12' cy='12' r='3'/></svg>";
      var eyeShut = "<svg width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M3 10c2.2 3 5.4 5 9 5s6.8-2 9-5'/><path d='M6.5 13.6 5 16M12 15v3M17.5 13.6 19 16'/></svg>";
      var syncEye = function () { eye.innerHTML = shown ? eyeOpen : eyeShut; eye.setAttribute("aria-pressed", shown ? "true" : "false"); eye.setAttribute("aria-label", shown ? "비밀번호 가리기" : "비밀번호 보기"); eye.style.color = shown ? "#ffdb75" : "#e7c99d"; };
      eye.addEventListener("pointerdown", function (e) { e.preventDefault(); });
      eye.addEventListener("mousedown", function (e) { e.preventDefault(); });
      eye.onclick = function (e) { e.preventDefault(); shown = !shown; syncEye(); paint(); };
      pinBox.appendChild(eye); syncEye();
      var paint = function () {
        var n = inp.value.length;
        one.style.borderColor = document.activeElement === inp ? "#ffdb75" : "#b47a3d";
        dots.forEach(function (dot, i) {
          if (i < n && shown) { dot.textContent = inp.value.charAt(i); dot.style.cssText = "width:13px;height:13px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#fff1cd"; }
          else { dot.textContent = ""; dot.style.cssText = i < n ? "width:13px;height:13px;border-radius:50%;background:#fff1cd" : "width:13px;height:13px;border-radius:50%;box-sizing:border-box;border:2px solid #b47a3d;opacity:.8"; }
        });
        cnt.innerHTML = "<b style='color:#ffdb75'>" + n + "</b>/" + len;
      };
      inp.addEventListener("focus", paint); inp.addEventListener("blur", paint);
      // 자동 채움은 input 이벤트 없이 값이 들어올 때가 있어 값이 바뀌면 칸을 다시 칠한다(숫자만 len 자리로)
      var last = inp.value, watch = setInterval(function () {
        if (!inp.isConnected) { clearInterval(watch); return; }
        if (shown && document.hidden) { shown = false; syncEye(); paint(); }
        if (inp.value !== last) { var v = inp.value.replace(/[^0-9]/g, "").slice(0, len); if (v !== inp.value) inp.value = v; last = inp.value; paint(); }
      }, 300);
      paint();
      paint.hide = function () { shown = false; syncEye(); paint(); };
      return paint;
    };
    c.namePin = function (defName, onDone, err) {
      var f = {};
      // 새 이름은 최대 6자(2026-11-16 사용자 — 만들기 화면과 같게, QA 새 유저 v152) — 로그인 칸은 예전에 만든 긴 이름 계정도 들어오게 12자까지 받는다
      f.name = c.input("이름 (최대 6자)", function () { f.pin.focus(); });
      f.name.type = "text"; f.name.maxLength = 12;
      // 처음 들어와 게임이 임시로 붙인 "모험가123" 은 채우지 않는다 — 흐린 안내 글자만 보이고, 본명을 적도록 유도한다. 지난번에 쓴 이름은 그대로 채움
      f.name.value = (defName && !/^모험가[0-9]+$/.test(defName)) ? defName : "";
      f.name.placeholder = "본명을 적으면 좋아요";
      f.pin = c.input("비밀번호 (숫자 8자리)", onDone);
      f.pin.type = "password"; f.pin.maxLength = 8; f.pin.setAttribute("inputmode", "numeric"); f.pin.setAttribute("pattern", "[0-9]*");
      f.pin.setAttribute("aria-label", "비밀번호 숫자 8자리");
      var paintPin = c.pinBoxes(f.pin, 58); f.pinPaint = paintPin;
      f.pin.oninput = function () { var v = f.pin.value.replace(/[^0-9]/g, "").slice(0, 8); if (v !== f.pin.value) f.pin.value = v; paintPin(); if (err.textContent) err.textContent = ""; };
      f.name.oninput = function () { if (err.textContent) err.textContent = ""; };
      f.check = function () {
        if (!f.name.value.trim().length) { f.name.focus(); return "이름을 적어 주세요"; }
        // 있는 계정은 예전 4자리로도 들어온다(서버가 8자리로 바꾸라고 답함) — 새로 정하는 비번(f.pinNew)은 8자리만
        if (!(f.pinNew ? /^[0-9]{8}$/ : /^([0-9]{4}|[0-9]{8})$/).test(f.pin.value)) { f.pin.focus(); return "비밀번호는 숫자 8자리예요"; }
        return "";
      };
      return f;
    };
    return c;
  },

  // 첫 접속 실패는 안내에서 멈춘다. 재접속/새 판 로드는 사용자 버튼으로만 실행한다.
  RoResourceLoadFailed__deps: ["$RoCard", "$RoEntryUI"],
  RoResourceLoadFailed: function (messagePtr) {
    var entry = RoEntryUI(); entry.cancel(); entry.setRacePreview(false);
    var c = RoCard(0);
    c.card.setAttribute("role", "alert");
    c.card.innerHTML = c.head(0, "리소스를 불러오지 못했습니다", "아래 안내를 따라 주세요");
    var detail = document.createElement("div");
    detail.textContent = UTF8ToString(messagePtr) || "게임 데이터를 준비하지 못했습니다.";
    detail.style.cssText = "font-size:14px;line-height:1.6;color:#EBDDBC;overflow-wrap:anywhere;margin:14px 0";
    c.card.appendChild(detail);
    var retry = c.mainBtn("다시 시도");
    retry.onclick = function () { window.location.reload(); };
    c.card.appendChild(retry);
  },

  RoConnectionUnavailable__deps: ["$RoCard", "$RoEntryUI", "RoReload", "$RoMaintCard"],
  RoConnectionUnavailable: function (messagePtr, updateRequired) {
    if (updateRequired !== 1 && updateRequired !== 2 && updateRequired !== 3) {
      // 서버를 내렸을 때(서버 PC 도 안 닿음 — 갈래 2 는 아래 평범한 카드) — 글자뿐인 카드 대신 포링 점검 카드(2026-11-09 사용자). 다시 접속은 카드 아래 버튼
      var m = RoMaintCard("잠시 후 다시 접속해 주세요", "", true);   // 예고 없이 서버가 꺼짐 = 긴급 점검 그림
      m.c.card.setAttribute("role", "alert");
      m.c.card.setAttribute("data-update-required", "0");
      var again = m.c.mainBtn("다시 접속");
      // 로그인 '로그인하고 입장'과 같은 금빛 입체 버튼
      again.style.cssText = "display:block;position:relative;width:min(80vw,360px);margin:16px auto 0;padding:14px 6px;border:3px solid #d7891b;border-top-color:#fff1a9;border-radius:18px;background:linear-gradient(#ffe78a,#ffc336 48%,#efa214);color:#452108;box-shadow:inset 0 2px #fff8,0 5px 0 #793b0d,0 7px 10px #0004;cursor:pointer;font-family:inherit;font-weight:900;font-size:21px";
      again.onclick = function () {
        if (again.disabled) return;
        again.disabled = true;
        m.c.wrap.remove();
        m.entry.busy("접속 중입니다");
        SendMessage("NetSession", "OnHtmlRetryConnection", "");
      };
      m.c.wrap.appendChild(again);
      return;
    }
    if (updateRequired === 2 || updateRequired === 3) {   // 3 = 다른 곳에서 같은 계정으로 접속해 밀려남(2026-11-20) — 같은 카드, 버튼은 새로고침
      // 내 연결만 끊김 — 점검 카드와 같은 두루마리 그림 카드(2026-11-11 사용자 시안 A '끊어진 밧줄다리', Concept/ui/disconnect/).
      //   그림 disconnect_bg.jpg 는 점검 그림과 같은 2:3·두루마리 배치이지만 아래 둥근 고리 자리 대신 금테 알약 모양 버튼 자리(가로 33.5~65.6%, 세로 78.7~83%)가 있다.
      //   글 칸 = 왼 11.5%·위 40.5%·폭 77%(버튼 자리 위까지). 누르면 카드는 그대로 두고 제목 '다시 잇는 중' + 버튼 자리에 도는 고리·'접속 중입니다'.
      //   다시 실패하면 NetSession 이 이 함수를 또 불러 RoCard 가 옛 카드를 지우고, 붙으면 RoEntryReady 가 화면째 걷는다.
      var d = RoMaintCard(UTF8ToString(messagePtr) || "연결이 끊겼습니다. 다시 접속을 눌러 주세요.", "", false);
      var dc = d.c;
      dc.card.setAttribute("role", "alert");
      dc.card.setAttribute("data-update-required", "0");
      dc.rim.style.backgroundImage = "url('TemplateData/ro-onboarding/disconnect_bg.jpg')";
      if (dc.rim.lastChild && dc.rim.lastChild !== dc.card) dc.rim.removeChild(dc.rim.lastChild);   // 점검 카드의 둥근 로딩 고리(이 그림엔 고리 자리가 없다)
      dc.card.style.left = "11.5%"; dc.card.style.top = "40.5%"; dc.card.style.width = "77%"; dc.card.style.height = "37.2%";
      var title = dc.card.querySelector("h1");
      title.textContent = updateRequired === 3 ? "다른 곳에서 접속했습니다" : "연결이 끊겼습니다"; title.style.color = "#FFD966";
      // 글 칸이 버튼 자리(77.66%) 바로 위까지라 제목 두 줄 + 본문 세 줄이면 버튼이 마지막 줄을 덮었다(QA v0.1.182) — 칸을 버튼 위 2% 에서 끝내고 글을 한 단계 작게·줄 간격 좁게
      dc.card.style.height = "35%"; dc.card.style.overflow = "hidden";
      title.style.fontSize = "clamp(20px,6.4vw,30px)"; title.style.lineHeight = "1.2";
      if (d.message) { d.message.style.fontSize = "clamp(13px,3.9vw,17px)"; d.message.style.lineHeight = "1.45"; }
      var slot = document.createElement("button"); slot.type = "button"; slot.textContent = "다시 접속";
      slot.style.cssText = "position:absolute;left:29%;top:77.66%;width:42%;height:6.4%;box-sizing:border-box;padding:0;margin:0;border:3px solid #d7891b;border-top-color:#fff1a9;border-radius:999px;background:linear-gradient(#ffe78a,#ffc336 48%,#efa214);color:#452108;box-shadow:inset 0 2px #fff8,0 3px 0 #793b0d,0 5px 8px #0006;cursor:pointer;font-family:inherit;font-weight:900;font-size:clamp(19px,6vw,27px);line-height:1;white-space:nowrap;display:flex;align-items:center;justify-content:center";
      slot.onclick = function () {
        if (slot.disabled) return;
        slot.disabled = true;
        if (updateRequired === 3) { _RoReload(); return; }   // 실린 게임을 통째로 비우고 새로 들어간다(아이폰 메모리)
        title.textContent = "다시 잇는 중";
        d.message.textContent = "서버와 다시 이어 보고 있어요.\n잠시만 기다려 주세요";
        slot.innerHTML = "<span aria-hidden='true' style='width:1.1em;height:1.1em;flex:none;margin-right:.5em;box-sizing:border-box;border:3px solid #c9963f33;border-top-color:#F2C77A;border-right-color:#C9963F;border-radius:50%;animation:roEntrySpin 1.1s linear infinite'></span>접속 중입니다";
        slot.style.cursor = "default"; slot.style.border = "2px solid #C9963F88"; slot.style.background = "#0006"; slot.style.color = "#F2C77A"; slot.style.boxShadow = "none"; slot.style.fontSize = "clamp(16px,5vw,22px)";
        SendMessage("NetSession", "OnHtmlRetryConnection", "");
      };
      dc.rim.appendChild(slot);
      return;
    }
    var entry = RoEntryUI().ensure();
    entry.cancel();
    var c = RoCard(0);
    c.card.setAttribute("role", "alert");
    c.card.setAttribute("data-update-required", updateRequired === 1 ? "1" : "0");
    c.card.innerHTML = c.head(0, updateRequired === 2 ? "연결이 끊겼습니다" : "지금은 접속할 수 없습니다", "");   // 2 = 내 연결만 끊김(서버 PC 는 닿음, 2026-11-10)
    var message = document.createElement("div"); message.id = "ro-connection-unavailable";
    message.textContent = UTF8ToString(messagePtr) || "서버 업데이트 중으로 지금은 접속할 수 없습니다. 잠시 후 다시 시도해 주세요";
    message.style.cssText = "color:#EBDDBC;font-size:16px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere";
    c.card.appendChild(message);
    var go = c.mainBtn(updateRequired === 1 ? "새 버전 불러오기" : "다시 접속");
    go.onclick = function () {
      if (go.disabled) return;
      go.disabled = true;
      if (updateRequired === 1) { _RoReload(); return; }
      c.wrap.remove();
      entry.busy("접속 중입니다");
      SendMessage("NetSession", "OnHtmlRetryConnection", "");
    };
    c.card.appendChild(go);
  },

  // 서버 점검 화면(2026-11-07) — NetSession.ShowMaintenance 가 부른다. maintenance.txt(페이지 옆)를 15초마다 다시 읽어
  //   파일이 사라지면(404 등 실패 응답) 새로고침한다. 연결 오류(응답 없음)는 점검이 끝난 것으로 치지 않고 계속 기다린다.
  // 점검 카드(그림 한 장) — 점검 파일이 있을 때(RoMaintenanceOpen)와 서버가 꺼져 접속이 안 될 때(RoConnectionUnavailable) 같이 쓴다.
  //   2026-11-09 사용자 "1번 시안(밤 성문·쉬는 포링 두루마리 카드)에 위 그림만 둘로 — 왼쪽 = 정기 점검, 오른쪽(안전모 포링 수리) = 긴급 점검, 아래는 왼쪽 스타일"
  //   → 정기 = maintenance_bg.jpg(시안 B 그대로), 긴급 = maintenance_bg_urgent.jpg(같은 두루마리 위에 안전모 포링 장면, Concept/ui/maintenance_poring/split).
  //   긴급 = 점검 문구에 '긴급' 이 있거나 서버가 예고 없이 꺼졌을 때(RoConnectionUnavailable). 두 그림 배치가 같아 글 칸·고리 자리도 같다.
  //   로그인 카드만큼 꽉 차게(폭 min(90vw,420px), 2:3). 글은 그림 속 어두운 칸(가로 10.7~88.7%, 세로 38.9~78%)에, 로딩 고리는 아래 둥근 자리(50%, 81.1%)에 겹친다
  $RoMaintCard__deps: ["$RoCard", "$RoEntryUI"],
  $RoMaintCard: function (text, hintText, urgent) {
    var entry = RoEntryUI().ensure();
    entry.cancel(); entry.setRacePreview(false);
    var c = RoCard(0);
    c.wrap.className = "ro-maint-card";
    c.wrap.style.paddingTop = "max(18px,env(safe-area-inset-top))";
    c.rim.style.cssText = "position:relative;width:min(90vw,420px,calc((100vh - 40px) * 2 / 3));aspect-ratio:2/3;padding:0;background:#0E0B09 url('TemplateData/ro-onboarding/" + (urgent ? "maintenance_bg_urgent.jpg" : "maintenance_bg.jpg") + "') center/100% 100% no-repeat;box-shadow:0 14px 40px #000c;border-radius:18px;clip-path:none;animation:roPop .22s ease-out";
    c.card.style.cssText = "position:absolute;left:10.7%;top:38.9%;width:78%;height:39.1%;box-sizing:border-box;padding:4% 6%;background:none;clip-path:none;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:#fff1cd";
    c.card.setAttribute("role", "status"); c.card.setAttribute("aria-live", "polite");
    c.card.innerHTML = "<div style='color:#C9963F;font-size:clamp(11px,3vw,13px);font-weight:700;letter-spacing:.18em'>WOWnarok ONLINE</div>" +
      "<h1 style='font-size:clamp(24px,7vw,32px);line-height:1.2;font-weight:900;letter-spacing:-.04em;margin:6px 0 8px;color:" + (urgent ? "#FF8A6E" : "#FFD966") + ";text-shadow:0 3px #1a0c06'>" + (urgent ? "긴급 점검 중" : "서버 점검 중") + "</h1>";
    var message = document.createElement("div"); message.id = "ro-maintenance-message";
    message.textContent = text || "서버 점검 중입니다";
    message.style.cssText = "color:#F3D5A0;font-size:clamp(14px,4vw,17px);font-weight:700;line-height:1.6;white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere";
    c.card.appendChild(message);
    // 같은 뜻이 두 번 나오지 않게 — 문구에 '자동' 이 없을 때만 덧붙인다
    if (hintText && !/자동/.test(message.textContent)) {
      var hint = document.createElement("div");
      hint.textContent = hintText;
      hint.style.cssText = "color:#EBDDBC;opacity:.7;font-size:clamp(12px,3.4vw,14px);margin-top:10px";
      c.card.appendChild(hint);
    }
    var spin = document.createElement("div"); spin.setAttribute("aria-hidden", "true");
    if (!document.getElementById("ro-entry-spin-style")) {
      var style = document.createElement("style"); style.id = "ro-entry-spin-style";
      style.textContent = "@keyframes roEntrySpin{to{transform:rotate(360deg)}}";
      entry.root.appendChild(style);
    }
    // 그림 아래 둥근 자리(지름 약 6.4%) 안에 돈다
    //   2026-11-10 가운데 맞춤을 transform 대신 음수 margin 으로 — translate 와 회전 애니가 같은 transform 이라
    //   rotate(360deg)(= 단위 행렬)로 보간돼 돌지 않고 옆으로 미끄러졌다. % margin 은 위아래도 부모 폭 기준이라 지름 5.6% 의 반 = 2.8%
    spin.style.cssText = "position:absolute;left:50%;top:81.05%;width:5.6%;aspect-ratio:1;margin:-2.8% 0 0 -2.8%;box-sizing:border-box;border:3px solid #c9963f33;border-top-color:#F2C77A;border-right-color:#C9963F;border-radius:50%;animation:roEntrySpin 1.1s linear infinite";
    var spinWrap = document.createElement("div"); spinWrap.style.cssText = "position:absolute;inset:0;pointer-events:none";
    spinWrap.appendChild(spin); c.rim.appendChild(spinWrap);
    var mstyle = document.createElement("style");
    mstyle.textContent = "#ro-entry-overlay:has(.ro-maint-card)>#ro-entry-top{display:none}";
    c.wrap.appendChild(mstyle);
    return { c: c, message: message, entry: entry };
  },

  // 정문 닫힘 카드(2026-11-11 UI 세션, 사용자 시안 C '빗장 포링', Concept/ui/gate_closed/) — 관리 툴 '문 닫기'로 로그인이 거절되거나 내보내지면
  //   NetSession 이 로그인 카드 대신 부른다. 글은 제목 한 줄만(사용자 "서버가 닫혀 있습니다", 본문 없음 — 그림이 말하게).
  //   그림 gate_closed_bg.jpg 는 점검 그림과 같은 2:3·두루마리 배치, 아래 둥근 고리 자리 대신 알약 버튼 자리(가로 27~72.9%, 세로 78.45~83.05%).
  //   '다시 확인' 을 누르면 같은 자리에 도는 고리·'확인 중' → NetSession.OnHtmlGateRetry(메모리의 이름·PIN 으로 다시 로그인).
  //   여전히 닫혀 있으면 서버가 또 거절해 이 함수가 다시 불리고(RoCard 가 옛 카드를 지운다), 열렸으면 RoEntryReady 가 화면째 걷는다.
  RoGateClosedOpen__deps: ["$RoMaintCard"],
  //   2026-11-14 제목 인자 — 비면 '서버가 닫혀 있습니다', 웹 PC 막기(정문은 휴대폰만)는 NetSession 이 다른 글을 넘긴다.
  RoGateClosedOpen: function (titlePtr) {
    var title = titlePtr ? UTF8ToString(titlePtr) : "";
    var g = RoMaintCard("", "", false), gc = g.c;
    gc.card.setAttribute("role", "alert");
    gc.rim.style.backgroundImage = "url('TemplateData/ro-onboarding/gate_closed_bg.jpg')";
    if (gc.rim.lastChild && gc.rim.lastChild !== gc.card) gc.rim.removeChild(gc.rim.lastChild);   // 점검 카드의 둥근 로딩 고리(이 그림엔 버튼 자리가 있다)
    gc.card.style.height = "38.3%";   // 버튼 자리 위까지
    gc.card.innerHTML = "<h1 style='font-size:clamp(24px,7vw,31px);line-height:1.25;font-weight:900;letter-spacing:-.04em;margin:0;color:#FFD966;text-shadow:0 3px #1a0c06;word-break:keep-all'>서버가 닫혀 있습니다</h1>";
    if (title) { gc.card.firstChild.textContent = title; gc.card.firstChild.style.fontSize = "clamp(20px,5.6vw,26px)"; }   // 긴 글(웹 PC 막기)은 조금 작게
    var slot = document.createElement("button"); slot.type = "button"; slot.textContent = "다시 확인";
    slot.style.cssText = "position:absolute;left:27%;top:78.45%;width:45.9%;height:4.6%;box-sizing:border-box;padding:0;margin:0;border:3px solid #d7891b;border-top-color:#fff1a9;border-radius:999px;background:linear-gradient(#ffe78a,#ffc336 48%,#efa214);color:#452108;box-shadow:inset 0 2px #fff8,0 3px 0 #793b0d,0 5px 8px #0006;cursor:pointer;font-family:inherit;font-weight:900;font-size:clamp(15px,4.6vw,20px);line-height:1;white-space:nowrap;display:flex;align-items:center;justify-content:center";
    slot.onclick = function () {
      if (slot.disabled) return;
      slot.disabled = true;
      slot.innerHTML = "<span aria-hidden='true' style='width:1.1em;height:1.1em;flex:none;margin-right:.5em;box-sizing:border-box;border:3px solid #c9963f33;border-top-color:#F2C77A;border-right-color:#C9963F;border-radius:50%;animation:roEntrySpin 1.1s linear infinite'></span>확인 중";
      slot.style.cursor = "default"; slot.style.border = "2px solid #C9963F88"; slot.style.background = "#0006"; slot.style.color = "#F2C77A"; slot.style.boxShadow = "none"; slot.style.fontSize = "clamp(13px,3.9vw,16px)";
      SendMessage("NetSession", "OnHtmlGateRetry", "");
    };
    gc.rim.appendChild(slot);
  },

  // 정문 PC 막힘 카드(2026-11-14 사용자 시안 B "지금은 휴대폰 전용이에요" — Concept/server_dash/pc_block/mock.png) — 정문 닫힘 카드와 같은 그림·'다시 확인' 자리,
  //   가운데에 이 페이지 주소의 QR(주소가 바뀌어도 그 주소로 — $RoQr)을 그려 휴대폰 카메라로 바로 열게 한다. 관리 툴 '정문 PC 허용'을 켜면 '다시 확인'으로 들어온다.
  RoPcBlockedOpen__deps: ["$RoMaintCard", "$RoQr"],
  RoPcBlockedOpen: function () {
    var g = RoMaintCard("", "", false), gc = g.c;
    gc.card.setAttribute("role", "alert");
    gc.rim.style.backgroundImage = "url('TemplateData/ro-onboarding/gate_closed_bg.jpg')";
    if (gc.rim.lastChild && gc.rim.lastChild !== gc.card) gc.rim.removeChild(gc.rim.lastChild);
    gc.card.style.height = "38.3%";
    // 글·QR 크기를 카드 폭 기준(cqw)으로(QA v0.1.135 "좁은 PC 창에서 제목이 위 그림과, 'PC 접속은…' 줄이 '다시 확인' 버튼과 겹침") —
    //   카드는 창 높이로도 줄어드는데 글은 창 폭(vw)으로만 줄어 넘쳤다. 앞의 clamp 는 cqw 를 모르는 옛 브라우저용
    gc.rim.style.containerType = "inline-size";
    var url = window.location.origin + window.location.pathname;
    gc.card.innerHTML = "<div style='color:#C9963F;font-size:clamp(11px,3vw,13px);font-size:3cqw;font-weight:700;letter-spacing:.18em'>WOWnarok ONLINE</div>" +
      "<h1 style='font-size:clamp(21px,6vw,26px);font-size:5.6cqw;line-height:1.25;font-weight:900;letter-spacing:-.04em;margin:1.4cqw 0 1.9cqw;white-space:nowrap;color:#FFD966;text-shadow:0 3px #1a0c06;word-break:keep-all'>지금은 휴대폰 전용이에요</h1>";
    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:12px;gap:2.9cqw;align-items:center;justify-content:center;margin-top:1cqw";
    var m = RoQr(url);
    if (m) {
      var n = m.length, q = 2, sc = 4, cv = document.createElement("canvas");
      cv.width = cv.height = (n + q * 2) * sc;
      var x = cv.getContext("2d"); x.fillStyle = "#F3E6C8"; x.fillRect(0, 0, cv.width, cv.height); x.fillStyle = "#2E2018";
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (m[r][c]) x.fillRect((c + q) * sc, (r + q) * sc, sc, sc);
      cv.setAttribute("aria-label", "휴대폰으로 열 주소 QR");
      cv.style.cssText = "width:clamp(78px,23vw,98px);width:23cqw;height:auto;image-rendering:pixelated;border-radius:8px;border:3px solid #C9963F;background:#F3E6C8;flex:none";
      row.appendChild(cv);
    }
    var side = document.createElement("div");
    side.style.cssText = "text-align:left;color:#F3D5A0;font-size:clamp(12px,3.4vw,13.5px);font-size:3.2cqw;font-weight:700;line-height:1.5;word-break:keep-all";
    side.innerHTML = "휴대폰 카메라로<br>찍으면 바로 열려요<br><span style='color:#FFD966'></span>";
    side.lastChild.textContent = window.location.host + (window.location.pathname.length > 1 ? window.location.pathname.replace(/\/$/, "") : "");
    row.appendChild(side);
    gc.card.appendChild(row);
    var note = document.createElement("div");
    note.textContent = "PC 접속은 운영자가 열 때만 됩니다";
    note.style.cssText = "color:#EBDDBC;opacity:.75;font-size:clamp(11px,3.2vw,13px);font-size:3.1cqw;margin-top:1.9cqw";
    gc.card.appendChild(note);
    var slot = document.createElement("button"); slot.type = "button"; slot.textContent = "다시 확인";
    slot.style.cssText = "position:absolute;left:27%;top:78.45%;width:45.9%;height:4.6%;box-sizing:border-box;padding:0;margin:0;border:3px solid #d7891b;border-top-color:#fff1a9;border-radius:999px;background:linear-gradient(#ffd966,#e9a330);color:#3a2212;font-family:inherit;font-weight:900;font-size:clamp(13px,3.9vw,16px);font-size:3.8cqw;cursor:pointer;display:flex;align-items:center;justify-content:center";
    slot.onclick = function () {
      if (slot.disabled) return;
      slot.disabled = true; slot.textContent = "확인 중…"; slot.style.opacity = "0.7"; slot.style.cursor = "default";
      SendMessage("NetSession", "OnHtmlGateRetry", "");
    };
    gc.rim.appendChild(slot);
  },

  // 짧은 주소용 QR(바이트 모드·오류 정정 M·판 1~6) — 2차원 배열(1 = 어두운 칸), 너무 길면 null. 파이썬 qrcode 와 같은 칸이 나오는지 32가지로 맞춰 봄(2026-11-14)
  $RoQr: function (text, forceMask) {
    var bytes = unescape(encodeURIComponent(text)).split("").map(function (c) { return c.charCodeAt(0); });
    // [전체 코드워드, 블록당 ECC, 블록 수] — 오류 정정 M
    var T = [null, [26, 10, 1], [44, 16, 1], [70, 26, 1], [100, 18, 2], [134, 24, 2], [172, 16, 4]];
    var ver = 0;
    for (var v = 1; v <= 6; v++) { var dc = T[v][0] - T[v][1] * T[v][2]; if (4 + 8 + bytes.length * 8 <= dc * 8) { ver = v; break; } }
    if (!ver) return null;
    var total = T[ver][0], eccLen = T[ver][1], nb = T[ver][2], dataLen = total - eccLen * nb;
    // 비트 줄
    var bits = [];
    var put = function (val, n) { for (var i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    put(4, 4); put(bytes.length, 8); bytes.forEach(function (b) { put(b, 8); });
    for (var i = 0; i < 4 && bits.length < dataLen * 8; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    var data = [];
    for (i = 0; i < bits.length; i += 8) { var x = 0; for (var j = 0; j < 8; j++) x = (x << 1) | bits[i + j]; data.push(x); }
    for (var pad = 0; data.length < dataLen; pad++) data.push(pad % 2 ? 0x11 : 0xEC);
    // GF(256) 리드-솔로몬
    var EXP = [], LOG = [];
    for (i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
    var mul = function (a, b) { return a && b ? EXP[(LOG[a] + LOG[b]) % 255] : 0; };
    var gen = [1];
    for (i = 0; i < eccLen; i++) {
      var ng = []; for (j = 0; j <= gen.length; j++) ng.push(0);
      for (j = 0; j < gen.length; j++) { ng[j] ^= gen[j]; ng[j + 1] ^= mul(gen[j], EXP[i]); }
      gen = ng;
    }
    var bl = dataLen / nb, blocks = [], eccs = [];
    for (var b = 0; b < nb; b++) {
      var d = data.slice(b * bl, (b + 1) * bl), r = d.concat(new Array(eccLen).fill(0));
      for (i = 0; i < d.length; i++) { var f = r[i]; if (f) for (j = 0; j < gen.length; j++) r[i + j] ^= mul(gen[j], f); }
      blocks.push(d); eccs.push(r.slice(d.length));
    }
    var cw = [];
    for (i = 0; i < bl; i++) for (b = 0; b < nb; b++) cw.push(blocks[b][i]);
    for (i = 0; i < eccLen; i++) for (b = 0; b < nb; b++) cw.push(eccs[b][i]);
    // 판
    var n = ver * 4 + 17, m = [], fixed = [];
    for (i = 0; i < n; i++) { m.push(new Array(n).fill(0)); fixed.push(new Array(n).fill(false)); }
    var set = function (r, c, v) { m[r][c] = v; fixed[r][c] = true; };
    var finder = function (r0, c0) {
      for (var r = -1; r <= 7; r++) for (var c = -1; c <= 7; c++) {
        var rr = r0 + r, cc = c0 + c; if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
        var on = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        set(rr, cc, on ? 1 : 0);
      }
    };
    finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
    for (i = 8; i < n - 8; i++) { set(6, i, i % 2 ? 0 : 1); set(i, 6, i % 2 ? 0 : 1); }
    if (ver >= 2) {
      var a = 4 * ver + 10;   // 판 2~6 맞춤 무늬 = (a, a) 하나
      for (var r = -2; r <= 2; r++) for (var c = -2; c <= 2; c++) set(a + r, a + c, Math.max(Math.abs(r), Math.abs(c)) === 1 ? 0 : 1);
    }
    set(4 * ver + 9, 8, 1);   // 어두운 칸
    var fmtCells = function (cb) {   // 형식 정보 15칸(두 벌)
      for (var i2 = 0; i2 < 15; i2++) {
        cb(i2 < 6 ? i2 : i2 < 8 ? i2 + 1 : n - 15 + i2, 8, i2);   // 세로
        cb(8, i2 < 8 ? n - 1 - i2 : i2 === 8 ? 7 : 14 - i2, i2);   // 가로
      }
    };
    fmtCells(function (r, c) { fixed[r][c] = true; });
    // 자료 놓기(오른쪽 아래부터 지그재그, 6번 열 건너뜀)
    var pos = [];
    for (var col = n - 1, up = true; col > 0; col -= 2, up = !up) {
      if (col === 6) col--;
      for (var k = 0; k < n; k++) {
        var row = up ? n - 1 - k : k;
        for (var t = 0; t < 2; t++) if (!fixed[row][col - t]) pos.push([row, col - t]);
      }
    }
    var dbits = [];
    cw.forEach(function (w) { for (var q = 7; q >= 0; q--) dbits.push((w >> q) & 1); });
    var MASK = [
      function (r, c) { return (r + c) % 2 === 0; }, function (r) { return r % 2 === 0; }, function (r, c) { return c % 3 === 0; },
      function (r, c) { return (r + c) % 3 === 0; }, function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
      function (r, c) { return (r * c) % 2 + (r * c) % 3 === 0; }, function (r, c) { return ((r * c) % 2 + (r * c) % 3) % 2 === 0; },
      function (r, c) { return ((r + c) % 2 + (r * c) % 3) % 2 === 0; }];
    var build = function (mask) {
      var g = m.map(function (row) { return row.slice(); });
      pos.forEach(function (p, idx) { var bit = idx < dbits.length ? dbits[idx] : 0; g[p[0]][p[1]] = bit ^ (MASK[mask](p[0], p[1]) ? 1 : 0); });
      var fmt = (0 << 3) | mask, rem = fmt << 10;   // M = 00
      for (var q = 14; q >= 10; q--) if (rem & (1 << q)) rem ^= 0x537 << (q - 10);
      var fbits = ((fmt << 10) | rem) ^ 0x5412;
      fmtCells(function (r, c, idx) { g[r][c] = (fbits >> idx) & 1; });
      return g;
    };
    var penalty = function (g) {
      var s = 0, dark = 0, r, c, run, k2;
      for (var pass = 0; pass < 2; pass++) for (r = 0; r < n; r++) {
        run = 1;
        for (c = 1; c <= n; c++) {
          var cur = c < n ? (pass ? g[c][r] : g[r][c]) : -1, prev = pass ? g[c - 1][r] : g[r][c - 1];
          if (cur === prev) run++; else { if (run >= 5) s += run - 2; run = 1; }
        }
      }
      for (r = 0; r < n - 1; r++) for (c = 0; c < n - 1; c++) { k2 = g[r][c]; if (k2 === g[r + 1][c] && k2 === g[r][c + 1] && k2 === g[r + 1][c + 1]) s += 3; }
      var pat = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
      for (r = 0; r < n; r++) for (c = 0; c <= n - 11; c++) {
        var h1 = true, h2 = true, v1 = true, v2 = true;
        for (k2 = 0; k2 < 11; k2++) { if (g[r][c + k2] !== pat[k2]) h1 = false; if (g[r][c + k2] !== pat2[k2]) h2 = false; if (g[c + k2][r] !== pat[k2]) v1 = false; if (g[c + k2][r] !== pat2[k2]) v2 = false; }
        s += 40 * (h1 + h2 + v1 + v2);
      }
      for (r = 0; r < n; r++) for (c = 0; c < n; c++) dark += g[r][c];
      s += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
      return s;
    };
    if (forceMask != null) return build(forceMask);
    var best = null, bestS = 1e9;
    for (var mk = 0; mk < 8; mk++) { var g2 = build(mk), sc = penalty(g2); if (sc < bestS) { bestS = sc; best = g2; } }
    return best;
  },

  // 터치 되는 기기인가(2026-11-14 정문은 휴대폰만) — 1 이면 휴대폰으로 친다(아이패드가 PC 로 알려 와도). NetSession.IsWebPc
  RoTouchDevice: function () {
    return (navigator.maxTouchPoints > 0 || "ontouchstart" in window) ? 1 : 0;
  },

  RoMaintenanceOpen__deps: ["$RoMaintCard"],
  RoMaintenanceOpen: function (messagePtr) {
    var text = UTF8ToString(messagePtr);
    var m = RoMaintCard(text, "점검이 끝나면 자동으로 열립니다", /긴급/.test(text)), message = m.message;
    if (window.__roMaintTimer) clearInterval(window.__roMaintTimer);
    var base = window.location.href.split("#")[0].split("?")[0];
    base = base.substring(0, base.lastIndexOf("/") + 1);
    var page = function () {
      fetch(base + "maintenance.txt?t=" + Date.now(), { cache: "no-store" }).then(function (r) {
        if (!r.ok) { clearInterval(window.__roMaintTimer); window.location.reload(); return null; }
        return r.text();
      }).then(function (t) {
        if (t == null) return;
        t = String(t).trim();
        if (t.charAt(0) === "<") { clearInterval(window.__roMaintTimer); window.location.reload(); return; }
        message.textContent = t.slice(0, 300) || "서버 점검 중입니다";
      }).catch(function () {});
    };
    // 서버 PC 입구(2026-11-10 C 혼합) 먼저 — 200 = 점검 중(문구), 404 = 점검 끝(새로고침), 그 밖(실패·6초 초과·다른 코드·HTML)은 페이지 옆 사본.
    //   뒷문(/p/<열쇠>/) 페이지는 예전처럼 페이지 옆만 본다.
    var gated = /\/p\/[A-Za-z0-9]{12,32}(\/|$)/.test(window.location.pathname);
    var check = function () {
      if (gated) { page(); return; }
      var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { ctl.abort(); }, 6000) : 0;
      fetch("https://cdn.wownarok.com/entry/maintenance.txt?t=" + Date.now(), ctl ? { cache: "no-store", signal: ctl.signal } : { cache: "no-store" }).then(function (r) {
        if (r.status === 404) { clearTimeout(timer); clearInterval(window.__roMaintTimer); window.location.reload(); return null; }
        if (r.status !== 200) throw new Error("entry " + r.status);
        return r.text();
      }).then(function (t) {
        clearTimeout(timer);
        if (t == null) return;
        t = String(t).trim();
        if (t.charAt(0) === "<") { page(); return; }
        message.textContent = t.slice(0, 300) || "서버 점검 중입니다";
      }).catch(function () { clearTimeout(timer); page(); });
    };
    window.__roMaintTimer = setInterval(check, 15000);
  },

  // 저절로 새로고침(판이 바뀜) — 방금(20초 안) 저절로 새로고침했으면 하지 않고 0. 깃허브 반영이 늦어 옛 판이 다시 와도 되풀이되지 않게
  RoAutoReload: function () {
    var now = Date.now(), last = 0;
    try { last = Number(sessionStorage.getItem("ro_auto_reload_at") || 0); } catch (_) {}
    if (now - last < 20000) return 0;
    try { sessionStorage.setItem("ro_auto_reload_at", String(now)); } catch (_) {}
    var u = location.href.replace(/([?&])r=\d+&?/, "$1").replace(/[?&]$/, ""); location.replace(u + (u.indexOf("?") >= 0 ? "&" : "?") + "r=" + now);   // 새 값으로 index.html 까지 새로
    return 1;
  },

  // 탭이 다시 보일 때 뒤에 있던 시간(ms)을 NetSession.OnHtmlVisible 로 — 브라우저가 뒤 탭의 게임을 멈춰 서버가 15초 뒤 끊는다(2026-11-10)
  RoWatchVisibility: function () {
    if (window.__roVisWatch) return;
    window.__roVisWatch = true;
    var hiddenAt = 0;
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (!hiddenAt) return;
      var ms = Date.now() - hiddenAt; hiddenAt = 0;
      try { SendMessage("NetSession", "OnHtmlVisible", String(ms)); } catch (e) {}
    });
  },

  // 로그인 카드(2026-11-04 사용자 "계정 — 아이디는 이름, 비번 숫자 4자리") — 이름 + 비밀번호(숫자 4자리) → '모험 시작'.
  //   message 가 있으면 빨간 글(서버가 거절한 까닭: "비밀번호가 틀렸습니다" 등)과 함께 카드가 흔들린다.
  //   보내기 = NetSession.OnHtmlLogin("이름\n비번"). 없는 이름이면 서버가 새 캐릭터로 보고 RoNewCharOpen 을 띄운다.
  //   '새로 시작'(2026-11-04 사용자 — 사진으로 커스텀 얼굴) = RoNewFlow(사진 → 이름·비번 → 성별 → 종족 → 얼굴 고르기, 모두 이 jslib 안에서)
  //   미리보기 = Concept/ui/name_card/login_preview.html (이 파일을 그대로 읽는다)
  // 홈 화면 앱 추가(2026-11-09 사용자 "모바일에서 바탕화면에 앱 추가 버튼, 누르면 홈 화면에 생성되게") — 로그인 카드 아래 작은 보조 버튼.
  //   이미 앱으로 열었거나(display-mode standalone·fullscreen, iOS navigator.standalone) PC(마우스)면 만들지 않는다.
  //   안드로이드 크롬 = index.html 이 미리 잡아 둔 beforeinstallprompt(window.__roInstallPrompt)로 설치 창. 그 이벤트가 없는 브라우저(아이폰 사파리 등) = 안내 카드.
  $RoAppInstall: function (card) {
    var w = window, ua = navigator.userAgent || "";
    var ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    var mobile = ios || /Android/i.test(ua);
    var installed = function () {
      try { return w.matchMedia("(display-mode: standalone)").matches || w.matchMedia("(display-mode: fullscreen)").matches || navigator.standalone === true; } catch (_) { return false; }
    };
    if (!mobile || installed() || w.__roInstalled) return null;
    // 2026-11-11 사용자 "홈 화면에 앱 추가는 계정 만드는 내내 하단에 — 아무 때나 추가할 수 있게"(기획 세션 전달) → 카드 안이 아니라 접속 화면(#ro-entry-overlay)
    //   아래에 고정 띠로 붙인다. 접속 화면은 로그인 → 새로 시작(사진·이름·성별·종족·얼굴·소환 대기)까지 그대로 있고 게임에 들어가면(RoEntryReady) 통째로 사라진다
    var entryRoot = RoEntryUI().ensure().root;
    var oldDock = document.getElementById("ro-install-dock");
    if (oldDock && oldDock.isConnected) return oldDock.firstChild;
    if (!document.getElementById("ro-install-style")) {
      var st = document.createElement("style"); st.id = "ro-install-style";
      // 핑크 포링 느낌(2026-11-09 사용자 "홈 화면에 앱 추가 버튼은 핑크색 포링 느낌으로") — 말랑한 젤리 분홍 + 윗쪽 반짝 + 포링 얼굴, 누르면 젤리처럼 눌림
      st.textContent = "#ro-install-dock{position:fixed;left:0;right:0;bottom:max(10px,env(safe-area-inset-bottom));z-index:10000;display:flex;justify-content:center;pointer-events:none;transition:opacity .2s}#ro-install-dock>*{pointer-events:auto}" +
        "#ro-install-dock.ro-typing,#ro-install-dock.ro-covered,#ro-install-dock.ro-guide{opacity:0;visibility:hidden}body:has(#ro-install-dock:not(.ro-covered):not(.ro-typing)) #ro-ver{bottom:calc(64px + env(safe-area-inset-bottom))!important}#ro-entry-overlay.ro-has-install{padding-bottom:62px;box-sizing:border-box}" +
        ".ro-install-btn{position:relative;display:flex;align-items:center;justify-content:center;gap:8px;margin:0 auto;padding:7px 20px 7px 12px;font:inherit;font-size:15px;font-weight:900;color:#fff;cursor:pointer;" +
        "text-shadow:0 1px 0 #c2366a,0 -1px 0 #c2366a,1px 0 0 #c2366a,-1px 0 0 #c2366a,0 2px 0 #a8285a;border:2px solid #d9467c;border-radius:999px;" +
        "background:radial-gradient(ellipse 70% 45% at 40% 22%,#fff8 0,#fff0 70%),linear-gradient(#ffc2d6,#ff86ad 55%,#f2648f);box-shadow:inset 0 -4px 6px #e04f8466,inset 0 2px 1px #fffb,0 4px 0 #b8336a,0 6px 10px #0006;" +
        "transition:transform .12s cubic-bezier(.3,1.6,.5,1),box-shadow .1s;animation:roPoringBob 2.4s ease-in-out infinite}" +
        ".ro-install-btn:active{transform:translateY(3px) scale(1.04,.92);box-shadow:inset 0 -3px 5px #e04f8466,inset 0 2px 1px #fffb,0 1px 0 #b8336a,0 2px 4px #0006}" +
        "@keyframes roPoringBob{0%,100%{transform:none}45%{transform:translateY(-2px) scale(.98,1.03)}55%{transform:translateY(0) scale(1.03,.97)}}" +
        ".ro-install-mask{position:fixed;inset:0;z-index:10050;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;background:rgba(12,8,5,.72);animation:roPop .2s ease-out}" +
        ".ro-install-panel{width:min(88vw,380px);box-sizing:border-box;padding:20px 20px 18px;border:3px solid #c98f3e;border-radius:20px;background:radial-gradient(ellipse at top,#71462c,#352014 80%);box-shadow:0 12px 36px #000a,inset 0 2px 2px #fff4;color:#fff1cd;word-break:keep-all;overflow-wrap:anywhere}" +
        ".ro-install-step{display:flex;align-items:center;gap:12px;margin:12px 0;font-size:16px;line-height:1.45}" +
        ".ro-install-step b.n{flex:none;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#FFD966;color:#2E2018;font-size:15px}" +
        ".ro-install-ico{flex:none;width:40px;height:40px;border-radius:10px;background:#EBDDBC;display:flex;align-items:center;justify-content:center}" +
        ".ro-install-ok{display:block;width:100%;margin-top:14px;padding:12px 6px;border:3px solid #d7891b;border-top-color:#fff1a9;border-radius:16px;background:linear-gradient(#ffe78a,#ffc336 48%,#efa214);color:#452108;box-shadow:inset 0 2px #fff8,0 4px 0 #793b0d,0 6px 9px #0004;font:inherit;font-size:19px;font-weight:900;cursor:pointer}" +
        ".ro-install-ok:active{transform:translateY(3px);box-shadow:inset 0 2px #fff8,0 1px 0 #793b0d}" +
        // 브라우저 버튼(공유·⋮) 자리를 가리키는 화살표 — 띠용띠용(위로 통 튀며 커졌다 착지 납작 × 2, 짧게 쉬고 되풀이). 아래 막대 쪽은 뒤집어(아래로 튐) 옅게
        ".ro-install-arrow{position:fixed;z-index:10051;width:46px;height:58px;pointer-events:none;filter:drop-shadow(0 3px 4px #000c)}.ro-install-arrow.down{transform:rotate(180deg)}" +
        ".ro-install-arrow>div{width:100%;height:100%;transform-origin:50% 100%;animation:roInstallBoing 1.5s ease-in-out infinite}" +
        "@keyframes roInstallBoing{0%{transform:none}12%{transform:translateY(-16px) scale(1.18)}24%{transform:translateY(0) scale(1.2,.8)}32%{transform:none}44%{transform:translateY(-16px) scale(1.18)}56%{transform:translateY(0) scale(1.2,.8)}64%,100%{transform:none}}" +
        ".ro-install-key{display:inline-flex;align-items:center;gap:4px;margin:2px 2px;padding:2px 8px 2px 5px;border:2px solid #FFD966;border-radius:8px;background:#FFD96626;color:#FFD966;font-weight:900;white-space:nowrap;vertical-align:middle}" +
        "@media (prefers-reduced-motion:reduce){.ro-install-arrow>div{animation:none}}";
      document.head.appendChild(st);
    }
    var hl = function (t) { return "<b style='color:#FFD966'>" + t + "</b>"; };
    var shareSvg = "<svg width='26' height='26' viewBox='0 0 24 24' fill='none' stroke='#2a6fdb' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 3v12M7.5 7.5 12 3l4.5 4.5'/><path d='M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 17.5 10H16'/></svg>";
    var addSvg = "<svg width='26' height='26' viewBox='0 0 24 24' fill='none' stroke='#2E2018' stroke-width='2' stroke-linecap='round'><rect x='4' y='4' width='16' height='16' rx='4'/><path d='M12 8.5v7M8.5 12h7'/></svg>";
    var dotsSvg = "<svg width='26' height='26' viewBox='0 0 24 24' fill='#2E2018'><circle cx='12' cy='5' r='2'/><circle cx='12' cy='12' r='2'/><circle cx='12' cy='19' r='2'/></svg>";
    // 2026-11-11 사용자 "공유 버튼을 누르세요만 있어 어딘지 모른다 — 아이폰은 위 주소창에 있으니 화살표로 띠용띠용, 그다음 '홈 화면에 추가'를 확실하게".
    //   아이폰 사파리는 설정·버전에 따라 공유 버튼이 아래 막대일 수도 있어 아래에도 옅은 화살표를 하나 더. 아이폰 크롬 = 주소창 오른쪽 위, 아이패드 = 오른쪽 위
    //   안드로이드 = 크롬 등 ⋮ 메뉴(오른쪽 위), 삼성 인터넷은 메뉴(≡)가 오른쪽 아래
    var small = function (t) { return "<br><span style='font-size:13px;opacity:.75'>" + t + "</span>"; };
    var addKey = "<span class='ro-install-key'><svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='#FFD966' stroke-width='2.4' stroke-linecap='round'><rect x='4' y='4' width='16' height='16' rx='4'/><path d='M12 8.5v7M8.5 12h7'/></svg>홈 화면에 추가</span>";
    var arrowHtml = function (pos, down, faint) {
      return "<div class='ro-install-arrow" + (down ? " down" : "") + "' aria-hidden='true' style='" + pos + (faint ? ";opacity:.5" : "") + "'><div>" +
        "<svg width='46' height='58' viewBox='0 0 46 58'><path d='M23 3 42 27H30.5V55h-15V27H4Z' fill='#FFD966' stroke='#2E2018' stroke-width='3' stroke-linejoin='round'/></svg></div></div>";
    };
    var topRight = "top:calc(20px + env(safe-area-inset-top));right:14px";   // 튀어 오르는 16 만큼 안쪽에 둬야 화면 밖으로 안 잘린다
    var botMid = "bottom:calc(20px + env(safe-area-inset-bottom));left:50%;margin-left:-23px", botRight = "bottom:calc(20px + env(safe-area-inset-bottom));right:14px";
    var ipad = /iPad/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1), crios = /CriOS|FxiOS|EdgiOS/i.test(ua), samsung = /SamsungBrowser/i.test(ua);
    var guide = function () {
      var mask = document.createElement("div"); mask.className = "ro-install-mask";
      var arrows = ios
        ? (ipad || crios ? arrowHtml(topRight) : arrowHtml(topRight) + arrowHtml(botMid, true, true))
        : (samsung ? arrowHtml(botRight, true) : arrowHtml(topRight));
      var steps = ios
        ? [[shareSvg, "화살표가 가리키는 " + hl("공유 버튼") + "을 누르세요" + small(ipad || crios ? "화면 오른쪽 위 주소창 옆에 있어요" : "위쪽 주소창 오른쪽에 있어요 · 아래쪽 막대 가운데에 있을 수도 있어요")],
           [addSvg, "메뉴에서 " + addKey + "를 누르세요" + small("안 보이면 메뉴를 위로 밀어 보세요")],
           [addSvg, "오른쪽 위 " + hl("추가") + "를 누르면 끝!"]]
        : [[samsung ? "<svg width='26' height='26' viewBox='0 0 24 24' fill='none' stroke='#2E2018' stroke-width='2.4' stroke-linecap='round'><path d='M5 7h14M5 12h14M5 17h14'/></svg>" : dotsSvg, "화살표가 가리키는 " + (samsung ? "오른쪽 아래 " + hl("메뉴(≡)") : "오른쪽 위 " + hl("메뉴(⋮)")) + "를 누르세요"],
           [addSvg, "메뉴에서 " + addKey + " 또는 " + hl("앱 설치") + "를 누르세요"]];
      var html = "<div class='ro-install-panel' role='dialog' aria-label='홈 화면에 앱 추가'>" +
        "<div style='text-align:center;font-size:22px;font-weight:900;text-shadow:0 2px #3b1c0b'>홈 화면에 앱 추가</div>" +
        "<div style='text-align:center;font-size:14px;opacity:.8;margin:6px 0 4px'>추가하면 주소창 없이 " + "<b style='color:#75F5B6'>앱처럼 전체 화면</b>으로 열려요</div>";
      steps.forEach(function (s, i) {
        html += "<div class='ro-install-step'><b class='n'>" + (i + 1) + "</b><span class='ro-install-ico'>" + s[0] + "</span><span>" + s[1] + "</span></div>";
      });
      if (ios) html += "<div style='font-size:13px;opacity:.75;line-height:1.5'>카카오톡 같은 앱 안에서 열었다면 먼저 " + hl("사파리로 열기") + "를 해 주세요</div>";
      html += "</div>" + arrows;
      mask.innerHTML = html;
      var ok = document.createElement("button"); ok.type = "button"; ok.className = "ro-install-ok"; ok.textContent = "알겠어요";
      var dockEl = document.getElementById("ro-install-dock"); if (dockEl) dockEl.classList.add("ro-guide");   // 안내 동안 아래 띠를 숨긴다(아래쪽 화살표를 덮었다)
      var close = function () { mask.remove(); if (dockEl) dockEl.classList.remove("ro-guide"); };
      ok.onclick = close;
      mask.firstChild.appendChild(ok);
      mask.onclick = function (e) { if (e.target === mask) close(); };
      (document.getElementById("ro-entry-overlay") || document.body).appendChild(mask);
    };
    var b = document.createElement("button"); b.type = "button"; b.className = "ro-install-btn";
    // 포링 얼굴(분홍 젤리 몸 + 반짝 + 까만 눈 + 웃는 입 + 볼)
    b.innerHTML = "<svg aria-hidden='true' width='30' height='26' viewBox='0 0 30 26'><path d='M15 2C9 2 3 10 2.5 17 2 23 8 24.5 15 24.5S28 23 27.5 17C27 10 21 2 15 2Z' fill='#ffd1df' stroke='#d9467c' stroke-width='1.8'/>" +
      "<ellipse cx='10' cy='9' rx='3.2' ry='2' fill='#fff' opacity='.9' transform='rotate(-30 10 9)'/><ellipse cx='11' cy='15' rx='1.6' ry='2.2' fill='#3a1426'/><ellipse cx='19' cy='15' rx='1.6' ry='2.2' fill='#3a1426'/>" +
      "<path d='M12.5 19.2q2.5 2.4 5 0' fill='none' stroke='#3a1426' stroke-width='1.5' stroke-linecap='round'/><ellipse cx='8' cy='18.5' rx='2' ry='1.1' fill='#ff8fb3' opacity='.8'/><ellipse cx='22' cy='18.5' rx='2' ry='1.1' fill='#ff8fb3' opacity='.8'/></svg><span>홈 화면에 앱 추가</span>";
    b.onclick = function () {
      var p = w.__roInstallPrompt;
      if (!p) { guide(); return; }
      w.__roInstallPrompt = null;   // 설치 창은 한 이벤트에 한 번만 띄울 수 있다
      try {
        p.prompt();
        if (p.userChoice) p.userChoice.then(function (r) { if (r && r.outcome === "accepted") b.remove(); }, function () {});
      } catch (_) { guide(); }
    };
    var dock = document.createElement("div"); dock.id = "ro-install-dock";
    dock.appendChild(b);
    // 덮개(#ro-entry-overlay) 안에 두면 덮개의 backdrop-filter 가 fixed 의 기준을 덮개로 바꿔, 작은 화면(카드가 길어 끌어 내림)에서 띠가 카드와 함께 스크롤되며 버튼을 덮었다(QA v.0.078 360×560)
    //   → body 에 붙이고 덮개보다 나중 순서(같은 z 10000)로 위에 그린다. 프롤로그(10001)는 그 위. 덮개가 걷히면(게임 입장) 같이 치운다(RoEntryUI.ready)
    document.body.appendChild(dock);
    entryRoot.classList.add("ro-has-install");   // 카드가 띠 밑으로 들어가지 않게 아래 여백(fitCard 가 이 여백까지 재서 줄인다)
    var gone = function () { dock.remove(); if (entryRoot) entryRoot.classList.remove("ro-has-install"); };
    b.remove = gone;   // 설치 수락·appinstalled 때 띠째 치운다
    // 글을 쓰는 동안(휴대폰 키보드가 올라옴)은 숨긴다 — 키보드 위로 떠서 입력칸을 가렸다
    var isTyping = function (t) { return t && (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && !/^(file|checkbox|radio|button)$/.test(t.type))); };
    entryRoot.addEventListener("focusin", function (e) { if (isTyping(e.target)) dock.classList.add("ro-typing"); });
    entryRoot.addEventListener("focusout", function () { dock.classList.remove("ro-typing"); });
    // 내용과 겹치는 동안은 숨긴다(2026-11-11 사용자 아이폰 "앱 설치 버튼이 겹침" — 소환 대기 '캐릭터를 만들고 있습니다' 글·녹음 카드 숫자 칸을 덮었다).
    //   카드가 길면 끝까지 내렸을 때(아래 여백 62 덕에 띠 위에서 끝남) 나타난다. 덮개 안 카드(#ro-name-card 의 틀)·대기 판·그 밖 판의 아래 끝을 띠 위끝과 비교
    var covered = function () {
      if (!dock.isConnected || !entryRoot.isConnected) return;
      var top = dock.getBoundingClientRect().top - 6, low = 0;
      for (var el = entryRoot.firstElementChild; el; el = el.nextElementSibling) {
        if (el.tagName === "STYLE" || el.offsetParent === null) continue;
        var r = (el.id === "ro-name-card" && el.firstElementChild ? el.firstElementChild : el).getBoundingClientRect();
        if (r.height > 0 && r.top < w.innerHeight && r.bottom > 0) low = Math.max(low, r.bottom);
      }
      dock.classList.toggle("ro-covered", low > top);
    };
    entryRoot.addEventListener("scroll", covered, { passive: true });
    w.addEventListener("resize", covered);
    var coverTimer = setInterval(function () { if (!dock.isConnected) { clearInterval(coverTimer); return; } covered(); }, 250);   // 카드·대기 판이 바뀔 때(단계 넘어감·오류 줄)
    covered();
    w.addEventListener("appinstalled", gone);
    return b;
  },
  $RoAppInstall__deps: ["$RoEntryUI"],
  RoLoginOpen__deps: ["$RoCard", "$RoNewFlow", "$RoEntryUI", "$RoAppInstall"],
  RoLoginOpen: function (defNamePtr, messagePtr, tone) {
    // 엔진보다 먼저 띄운 카드 넘겨받기(2026-11-20 사용자 "일단 로그인 화면으로 빠르게", ro-pre-head.js) — C# 가 처음 로그인 카드를 여는 지금이 받을 곳이 생긴 때.
    //   거절·점검 같은 글 없이 열리고 미리 띄운 카드가 아직 쓰이는 중(로그인·신규 카드·프롤로그가 떠 있거나 이미 보낸 것이 있음)이면 그대로 두고 모은 것만 넘긴다
    var pre = window.__roPre;
    if (pre && pre.hand && !pre.handed && typeof __roIsPre === "undefined") {   // __roIsPre = 먼저 뜬 사본(ro-pre-head.js)에서는 건너뛴다
      var keepPre = pre.opened && !UTF8ToString(messagePtr) && (document.getElementById("ro-name-card") || document.getElementById("ro-prologue") || pre.queue.length);
      if (!keepPre) pre.queue.length = 0;
      pre.hand(function (o, m, a) { SendMessage(o, m, a); });
      if (keepPre) return;
    }
    if (window.__roInWorld) window.__roLateOk = 0;   // 월드에 들어갔다가 로그인 카드로 돌아옴 — 새 캐릭터 바로 접속의 늦은 얼굴·목소리를 더 보내지 않는다(2026-11-21)
    RoEntryUI().cancel();
    RoEntryUI().setRacePreview(false);
    SendMessage("NetSession", "OnHtmlRacePreviewReset", "");
    SendMessage("BgmPlayer", "OnHtmlTitleMusic", "1");   // 첫 화면 곡은 로그인 화면에서만(사운드 세션 2026-11-09)
    try { SendMessage("WebLowPower", "OnHtmlLowPower", "0"); } catch (_) {}   // 로그인 카드로 돌아오면 저전력 끔(새 캐릭터 사진 단계에서 켰을 수 있다)
    var defName = UTF8ToString(defNamePtr);
    var message = UTF8ToString(messagePtr);
    if (!message && window.__roLoginNote) message = window.__roLoginNote;   // 새 캐릭터 카드가 돌려보내며 남긴 안내(없는 이름 + 4자리 비번, 2026-11-23)
    window.__roLoginNote = null;
    var resume = null;   // 새 캐릭터 사진을 고르다 탭이 새로 열림(아이폰) — 5분 안이면 사진 단계로(RoNewFlow saveResume)
    try { resume = JSON.parse(sessionStorage.getItem("ro_photo_resume") || "null"); sessionStorage.removeItem("ro_photo_resume"); } catch (_) { resume = null; }
    if (resume && Date.now() - (resume.t || 0) < 5 * 60 * 1000) { SendMessage("BgmPlayer", "OnHtmlTitleMusic", "0"); RoNewFlow("", resume); return; }
    var remembered = "";
    try { remembered = localStorage.getItem("ro_login_name") || ""; } catch (_) {}
    var c = RoCard(0);
    c.wrap.className = "ro-login-card";
    c.rim.style.cssText = "width:min(90vw,420px);box-sizing:border-box;padding:7px;border:2px solid #8d4c12;border-radius:30px;background:linear-gradient(135deg,#ffedaa,#eeb340 24%,#a75b12 55%,#f8cb65);box-shadow:0 12px 36px #0009,inset 0 2px 2px #fff7;animation:roPop .22s ease-out";
    c.card.style.cssText = "position:relative;box-sizing:border-box;padding:18px 22px 22px;border:3px solid #71401e;border-radius:22px;background:radial-gradient(ellipse at top,#71462c,#352014 80%);box-shadow:inset 0 3px 8px #0007;color:#fff1cd";
    var header = document.createElement("div");
    header.style.cssText = "text-align:center";
    header.innerHTML = "<img alt='와우나로크' src='" + RoEntryUI().logoUrl() + "' style='display:block;width:100%;height:auto;max-height:300px;object-fit:contain;margin:-8px auto 0;filter:drop-shadow(0 5px 3px #0006)'><p style='font-size:19px;font-weight:800;color:#f3d5a0;margin:6px 0 14px;text-shadow:0 2px #2a1208'>모험이 기다리고 있어요</p>";   // 머리 = 로고만 크게(2026-11-11 사용자 "어서 오세요 빼고 로고만 크게 잘 보이게, 모험이 기다리고 있어요는 둔다")
    c.card.appendChild(header);
    // 폴드 펼친 화면처럼 넓은 터치 화면은 로고를 카드 안쪽 여백까지 키운다(테두리 밖으로는 안 넘침 — 사용자 "너무 커, 삐져나가면 안 돼")(2026-11-11 사용자 "폴드에서 로고 좀 더 크게") — 판 전체가 높이에 맞춰 줄어드니 카드 폭만으로는 더 못 키운다
    if (window.innerWidth >= 600 && window.innerWidth >= window.innerHeight * 0.7 && navigator.maxTouchPoints > 0) header.firstChild.style.cssText += ";width:calc(100% + 36px);max-width:none;max-height:none;margin:-12px -18px 0";
    // 로그인에만 로고를 카드 안에 둔다. 다른 생성 단계의 공통 상단 로고는 그대로 사용한다.
    var style = document.createElement("style");
    style.textContent = "#ro-entry-overlay:has(.ro-login-card)>#ro-entry-top{display:none}.ro-login-card input:focus{border-color:#ffdb75!important;box-shadow:0 0 0 3px #f5bd4333,inset 0 3px 6px #0008!important}.ro-login-card button:active{transform:translateY(2px)}.ro-login-card .ro-login-new:active{transform:translateY(4px);box-shadow:inset 0 2px #ffffffa0,0 1px 0 #5a3ea6,0 2px 4px #0004!important}.ro-login-card input.ro-pin,.ro-login-card input.ro-pin:focus{border:0!important;box-shadow:none!important;background:transparent!important}@media(max-height:650px){.ro-login-card img{max-height:150px!important}}";
    c.wrap.appendChild(style);
    c.wrap.style.paddingTop = "max(18px,env(safe-area-inset-top))";
    var err = c.errLine(), f, submitting = false, pinFirst = null;
    // 예전 4자리 계정(2026-11-23 비밀번호 8자리) — 4자리로 맞게 들어오면 서버가 AccountStore.ReasonPinUpgrade 로 거절한다 → 새 8자리를 두 번 받아 "옛4자리>새8자리" 로 다시 보낸다(옛 비번 = 방금 보낸 __roSttAuth.p)
    var oldPin = window.__roSttAuth && /^[0-9]{4}$/.test(window.__roSttAuth.p || "") ? window.__roSttAuth.p : "";
    var pinUpgrade = message === "비밀번호를 숫자 8자리로 바꿔 주세요. 새 비밀번호를 입력해 주세요" && !!oldPin;
    // 비밀번호 초기화 = 임시 비밀번호 방식(2026-11-23 서버 세션 보안 결정) — 운영자에게 받은 임시 8자리로 로그인하면 서버가 ReasonPinReset 으로 거절한다 →
    //   새 8자리를 두 번 받아 "임시8자리>새8자리" 로 다시 보낸다(임시 비번 = 방금 보낸 __roSttAuth.p). 방금 보낸 8자리가 없으면 보통 로그인 카드로(임시 비번부터 다시 넣게)
    var tempPin = message === "비밀번호가 초기화되었습니다. 새로운 비밀번호를 입력해 주세요" && window.__roSttAuth && /^[0-9]{8}$/.test(window.__roSttAuth.p || "") ? window.__roSttAuth.p : "";
    var pinReset = pinUpgrade || !!tempPin;   // AccountStore.ReasonPinReset — 새 비밀번호는 한 번 더 묻는다
    var setErr = function (t) { err.textContent = t; err.style.color = "#FF8A73"; if (t) c.shake(); };   // 점검 안내(금색) 뒤의 오류는 다시 빨강
    var saveName = function () { try { localStorage.setItem("ro_login_name", f.name.value.trim()); } catch (_) {} };
    var go = function () {
      if (submitting) return;
      // 예전 4자리를 다시 넣은 경우(2026-11-23 메인 — v0.1.182 부터 옛 4자리 계정이 '8자리예요'에 막혀 못 들어옴) — 이미 확인됐다고 알리고 새 8자리를 받는다
      if (pinUpgrade && /^[0-9]{4}$/.test(f.pin.value)) { f.pin.value = ""; f.pinPaint.hide(); setErr("예전 4자리는 이미 확인됐어요 — 새 8자리를 넣어 주세요"); f.pin.focus(); return; }
      var bad = f.check(); if (bad) { setErr(bad); return; }
      if (pinReset) {   // 한 번 넣으면 같은 칸에 한 번 더(2026-11-19 사용자 "비번 정할 때 두 번 묻자", "한 번 묻고 한 번 더 묻자, 맞는지") — 다르면 처음부터
        var pinLabel = f.pin.parentNode.previousSibling;
        if (pinFirst === null) { pinFirst = f.pin.value; f.pin.value = ""; f.pinPaint.hide(); pinLabel.textContent = "확인을 위해 한 번 더 입력해 주세요"; pinLabel.style.color = "#ffdb75"; err.textContent = ""; f.pin.focus(); return; }
        if (f.pin.value !== pinFirst) { pinFirst = null; f.pin.value = ""; f.pinPaint.hide(); pinLabel.textContent = "새 비밀번호 (숫자 8자리)"; pinLabel.style.color = "#ffdb75"; setErr("비밀번호가 서로 달라요 — 처음부터 다시 입력해 주세요"); f.pin.focus(); return; }
      }
      submitting = true; saveName();
      f.name.blur(); f.pin.blur(); c.wrap.remove();
      RoEntryUI().busy("접속 중입니다");
      SendMessage("BgmPlayer", "OnHtmlTitleMusic", "0");   // 로그인 누르는 순간 첫 화면 곡을 서서히 끈다
      window.__roSttAuth = { n: f.name.value.trim(), p: f.pin.value };   // 말로 보내기 받아쓰기 로그인 확인용 — 메모리에만(저장 안 함). 8자리로 바꿀 땐 새 비번
      SendMessage("NetSession", "OnHtmlLogin", f.name.value.trim() + "\n" + (pinUpgrade ? oldPin + ">" : tempPin ? tempPin + ">" : "") + f.pin.value + "\n" + (keepBox.checked ? "1" : "0"));
    };
    f = c.namePin(defName, go, err);
    if (remembered) f.name.value = remembered.slice(0, 12);
    f.name.autocomplete = "username"; f.pin.autocomplete = "current-password";
    f.name.placeholder = "이름을 입력해 주세요";
    // 비번 8자리를 다 넣으면 로그인 버튼과 같은 처리를 바로(2026-11-10 사용자 "비번 4자리 입력하면 바로 들어가지게" → 2026-11-23 8자리, 예전 4자리 계정은 버튼·엔터로) — 이름이 비었으면 이름 칸으로
    var pinInput = f.pin.oninput;
    f.pin.oninput = function () { pinInput(); if (!submitting && f.pin.value.length === 8) { if (!f.name.value.trim().length) { setErr("이름을 적어 주세요"); f.name.focus(); } else go(); } };
    f.name.oninput = function () { saveName(); if (err.textContent) err.textContent = ""; };
    // 비밀번호는 4칸(c.pinBoxes)이라 입력칸 꾸미기는 이름만 — 비밀번호 제목은 4칸 묶음 앞에 있다
    f.name.style.cssText += ";border:3px solid #a76c3b;border-radius:14px;background:linear-gradient(#28150d,#472717);color:#fff2d1;box-shadow:inset 0 3px 6px #0008,0 2px #1d100b;font-size:20px;padding:12px 14px";
    [f.name.previousSibling, f.pin.parentNode.previousSibling].forEach(function (label) {
      label.style.cssText = "color:#fff0c7;font-size:16px;font-weight:800;margin:12px 0 7px;text-shadow:0 2px #301707";
    });
    if (pinReset) {   // 비번 초기화 뒤 새 비밀번호(2026-11-19) — 같은 4칸에 한 번 넣고 한 번 더(go 안에서)
      var newLabel = f.pin.parentNode.previousSibling;
      newLabel.textContent = "새 비밀번호 (숫자 8자리)"; f.pinNew = true;
      newLabel.style.color = "#ffdb75"; newLabel.style.fontSize = "18px";   // 보통 로그인 카드와 달라 보이게(2026-11-23 — 생김새가 같아 예전 4자리를 다시 넣었다)
      f.pin.autocomplete = "one-time-code";   // 아이폰 '강력한 암호' 노란 칸 막기(새 계정 비번 단계와 같음)
    }
    // 서버 안내는 빨간 오류 줄(입력하면 지워짐)이 아니라 금색 고정 안내로 — 비번 칸에 한 글자만 쳐도 사라져 무엇을 넣을지 몰랐다(2026-11-23)
    //   ① 비번 바꾸기(업그레이드·임시 비번 확인됨) ② 저장 로그인 자동 접속이 '8자리로 바꿔'·'임시 비번 필요'로 거절됨 — 방금 넣은 비번이 없어 바꾸기 카드를 못 여니 보통 카드로 먼저 지금 비번부터
    var pinNoteText = pinReset ? (pinUpgrade ? "예전 4자리 비밀번호가 확인됐어요" : "임시 비밀번호가 확인됐어요") + " — 새 비밀번호 숫자 8자리를 두 번 넣어 주세요"
      : message === "비밀번호를 숫자 8자리로 바꿔 주세요. 새 비밀번호를 입력해 주세요" ? "비밀번호를 숫자 8자리로 바꿀 차례예요 — 먼저 예전 4자리 비밀번호로 로그인해 주세요"
      : message === "비밀번호가 초기화되었습니다. 운영자에게 받은 임시 비밀번호를 입력해 주세요" ? message : "";
    // ③ 여러 번 틀려 잠김(AccountStore.ReasonLocked, QA v0.1.183 '잠겨도 맞지 않습니다만 보임') — 서버가 '|남은초' 를 붙이면 1초씩 줄여 보인다(서버 세션과 맞추는 형식), 없으면 '잠시 뒤'
    var lockLeft = -1;
    if (!pinNoteText && message && message.indexOf("비밀번호를 여러 번 틀렸습니다") === 0) {
      var lm = /\|(\d+)\s*$/.exec(message); lockLeft = lm ? parseInt(lm[1], 10) : 0;
      pinNoteText = "비밀번호를 여러 번 틀려 잠깐 잠겼어요 — " + (lockLeft > 0 ? lockLeft + "초 뒤 다시 해 주세요" : "잠시 뒤 다시 해 주세요");
    }
    if (pinNoteText) {
      var pinNote = document.createElement("div");
      pinNote.setAttribute("role", "status");
      pinNote.style.cssText = "margin:2px 0 10px;padding:10px 12px;border:2px solid #C9963F;border-radius:14px;background:linear-gradient(#3a2a12,#241a0c);box-shadow:inset 0 0 0 1px #ffd96633,0 3px 10px #0007;color:#FFD966;font-size:15px;font-weight:800;line-height:1.45;text-align:center;word-break:keep-all;overflow-wrap:anywhere";
      pinNote.textContent = pinNoteText;
      header.after(pinNote);
      if (lockLeft > 0) {
        var lockEnd = Date.now() + lockLeft * 1000;
        var lockTick = setInterval(function () {
          if (!pinNote.isConnected) { clearInterval(lockTick); return; }
          var s = Math.ceil((lockEnd - Date.now()) / 1000);
          pinNote.textContent = s > 0 ? "비밀번호를 여러 번 틀려 잠깐 잠겼어요 — " + s + "초 뒤 다시 해 주세요" : "이제 다시 해 볼 수 있어요";
          if (s <= 0) clearInterval(lockTick);
        }, 1000);
      }
    }
    // 지우기 ✕ — 지난 이름이 미리 채워지니 한 번에 비울 수 있게(QA 2026-11-07 개선 3). 글자가 있을 때만 보인다(라벨 꾸민 뒤에 감싼다)
    var nameBox = document.createElement("div"); nameBox.style.cssText = "position:relative";
    f.name.parentNode.insertBefore(nameBox, f.name); nameBox.appendChild(f.name);
    f.name.style.paddingRight = "52px";
    var clr = document.createElement("button"); clr.type = "button"; clr.textContent = "✕"; clr.setAttribute("aria-label", "이름 지우기");
    clr.style.cssText = "position:absolute;right:9px;top:50%;transform:translateY(-50%);width:34px;height:34px;border:0;border-radius:50%;background:#fff2d122;color:#fff2d1;font-size:17px;font-weight:900;cursor:pointer;padding:0;line-height:34px";
    var syncClr = function () { clr.style.display = f.name.value.length ? "block" : "none"; };
    clr.onclick = function () { f.name.value = ""; saveName(); syncClr(); if (err.textContent) err.textContent = ""; f.name.focus(); };
    f.name.oninput = function () { saveName(); syncClr(); if (err.textContent) err.textContent = ""; };
    nameBox.appendChild(clr); syncClr();
    var rememberedLine = document.createElement("div");
    rememberedLine.textContent = remembered ? "이전에 사용한 이름이에요" : "이름은 다음 접속 때 기억해 둘게요";
    rememberedLine.style.cssText = "color:#e7c99d;font-size:12px;margin:7px 2px 0";
    nameBox.after(rememberedLine);
    c.card.appendChild(err);
    // 로그인 유지 체크 칸(기본 켬, 마지막 선택을 기억 ro_remember_pref) — 켜고 로그인하면 서버가 기기 열쇠를 주고(저장·자동 접속은 C# RoLoginKey.jslib) 다음엔 카드 없이 들어온다
    var keepPref = true;
    try { keepPref = localStorage.getItem("ro_remember_pref") !== "0"; } catch (_) {}
    var keepRow = document.createElement("label");
    keepRow.style.cssText = "display:flex;align-items:center;gap:9px;margin:4px 2px 12px;cursor:pointer;user-select:none;-webkit-user-select:none;color:#fff0c7;font-size:16px;font-weight:800;text-shadow:0 2px #301707";
    var keepBox = document.createElement("input"); keepBox.type = "checkbox"; keepBox.checked = keepPref;
    keepBox.style.cssText = "position:absolute;opacity:0;width:1px;height:1px;pointer-events:none";
    var keepMark = document.createElement("span");
    var paintKeep = function () {
      keepMark.style.cssText = "flex:none;width:24px;height:24px;box-sizing:border-box;border-radius:7px;border:3px solid " + (keepBox.checked ? "#ffd25a" : "#a76c3b") + ";background:" + (keepBox.checked ? "linear-gradient(#ffe78a,#efa214)" : "linear-gradient(#28150d,#472717)") + ";box-shadow:inset 0 2px 3px #0006,0 2px #1d100b;display:flex;align-items:center;justify-content:center;color:#452108;font-size:16px;font-weight:900;line-height:1";
      keepMark.textContent = keepBox.checked ? "✓" : "";
    };
    keepBox.onchange = function () { paintKeep(); try { localStorage.setItem("ro_remember_pref", keepBox.checked ? "1" : "0"); } catch (_) {} };
    paintKeep();
    var keepText = document.createElement("span"); keepText.textContent = "로그인 유지";
    keepRow.appendChild(keepBox); keepRow.appendChild(keepMark); keepRow.appendChild(keepText);
    c.card.appendChild(keepRow);
    var btn = c.mainBtn(pinReset ? "새 비밀번호 정하기" : "로그인하고 입장");
    btn.style.cssText = "width:100%;padding:15px 6px;border:3px solid #d7891b;border-top-color:#fff1a9;border-radius:18px;background:linear-gradient(#ffe78a,#ffc336 48%,#efa214);color:#452108;box-shadow:inset 0 2px #fff8,0 5px 0 #793b0d,0 7px 10px #0004;cursor:pointer;font-family:inherit;font-weight:900;font-size:23px";
    btn.onclick = go; c.card.appendChild(btn);
    var create = c.mainBtn("신규 유저 만들기");
    // 2026-11-11 사용자 "로그인하고 입장·신규 유저 버튼 크기 동일하게, 신규 유저는 파란색 쾌청한 버튼으로" — 크기는 로그인 버튼과 같고 색만 하늘~코발트 입체(누르면 내려앉음)
    create.className = "ro-login-new";
    create.style.cssText = "display:block;width:100%;margin:8px 0 0;padding:15px 6px;border:3px solid #7a5bc9;border-top-color:#f1eaff;border-radius:18px;background:linear-gradient(#e6dbff,#c3abf5 48%,#9a7be3);color:#2e1566;text-shadow:0 1px 0 #f3edff;box-shadow:inset 0 2px #ffffffa0,0 5px 0 #5a3ea6,0 7px 10px #0004;cursor:pointer;font-family:inherit;font-weight:900;font-size:23px;transition:transform .08s,box-shadow .08s";
    create.onclick = function () { saveName(); SendMessage("BgmPlayer", "OnHtmlTitleMusic", "2"); RoNewFlow(""); };   // 새로 시작 누르는 순간도 — "2" = 종족 곡이 올라올 때까지 처음 화면 곡 유지(2026-11-18)
    c.card.appendChild(create);
    RoAppInstall(c.card);
    var badPin = message === "비밀번호가 틀렸습니다";   // AccountStore.ReasonBadPin — 웹은 ro_acct_reject 메시지 → 끊김 → 이 카드가 message 와 함께 다시 뜬다
    if (badPin) {
      err.textContent = "비밀번호가 맞지 않습니다";
      var pinRow = f.pin.parentNode;   // 4칸 묶음 — 카드가 뜨는 애니(0.22초) 뒤에 흔든다
      setTimeout(function () { pinRow.style.animation = "none"; void pinRow.offsetWidth; pinRow.style.animation = "roShake .4s ease-out"; Array.prototype.forEach.call(pinRow.children, function (d) { if (d !== f.pin) { d.style.borderColor = "#e0523a"; setTimeout(function () { d.style.borderColor = "#b47a3d"; f.pin.dispatchEvent(new Event("focus")); }, 900); } }); }, 240);
      f.pin.value = "";
      setTimeout(function () { if (c.wrap.isConnected) f.pin.focus(); }, 60);
    } else if (message && tone === 2) {   // 운영자 제재·비정상 경로 거절(NetSession 이 서버 상수와 비교해 2 를 넘김, 2026-11-10) — 제재 팝업과 같은 빨강 톤
      var ban = document.createElement("div");
      ban.setAttribute("role", "alert");
      ban.style.cssText = "display:flex;align-items:center;gap:10px;margin:2px 0 10px;padding:10px 12px;border:2px solid #9E3B2E;border-radius:14px;background:linear-gradient(#3d1410,#24100c);box-shadow:inset 0 0 0 1px #ff6a5533,0 3px 10px #0007;text-align:left";
      ban.innerHTML = "<img alt='' src='TemplateData/ro-onboarding/admin/seal_ban.png' style='width:46px;height:auto;flex:none'><div style='min-width:0'><div style='color:#FF6A55;font-weight:900;font-size:15px;margin-bottom:2px'>운영자 제재</div><div class='ro-ban-msg' style='color:#F7EEDC;font-size:14px;line-height:1.45'></div></div>";
      ban.querySelector(".ro-ban-msg").textContent = message;
      header.after(ban);
    } else if (message && tone === 3) {   // 관리 툴 강제 종료(AccountStore.ReasonAdminKick, 2026-11-11 사용자 "강제로 끊어졌다는 걸 알려줘야지") — 제재가 아니라 주황 안내 상자
      var kick = document.createElement("div");
      kick.setAttribute("role", "alert");
      kick.style.cssText = "margin:2px 0 10px;padding:10px 12px;border:2px solid #C9963F;border-radius:14px;background:linear-gradient(#3a2a12,#241a0c);box-shadow:inset 0 0 0 1px #ffd96633,0 3px 10px #0007;text-align:left";
      kick.innerHTML = "<div style='color:#FFB347;font-weight:900;font-size:15px;margin-bottom:2px'>접속 강제 종료</div><div class='ro-kick-msg' style='color:#F7EEDC;font-size:14px;line-height:1.45'></div>";
      kick.querySelector(".ro-kick-msg").textContent = message + ". 다시 로그인할 수 있습니다.";   // 저장 성공을 단정하지 않는다(2026-11-11 감사 — Logout 저장은 실패하면 나중에 다시 씀)
      header.after(kick);
    } else if (message && message.indexOf("서버 점검") >= 0) {   // 서버 교체·안전 종료(AccountStore.ReasonMaintenance, 2026-11-10 v.0.072) — 오류가 아니라 안내라 흔들지 않고 금색
      err.textContent = message; err.style.color = "#FFD966";
    } else if (message && !pinNoteText) setErr(message);   // 비번 바꾸기·비번 안내 거절은 위 금색 고정 안내가 대신한다
    // 처음 온 기기(2026-11-14 사용자 "로그인 화면을 둘로 — 신규는 이름·비번 빼고 신규 생성 버튼만 큼직하게", 시안 A Concept/ui/login_split) —
    //   C# 이 tone 4 로 부르면(저장된 이름·쓰던 계정·로그인 유지 열쇠가 모두 없을 때, 한 실행에 한 번) 머리(로고)와 시작 버튼만 남기고
    //   큰 '모험 시작하기' + 안내 + 작은 '이미 계정이 있어요 로그인 ›'. 그걸 누르면 숨긴 칸을 되살려 지금 로그인 카드 그대로.
    var firstVisit = tone === 4 && !message;
    // 기존 유저 카드의 '신규' 는 버튼 대신 아래쪽 작은 글자 링크(2026-11-14 사용자 "기존 유저도 하단에 텍스트로만 신규 생성하기") — 첫 방문 카드의 '이미 계정이 있어요 로그인 ›' 과 짝
    var createAsLink = function () {
      create.className = "";
      create.innerHTML = "처음이세요? <b style='color:#FFD966'>신규 생성하기 ›</b>";
      create.style.cssText = "display:block;margin:16px auto 2px;padding:6px 10px;border:0;background:none;color:#e7c99d;font-family:inherit;font-size:15px;font-weight:400;text-decoration:underline;text-underline-offset:4px;cursor:pointer;box-shadow:none;text-shadow:none";
    };
    if (!firstVisit) createAsLink();
    if (firstVisit) {
      var hidden = [];
      for (var el = header.nextSibling; el; el = el.nextSibling) { if (el === create) break; if (el.nodeType === 1 && el.tagName !== "STYLE") { hidden.push([el, el.style.display]); el.style.display = "none"; } }
      create.textContent = "모험 시작하기";
      create.style.fontSize = "27px"; create.style.padding = "24px 6px"; create.style.marginTop = "18px";
      var fvSub = document.createElement("div"); fvSub.textContent = "처음 오셨나요? 캐릭터를 만들고 바로 들어가요";
      fvSub.style.cssText = "text-align:center;color:#f3d5a0;font-size:15px;font-weight:700;margin:14px 0 0";
      var fvLink = document.createElement("button"); fvLink.type = "button";
      fvLink.innerHTML = "이미 계정이 있어요 <b style='color:#FFD966'>로그인 ›</b>";
      fvLink.style.cssText = "display:block;margin:18px auto 4px;padding:6px 10px;border:0;background:none;color:#e7c99d;font-family:inherit;font-size:15px;text-decoration:underline;text-underline-offset:4px;cursor:pointer";
      create.after(fvSub); fvSub.after(fvLink);
      fvLink.onclick = function () {
        hidden.forEach(function (h) { h[0].style.display = h[1]; });
        fvSub.remove(); fvLink.remove();
        createAsLink();
        if (!window.matchMedia("(pointer:coarse)").matches) setTimeout(function () { if (c.wrap.isConnected) f.name.focus(); }, 50);
      };
    }
    // 휴대폰 첫 화면은 자동 키보드 없이 전체 구성을 보여 준다.
    if (!badPin && !firstVisit && !window.matchMedia("(pointer:coarse)").matches)
      setTimeout(function () { if (c.wrap.isConnected) (f.name.value && !message ? f.pin : f.name).focus(); }, 50);
  },

  // 새로 시작 마지막 단계 — 목소리 녹음(2026-11-08, 서버 = 사운드 세션 Tools/face/voice_clone.py 의 /voice/*). 얼굴을 고른 뒤·접속 전.
  // 새로 시작 마지막 단계 — 목소리 녹음(2026-11-08, 서버 = 사운드 세션 Tools/face/voice_clone.py 의 /voice/*). 얼굴을 고른 뒤·접속 전.
  //   ElevenLabs 가 4.6초보다 짧은 녹음을 거절하고 빨리 세면 3초 안에 끝나서 길이를 고정한다(2026-11-08 사용자). 2026-11-09 사용자 "숫자가 너무 빠르다" → 0.65초·7초에서 1초·10.5초로) → POST /voice/start → 1초마다 /voice/status → 자기소개 한 줄 미리 듣기(intro)
  //   → '이 목소리로' = POST /voice/pick → done(번호) / '다시 녹음'(최대 2회 — 녹음 1회 약 0.18달러, 서버도 IP 당 10분 3회) / '건너뛰기' = done("").
  //   '건너뛰기'는 모든 단계에서 늘 보인다. 마이크 거부·서버 실패·시간 초과면 안내하고 건너뛸 수 있게. done 은 한 번만 부른다.
  //   원본 녹음은 서버가 복제 뒤 바로 지운다. 고르지 않은 작업은 /voice/discard 로 지운다.
  $RoVoiceStep__deps: ["$RoCard", "$RoEntryUI"],
  // opts(2026-11-09 사용자 "사진 생성이 오래 걸리니 사진 찍고 목소리 넣고, 얼굴 고르고, 그다음 목소리 확인"):
  //   recordOnly = 녹음해 서버에 보내자마자 done({job, uploads}) 로 넘기고 닫는다(복제는 서버에서 계속) — 건너뛰면 done("")
  //   resume = {job, uploads} — 녹음 없이 그 작업의 진행을 보다가 다 되면 미리 듣기·고르기(다시 녹음도 됨)
  $RoVoiceStep: function (base, name, done, gender, opts) {
    opts = opts || {};
    var entry = RoEntryUI().ensure();
    var c = RoCard(0);
    var MAX_UPLOADS = 3;   // 처음 1회 + 다시 녹음 2회
    var REC_MS = 10500, REC_MIN_MS = 5000, EXPECT_DEFAULT = 15;   // 녹음 길이(고정), 이보다 짧게 끊긴 녹음은 보내지 않음, 진행 막대 기준 시간(서버 expect 가 없을 때 — 실제 약 9초)
    var COUNT_GUIDE = "녹음을 누르면 하나부터 일곱까지 따라 읽어 주세요";   // 녹음 때 할 말(2026-11-16 사용자 "열 → 일곱")
    var READ_LINE = "하나, 둘, 셋, 넷, 다섯, 여섯, 일곱";   // 따라 읽을 말 — 쉼표로 나눠 하나씩 띄운다(2026-11-16 열 → 일곱, 복제 최소 길이 REC_MIN_MS 는 그대로)
    var COUNT_WORDS = READ_LINE.split(/\s*,\s*/);
    // 2026-11-09 사용자 "하나 해서 음성이 들어가야 다음으로" — 숫자는 시간이 아니라 말 한 마디(소리가 문턱을 넘었다가 다시 조용해짐)마다 넘긴다.
    //   소리 크기를 못 재는 브라우저만 예전처럼 1초마다(GUIDE_STEP_MS). 일곱까지 읽으면 끝(복제 최소 길이 REC_MIN_MS 는 채운 뒤), 너무 길면 REC_MAX_MS 에서 끝.
    var VAD_MIN_THR = 0.012, VAD_LOUD_MS = 120, VAD_QUIET_MS = 260, VAD_NUDGE_MS = 8000, REC_MAX_MS = 45000, REC_TAIL_MS = 400;
    var GUIDE_WAIT_MS = 300, GUIDE_STEP_MS = 1000;   // 녹음 시작 0.3초 뒤 첫 숫자, 1초마다 다음(일곱 = 6.3초, 읽을 틈 1초 뒤 7.3초에 끝 — 5초 최소는 넘음)
    var REC_SEC = "하나부터 일곱까지";   // 안내 글에 쓰는 말(이제 시간이 아니라 일곱까지 읽기)
    var REC_TITLE = "보이스 녹음";   // 카드 제목(2026-11-16 사용자 확정 '목소리 녹음' → '보이스 녹음')
    var COUNT_FROM = 3, COUNT_STEP_MS = 1000;   // '동의하고 녹음' 뒤 3 · 2 · 1(1초씩) 세고 나서 녹음 시작 — 세는 동안은 녹음하지 않는다(2026-11-16 사용자)
    var st = { consent: false, uploads: 0, job: "", phase: "idle", stream: null, rec: null, ctx: null, audio: null, playing: "", run: 0, finished: false, picking: false, base: base ? String(base).replace(/\/+$/, "") : "" };
    if (opts.uploads > 0) st.uploads = Math.min(MAX_UPLOADS, opts.uploads);   // 앞서 녹음한 횟수(2026-11-10 확인 화면의 '목소리 다시 녹음')
    var timers = [];
    var later = function (fn, ms) { var id = setTimeout(fn, ms); timers.push(id); return id; };
    var clearTimers = function () { timers.forEach(clearTimeout); timers = []; };
    var gold = function (t) { return "<b style='color:#FFD966'>" + t + "</b>"; };
    var getBase = function () {
      if (st.base) return Promise.resolve(st.base);
      return fetch("face.txt", { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("face.txt " + r.status); return r.text(); })
        .then(function (t) { st.base = t.trim().replace(/\/+$/, ""); return st.base; });
    };
    var discard = function () {
      var job = st.job; st.job = "";
      if (job && st.base) fetch(st.base + "/voice/discard?job=" + encodeURIComponent(job), { method: "POST" }).catch(function () {});
    };
    var stopMic = function () {
      if (st.rec && st.rec.state !== "inactive") { st.rec.onstop = null; try { st.rec.stop(); } catch (_) {} }
      st.rec = null;
      if (st.stream) { st.stream.getTracks().forEach(function (t) { t.stop(); }); st.stream = null; }
      if (st.ctx) { try { st.ctx.close(); } catch (_) {} st.ctx = null; }
      onAir(false);
      muteAll(false);   // 녹음이 끝나거나 멈추면 게임 소리를 다시
    };
    var stopAudio = function () { if (st.audio) { st.audio.pause(); st.audio.src = ""; st.audio = null; } st.playing = ""; };
    // 하던 일(녹음·올리기·상태 보기·재생)을 모두 멈춘다 — 낡은 응답은 run 번호로 버린다
    // 녹음하는 동안 게임 소리(배경음·환경음·효과음)를 모두 멈춘다(2026-11-10 사용자) — SoundManager.OnHtmlMuteAll
    var onAir = function (on) { if (typeof onAirSign !== "undefined" && onAirSign) onAirSign.classList.toggle("ro-on", on); };   // ON AIR 불 — 녹음기가 실제로 돌 때만(2026-11-16 카운트 뒤로 미룸)
    var muteAll = function (on) { if (!!st.muted === on) return; st.muted = on; try { SendMessage("SoundManager", "OnHtmlMuteAll", on ? "1" : "0"); } catch (_) {} };
    var halt = function () { st.run++; clearTimers(); stopMic(); stopAudio(); };
    var prevCleanup = entry.cleanup;
    var cleanup = function () { if (st.finished) return; st.finished = true; halt(); discard(); };
    entry.cleanup = function () { cleanup(); if (prevCleanup) prevCleanup(); };
    var finish = function (voice) {
      if (st.finished) return;
      st.finished = true; halt();
      if (!voice) discard();
      entry.cleanup = prevCleanup;
      c.wrap.remove();
      done(voice || "");
    };

    if (!document.getElementById("ro-voice-style")) {
      var css = document.createElement("style"); css.id = "ro-voice-style";
      css.textContent =
        ".ro-voice-box{margin:0 0 12px;padding:12px 14px;border:2px solid #8a5a2b;border-radius:14px;background:linear-gradient(#2a180e,#3a2416);box-shadow:inset 0 2px 6px #0007;color:#f3dcb0;font-size:14px;line-height:1.6}" +
        ".ro-voice-ok{display:flex;align-items:center;gap:8px;color:#75F5B6;font-weight:800;font-size:14px;margin-top:8px}" +
        ".ro-voice-stage{display:flex;flex-direction:column;align-items:center;gap:8px;margin:4px 0 6px;min-height:110px}" +
        ".ro-voice-mic{position:relative;width:96px;height:96px;border-radius:50%;border:3px solid #d7891b;border-top-color:#fff1a9;background:radial-gradient(circle at 50% 35%,#ffe78a,#ffc336 55%,#d98d14);box-shadow:inset 0 3px #fff8,0 6px 0 #793b0d,0 10px 18px #0007;cursor:pointer;display:grid;place-items:center;transition:transform .08s,box-shadow .08s,filter .2s}" +
        ".ro-voice-mic:active:not(:disabled){transform:translateY(5px);box-shadow:inset 0 3px #fff8,0 1px 0 #793b0d,0 4px 8px #0007}" +
        ".ro-voice-mic:disabled{filter:grayscale(.85) brightness(.55);cursor:default}" +
        ".ro-voice-mic.ro-rec{border-color:#7c1d14;border-top-color:#ff9a7c;background:radial-gradient(circle at 50% 35%,#ff8c6b,#d7402c 55%,#8f2216);box-shadow:inset 0 3px #fff6,0 6px 0 #4e120b,0 0 0 6px #ff6a4a44,0 0 26px #ff5a3a99;animation:roVoicePulse 2.6s ease-in-out infinite}" +
        "@keyframes roVoicePulse{50%{box-shadow:inset 0 3px #fff6,0 6px 0 #4e120b,0 0 0 8px #ff6a4a26,0 0 30px #ff5a3aaa}}" +   // 은은하게(2026-11-10 사용자 "불 들어오고 은은하게 빛나면 될 듯" — 0.9초 맥동은 누르고 싶어진다)
        ".ro-voice-big{font-size:30px;font-weight:900;color:#fff1cd;text-shadow:0 2px #3b1c0b;min-height:38px}" +
        ".ro-voice-hint{font-size:13px;color:#ecd2a4;text-align:center;line-height:1.55}" +
        ".ro-voice-bar{width:100%;height:18px;border:2px solid #8a5a2b;border-radius:10px;background:#1c100a;box-shadow:inset 0 2px 4px #000a;overflow:hidden}" +
        ".ro-voice-bar>div{height:100%;width:0;background:linear-gradient(#ffe78a,#f2b23a 55%,#c8801a);box-shadow:inset 0 2px #fff7;transition:width .35s}" +
        ".ro-voice-level{width:70%;height:8px;border-radius:5px;background:#1c100a;overflow:hidden;border:1px solid #6d4524}" +
        ".ro-voice-level>div{height:100%;width:0;background:linear-gradient(90deg,#75F5B6,#ffd966)}" +
        ".ro-voice-lines{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;width:100%}" +
        ".ro-voice-play,.ro-voice-sub,.ro-voice-skip{font-family:inherit;cursor:pointer;color:#fff1cd;transition:transform .08s,box-shadow .08s}" +
        ".ro-voice-play{display:flex;flex-direction:column;align-items:center;gap:3px;padding:10px 4px 8px;border:3px solid #a8743a;border-top-color:#e0b06a;border-radius:14px;background:linear-gradient(#6b4a30,#3d2a1c);box-shadow:inset 0 2px #fff3,0 4px 0 #1e120b;font-size:14px;font-weight:800}" +
        ".ro-voice-play .ro-voice-ico{font-size:20px;line-height:1;color:#FFD966}" +
        ".ro-voice-play .ro-voice-say{font-size:11px;font-weight:600;color:#e5cfa6;opacity:.9}" +
        ".ro-voice-play[aria-pressed=true]{border-color:#75F5B6;box-shadow:inset 0 2px #fff3,0 4px 0 #1e120b,0 0 12px #75F5B699}" +
        ".ro-voice-play[aria-pressed=true] .ro-voice-ico{color:#75F5B6}" +
        ".ro-voice-sub{width:100%;margin-top:10px;padding:10px 0;font-size:16px;font-weight:800;border:3px solid #a8743a;border-top-color:#e0b06a;border-radius:16px;background:linear-gradient(#6b4a30,#3d2a1c);box-shadow:inset 0 2px #fff3,0 4px 0 #1e120b}" +
        ".ro-voice-skip{display:block;margin:10px auto 0;padding:8px 22px;font-size:14px;font-weight:700;border:2px solid #6d4524;border-radius:12px;background:linear-gradient(#3a2618,#24160e);box-shadow:inset 0 1px #fff2,0 3px 0 #120a06;color:#e8cf9f}" +
        ".ro-voice-play:active:not(:disabled),.ro-voice-sub:active:not(:disabled){transform:translateY(4px);box-shadow:inset 0 2px #fff3,0 0 0 #1e120b}" +
        ".ro-voice-skip:active:not(:disabled){transform:translateY(3px);box-shadow:inset 0 1px #fff2,0 0 0 #120a06}" +
        ".ro-voice-sub:disabled,.ro-voice-play:disabled{opacity:.45;filter:grayscale(.6);cursor:default}" +
        ".ro-voice-read{width:100%;box-sizing:border-box;padding:10px 12px;border:2px dashed #8a5a2b;border-radius:12px;background:#24150c;color:#e5cfa6;text-align:center}" +
        ".ro-voice-read.ro-on{border-style:solid;border-color:#FFD966;background:linear-gradient(#3b2414,#2a180e);color:#fff1cd;box-shadow:0 0 14px #ffd96644}" +
        ".ro-voice-read-label{font-size:13px;font-weight:800;color:#f3ca73;margin-bottom:4px}" +
        ".ro-voice-count{font-size:18px;font-weight:900;line-height:1.5;white-space:nowrap;overflow:hidden;letter-spacing:-.01em}" +
        ".ro-voice-count i{font-style:normal;color:#b08a5a;margin:0 .18em}" +
        ".ro-voice-guide{display:flex;align-items:baseline;justify-content:center;gap:5px;height:58px;white-space:nowrap;overflow:hidden}" +
        ".ro-voice-guide .ro-past{font-size:14px;font-weight:700;color:#c9a97a;opacity:.55}" +
        ".ro-voice-guide .ro-now{display:inline-block;font-size:44px;font-weight:900;line-height:58px;color:#FFD966;text-shadow:0 3px #3b1c0b,0 0 14px #ffd96666;animation:roVoiceNum .32s cubic-bezier(.3,1.6,.5,1),roVoiceBoom .7s ease-in-out .32s infinite}" +
        "@keyframes roVoiceNum{0%{transform:scale(1.35) rotate(-6deg)}60%{transform:scale(.92) rotate(3deg)}100%{transform:scale(1) rotate(0)}}" +
        // 2026-11-16 사용자 "하나둘 셀 때 하나둘셋 글자를 왕왕거리게" — 지금 읽을 숫자는 읽을 때까지 크게 출렁이며 흔들린다(칸 높이 58px 안: 44px×1.15)
        "@keyframes roVoiceBoom{0%,100%{transform:scale(1) rotate(0)}25%{transform:scale(1.15) rotate(-4deg)}50%{transform:scale(1.03) rotate(0)}75%{transform:scale(1.13) rotate(4deg)}}" +
        ".ro-voice-say-now{display:inline-block;margin-left:8px;font-size:13px;font-weight:800;color:#75F5B6;align-self:center;animation:roVoiceSay 1s ease-in-out infinite}" +
        ".ro-voice-say-now.ro-hear{animation:none;color:#FFD966;opacity:1}" +
        "@keyframes roVoiceSay{50%{opacity:.35;transform:scale(.94)}}" +
        ".ro-voice-nudge{color:#FFD966;font-weight:800;font-size:14px;text-align:center;line-height:1.5;min-height:21px}" +
        ".ro-voice-mic.ro-rec{pointer-events:none}" +
        // ON AIR 표시등(2026-11-10 사용자 시안 B) — 녹음 전 꺼진 회색, 녹음 중 붉게 켜져 마이크와 같은 박자로 은은히
        ".ro-voice-onair{display:block;width:130px;height:auto;margin:4px auto 2px;filter:grayscale(1) brightness(.38) contrast(.9);transition:filter .3s}" +
        ".ro-voice-onair.ro-on{filter:drop-shadow(0 0 8px #ff3b1fcc) drop-shadow(0 0 18px #ff3b1f66);animation:roOnAir 2.6s ease-in-out infinite}" +
        "@keyframes roOnAir{50%{filter:drop-shadow(0 0 5px #ff3b1f99) drop-shadow(0 0 11px #ff3b1f44)}}" +
        ".ro-voice-cd{width:100%;box-sizing:border-box;padding:14px 12px 12px;border:3px solid #d7891b;border-top-color:#fff1a9;border-radius:18px;background:radial-gradient(ellipse at top,#6a4428,#2a180e 85%);box-shadow:inset 0 2px #fff3,0 5px 0 #793b0d,0 10px 22px #0008;text-align:center;animation:roVoiceCdIn .28s cubic-bezier(.3,1.5,.5,1)}" +
        ".ro-voice-cd-say{font-size:16px;font-weight:800;color:#fff1cd;line-height:1.55;text-shadow:0 2px #3b1c0b}" +
        ".ro-voice-cd-num{font-size:76px;font-weight:900;line-height:88px;height:88px;color:#FFD966;text-shadow:0 4px #3b1c0b,0 0 18px #ffd96680;animation:roVoiceCdNum .9s ease-out both}" +
        ".ro-voice-cd-wait{margin-top:6px}" +
        "@keyframes roVoiceCdIn{0%{transform:scale(.6);opacity:0}100%{transform:scale(1);opacity:1}}" +
        "@keyframes roVoiceCdNum{0%{transform:scale(1.8);opacity:0}25%{transform:scale(.9);opacity:1}40%{transform:scale(1.06)}60%,100%{transform:scale(1);opacity:1}}" +
        ":root[data-ro-ui-race=orc] .ro-voice-cd{border-color:#66392b;border-top-color:#d3a879;background:radial-gradient(ellipse at top,#51432c,#281d1a 85%);box-shadow:inset 0 2px #e8ad6a44,0 5px 0 #291c16,0 10px 22px #0008}" +
        ".ro-voice-bar.ro-time>div{background:linear-gradient(#ff9a7c,#d7402c 55%,#8f2216);transition:none}" +
        ".ro-voice-err{color:#FF8A73;font-weight:800;font-size:15px;text-align:center;line-height:1.5}" +
        ":root[data-ro-ui-race=orc] .ro-voice-box,:root[data-ro-ui-race=orc] .ro-voice-bar{border-color:#7a5444}" +
        ":root[data-ro-ui-race=orc] .ro-voice-play,:root[data-ro-ui-race=orc] .ro-voice-sub{border-color:#8a5a48;border-top-color:#c99a7a;background:linear-gradient(#5a4a3a,#30261f)}" +
        ":root[data-ro-ui-race=orc] .ro-voice-play[aria-pressed=true]{border-color:#75F5B6}";
      entry.root.appendChild(css);
    }

    c.card.innerHTML = opts.resume ? c.raceShell(6, "목소리 확인", "얼굴을 고르는 동안 목소리가 만들어졌어요") : c.raceShell(opts.step || 6, REC_TITLE, "", opts.total);   // 새 계정 흐름은 5 / 7(2026-11-10), 부제는 뺌(2026-11-16 사용자)
    // 동의 — 문구 아래 '동의하고 녹음'을 눌러야 녹음 버튼이 켜진다
    // 짧은 한 줄 + '자세히'를 누르면 펼쳐지는 설명(2026-11-09 사용자 "설명 부분 펼쳐서 열거나 간략하게")
    var consentBox = document.createElement("details"); consentBox.className = "ro-voice-box ro-voice-more";
    consentBox.setAttribute("role", "note");
    consentBox.innerHTML = "<summary>" + gold("본인 목소리만") + " · 원본 녹음은 저장하지 않아요 <span class='ro-more-tag'>자세히</span></summary>" +
      "<div style='margin-top:8px'>녹음한 목소리는 외부 음성 합성 서비스(ElevenLabs)로 보내져 복제되고, 이 캐릭터의 공격·아플 때·레벨 업 같은 대사를 만드는 데 쓰입니다. 원본 녹음은 우리 서버에 저장하지 않습니다.</div>";
    var moreCss = document.createElement("style");
    moreCss.textContent = ".ro-voice-more summary{list-style:none;cursor:pointer}.ro-voice-more summary::-webkit-details-marker{display:none}" +
      ".ro-more-tag{white-space:nowrap;color:#f3ca73;font-weight:800;text-decoration:underline;text-underline-offset:3px}.ro-more-tag::after{content:' ▾'}.ro-voice-more[open] .ro-more-tag::after{content:' ▴'}";
    consentBox.appendChild(moreCss);
    c.card.appendChild(consentBox);
    // '동의하고 녹음'은 마이크 아이콘 바로 아래에 둔다(2026-11-09 사용자) — showIdle 이 동의 전이면 마이크 다음에 끼운다
    var agree = c.mainBtn("동의하고 녹음"); agree.classList.add("ro-race-next"); agree.style.margin = "10px 0 4px"; agree.style.width = "100%";
    var stage = document.createElement("div"); stage.className = "ro-voice-stage"; stage.setAttribute("aria-live", "polite");
    var onAirSign = document.createElement("img"); onAirSign.className = "ro-voice-onair"; onAirSign.alt = "ON AIR"; onAirSign.src = "TemplateData/ro-onboarding/onair.png";
    if (!opts.resume) c.card.appendChild(onAirSign);   // 듣기만 하는 화면엔 없음
    c.card.appendChild(stage);
    var actions = document.createElement("div"); c.card.appendChild(actions);
    var skip = document.createElement("button"); skip.type = "button"; skip.className = "ro-voice-skip"; skip.textContent = opts.recordOnly ? "건너뛰기 (목소리 없이)" : "건너뛰기 (목소리 없이 시작)";   // 녹음만 단계는 다음이 얼굴 고르기라 '시작'을 뺀다
    skip.onclick = function () { finish(""); };
    c.card.appendChild(skip);
    if (opts.onBack) c.card.appendChild(c.stepBack(function () {
      if (st.finished) return;
      st.finished = true; halt(); discard(); muteAll(false);
      entry.cleanup = prevCleanup;
      c.wrap.remove();
      opts.onBack();
    }));

    var left = function () { return MAX_UPLOADS - st.uploads; };
    var subBtn = function (text, fn) { var b = document.createElement("button"); b.type = "button"; b.className = "ro-voice-sub"; b.textContent = text; b.onclick = fn; return b; };
    var setActions = function (list) { actions.innerHTML = ""; list.forEach(function (b) { actions.appendChild(b); }); };
    var redoBtn = function () {   // 다시 녹음 — 올린 횟수가 남았을 때만
      if (left() <= 0) return null;
      return subBtn("다시 녹음 (남은 " + left() + "회)", function () { halt(); discard(); showIdle(); });
    };
    // 녹음 중 가이드 칸 — 카운트 팝업이 있던 자리(마이크 바로 아래)에 지금 읽을 숫자를 크게. 녹음 전 '따라 읽을 숫자' 상자는 뺐다(2026-11-16 사용자)
    var readBox = function () {
      var d = document.createElement("div"); d.className = "ro-voice-read ro-on";
      d.innerHTML = "<div class='ro-voice-read-label'>따라 읽어 주세요</div><div class='ro-voice-guide' aria-live='off'></div>";
      return d;
    };
    // 녹음 중 가이드 — i 번째 숫자를 크게(금색, 살짝 튐), 지난 숫자는 왼쪽에 작고 흐리게 쌓고, 뒤 숫자는 안 보인다. 소리는 내지 않는다(녹음에 섞임)
    var showGuideWord = function (box, i) {
      var row = box.querySelector(".ro-voice-guide");
      if (!row) return;
      var now = row.querySelector(".ro-now");
      if (now) now.className = "ro-past";
      var span = document.createElement("span"); span.className = "ro-now"; span.textContent = COUNT_WORDS[i];
      row.appendChild(span);
      var say = row.querySelector(".ro-voice-say-now");
      if (say) row.appendChild(say);   // '말해 주세요' 는 늘 지금 숫자 오른쪽에
    };
    var micBtn = function (enabled) {
      var b = document.createElement("button"); b.type = "button"; b.className = "ro-voice-mic"; b.disabled = !enabled;
      b.setAttribute("aria-label", "녹음 시작");
      b.innerHTML = "<svg width='44' height='44' viewBox='0 0 24 24' fill='none' stroke='#452108' stroke-width='2.4' stroke-linecap='round' aria-hidden='true'><rect x='8.5' y='2.5' width='7' height='12' rx='3.5' fill='#452108'/><path d='M5 11a7 7 0 0 0 14 0M12 18v3.5M8.5 21.5h7'/></svg>";
      return b;
    };

    // ── 기다림(녹음 전) ──
    var showIdle = function (msg) {
      st.phase = "idle";
      stage.innerHTML = "";
      var mic = micBtn(st.consent && left() > 0);
      mic.onclick = record;
      stage.appendChild(mic);
      if (!st.consent) stage.appendChild(agree);
      var big = document.createElement("div"); big.className = "ro-voice-hint"; big.style.fontSize = "15px"; big.style.fontWeight = "800"; big.style.color = "#fff1cd";
      // '동의하면 녹음 버튼이 켜져요'·'녹음을 누르면…' 같은 설명 줄은 뺐다(2026-11-09 사용자 "동의하면 녹음 버튼이 켜져요 같은 설명 문구 삭제") — 횟수를 다 썼을 때만
      if (left() <= 0) { big.textContent = "녹음 횟수를 다 썼어요"; stage.appendChild(big); }
      // 버튼 아래 안내 두 줄·'따라 읽을 숫자' 상자는 뺐다(2026-11-16 사용자) — 할 말은 카운트 팝업이 알려 준다
      if (msg) { var e = document.createElement("div"); e.className = "ro-voice-err"; e.textContent = msg; stage.appendChild(e); }
      setActions([]);
    };
    // ── 안내(실패) — 남은 횟수가 있으면 다시 녹음, 건너뛰기는 늘 아래에 ──
    var showError = function (msg, allowRedo) {
      halt();
      st.phase = "error";
      stage.innerHTML = "";
      var e = document.createElement("div"); e.className = "ro-voice-err"; e.textContent = msg; stage.appendChild(e);
      var h = document.createElement("div"); h.className = "ro-voice-hint"; h.textContent = "목소리 없이 시작해도 나중에 게임에는 지장이 없어요"; stage.appendChild(h);
      c.shake();
      var r = allowRedo !== false ? redoBtn() : null;
      setActions(r ? [r] : []);
    };

    agree.onclick = function () {
      st.consent = true;
      agree.remove();
      var ok = document.createElement("div"); ok.className = "ro-voice-ok"; ok.textContent = "✓ 동의했습니다";
      consentBox.appendChild(ok);
      if (st.phase === "idle") { showIdle(); record(); }   // 동의 = 바로 녹음 순서 시작(2026-11-10 사용자 "수락 누르고 또 마이크를 누르게 돼 있던데") — 2026-11-16 부터 안내 팝업 · 3 · 2 · 1 뒤에 녹음
    };

    // ── 녹음(REC_MS 고정) ──
    var pickType = function () {
      var list = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];
      if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return "";
      for (var i = 0; i < list.length; i++) if (MediaRecorder.isTypeSupported(list[i])) return list[i];
      return "";
    };
    var record = function () {
      if (!st.consent || st.phase !== "idle" || left() <= 0) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { showError("이 브라우저에서는 녹음을 쓸 수 없어요 · 건너뛰어 주세요", false); return; }
      halt();
      muteAll(true);   // 마이크 허락창부터 녹음 끝까지(게임 소리만 끔 — ON AIR 불·마이크 빛은 녹음이 실제로 시작될 때)
      var run = st.run;
      st.phase = "asking";
      stage.innerHTML = "";
      var askMic = micBtn(true); askMic.tabIndex = -1; askMic.style.pointerEvents = "none"; stage.appendChild(askMic);   // 허락·카운트 동안은 불 꺼진 마이크(누를 수 없음)
      // 안내 팝업(2026-11-16 사용자) — 마이크 허락을 받으면 같은 판에 3 · 2 · 1, 다 세면 판이 사라지고 녹음. 건너뛰기·뒤로가기 = halt 가 카운트 타이머·마이크를 정리
      var pop = document.createElement("div"); pop.className = "ro-voice-cd"; pop.setAttribute("role", "status");
      pop.innerHTML = "<div class='ro-voice-cd-say'>마이크에 가까이 대고<br>" + gold(REC_SEC) + " 숫자를 세어 주세요!</div>" +
        "<div class='ro-voice-cd-num' aria-live='assertive' style='display:none'></div><div class='ro-voice-hint ro-voice-cd-wait'>마이크 사용을 허락해 주세요</div>";
      stage.appendChild(pop);
      var countdown = function (then) {
        st.phase = "counting";
        var wait = pop.querySelector(".ro-voice-cd-wait"); if (wait) wait.remove();
        var num = pop.querySelector(".ro-voice-cd-num"); num.style.display = "";
        for (var k = 0; k < COUNT_FROM; k++) (function (k) {
          later(function () { if (run !== st.run) return; num.textContent = String(COUNT_FROM - k); num.style.animation = "none"; void num.offsetWidth; num.style.animation = ""; }, k * COUNT_STEP_MS);
        })(k);
        later(function () { if (run === st.run && !st.finished) then(); }, COUNT_FROM * COUNT_STEP_MS);
      };
      var roMic = function (c) {   // 마이크 요청 — 처리 옵션을 붙여 실패하면(허락 거절 빼고) 옵션 없이 한 번 더(아이폰 사파리, 2026-11-15)
        // 아이폰: 게임이 소리 장치를 '재생 전용'(navigator.audioSession.type = "playback", RoAudioSessionEarly·RoAudioVisibility)으로 잡아 두면
        //   마이크 요청이 InvalidStateError 로 거절된다(2026-11-15 사용자 화면) → 요청 전에 '재생+녹음'으로. 마이크가 꺼지면 RoAudioVisibility 가 재생으로 되돌린다
        try { if (navigator.audioSession && navigator.audioSession.type !== "play-and-record") navigator.audioSession.type = "play-and-record"; } catch (_) {}
        return navigator.mediaDevices.getUserMedia(c).catch(function (e) {
          if (e && (e.name === "NotAllowedError" || e.name === "SecurityError")) throw e;
          console.warn("[마이크] 옵션 붙인 요청 실패 — 옵션 없이 다시", e);
          return navigator.mediaDevices.getUserMedia({ audio: true, video: false }).catch(function (e2) {
            if (e2 && (e2.name === "NotAllowedError" || e2.name === "SecurityError")) throw e2;
            // 아이폰: 게임 소리(유니티 WebAudio)가 소리 장치를 잡고 있으면 마이크가 '없다'고 나온다 — 소리 엔진을 잠깐 멈추고 한 번 더, 받은 뒤 다시 켬
            var ac = (typeof WEBAudio !== "undefined" && WEBAudio.audioContext) ? WEBAudio.audioContext : null;
            if (!ac || !ac.suspend) throw e2;
            console.warn("[마이크] 소리 엔진 멈추고 다시", e2);
            return ac.suspend().then(function () { return navigator.mediaDevices.getUserMedia({ audio: true, video: false }); })
              .then(function (s) { try { ac.resume(); } catch (_) {} return s; }, function (e3) { try { ac.resume(); } catch (_) {} throw e3; });
          });
        }).catch(function (eF) {   // 끝내 실패 = 재생 전용으로 되돌림 — 세션 종류는 오디오를 껐다 켜야 적용된다(안 하면 배경음이 통화용으로 작게 남는다, 2026-11-15 사용자 "아이폰 소리 또 확 줄어든다")
          try {
            if (navigator.audioSession) navigator.audioSession.type = "playback";
            var acF = (typeof WEBAudio !== "undefined" && WEBAudio.audioContext) ? WEBAudio.audioContext : null;
            if (acF && acF.state === "running") acF.suspend().then(function () { acF.resume(); });
          } catch (_) {}
          throw eF;
        });
      };
      roMic({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }).then(function (stream) {
        if (run !== st.run || st.finished) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
        st.stream = stream;
        var type = pickType(), rec;
        try { rec = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream); }
        catch (e) { console.warn("[목소리] 녹음기 실패", e); showError("녹음을 시작하지 못했어요", true); return; }
        st.rec = rec;
        var chunks = [], peak = 0, analyser = null, buf = null;
        try {   // 목소리가 들렸는지 — 거의 안 들렸으면 올리지 않는다(유료 복제를 아낌, 녹음 횟수도 안 셈)
          var AC = window.AudioContext || window.webkitAudioContext;
          if (AC) { st.ctx = new AC(); var src = st.ctx.createMediaStreamSource(stream); analyser = st.ctx.createAnalyser(); analyser.fftSize = 1024; src.connect(analyser); buf = new Float32Array(analyser.fftSize); }
        } catch (_) { analyser = null; }
        rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = function () {
          if (run !== st.run || st.finished) return;
          var blobType = (rec.mimeType || type || "audio/webm");
          var blob = new Blob(chunks, { type: blobType });
          stopMic();
          if (blob.size < 1500) { showIdle("소리가 녹음되지 않았어요 · 다시 눌러 주세요"); return; }
          if (Date.now() - started < REC_MIN_MS) { showIdle("녹음이 일찍 끊겼어요 · 다시 녹음해 주세요"); return; }   // 짧으면 복제가 거절된다 — 보내지도, 횟수에 넣지도 않는다
          if (analyser && peak < 0.03) { showIdle("목소리가 거의 안 들렸어요 · 다시 녹음해 주세요"); return; }   // 보내지도, 횟수에 넣지도 않는다
          upload(blob, blobType.split(";")[0].trim() || "audio/webm");
        };
        var started = 0;   // 녹음 시작 시각 — 카운트 뒤 beginRec 이 정함(onstop 의 최소 길이 검사도 씀)
        var beginRec = function () {
          st.phase = "recording";
          stage.innerHTML = "";
          var mic = micBtn(true); mic.classList.add("ro-rec"); mic.tabIndex = -1; mic.setAttribute("aria-label", "녹음 중");   // 멈춤 버튼 없음 — 일곱까지 읽으면 저절로
          stage.appendChild(mic);
          var guide = readBox(); stage.appendChild(guide);   // 카운트 팝업이 있던 자리에 지금 읽을 숫자
          var big = document.createElement("div"); big.className = "ro-voice-big"; stage.appendChild(big);
          var timeBar = document.createElement("div"); timeBar.className = "ro-voice-bar ro-time"; timeBar.setAttribute("role", "progressbar"); timeBar.setAttribute("aria-label", "읽은 숫자");
          timeBar.setAttribute("aria-valuemin", "0"); timeBar.setAttribute("aria-valuemax", String(COUNT_WORDS.length));
          timeBar.innerHTML = "<div style='width:0%;transition:width .2s'></div>"; stage.appendChild(timeBar);
          var level = document.createElement("div"); level.className = "ro-voice-level"; level.innerHTML = "<div></div>"; stage.appendChild(level);
          var sayNow = null;
          if (analyser) { sayNow = document.createElement("span"); sayNow.className = "ro-voice-say-now"; sayNow.textContent = "말해 주세요"; guide.querySelector(".ro-voice-guide").appendChild(sayNow); }
          var nudge = document.createElement("div"); nudge.className = "ro-voice-nudge"; nudge.setAttribute("aria-live", "polite"); stage.appendChild(nudge);
          var hint = document.createElement("div"); hint.className = "ro-voice-hint"; hint.innerHTML = (analyser ? "나온 숫자를 소리 내어 읽으면 다음 숫자가 나와요" : "나오는 숫자를 하나씩 소리 내어 따라 읽어 주세요") + "<br>마이크에 가까이 대고 말해 주세요"; stage.appendChild(hint);
          started = Date.now(); var idx = -1, stopping = false;
          var showWord = function (i) {
            idx = i; showGuideWord(guide, i);
            big.textContent = "녹음 중 · " + (i + 1) + " / " + COUNT_WORDS.length;
            timeBar.firstChild.style.width = (i / COUNT_WORDS.length * 100).toFixed(1) + "%"; timeBar.setAttribute("aria-valuenow", String(i));
          };
          var stopRec = function () {   // 일곱까지 다 읽음 — 복제 최소 길이를 채운 뒤 잠깐 여유를 두고 끝
            if (stopping) return; stopping = true;
            timeBar.firstChild.style.width = "100%"; timeBar.setAttribute("aria-valuenow", String(COUNT_WORDS.length));
            big.textContent = "잘했어요! 녹음을 마치는 중"; nudge.textContent = "";
            if (sayNow) sayNow.remove();
            later(function () { if (run === st.run && st.rec && st.rec.state !== "inactive") st.rec.stop(); }, Math.max(REC_TAIL_MS, REC_MIN_MS + 200 - (Date.now() - started)));
          };
          // 말 한 마디 감지 — 처음 0.3초 소리로 주변 소음을 재고, 그보다 확실히 크면 말하는 중, VAD_QUIET_MS 조용하면 한 마디 끝
          var noise = 0, noiseN = 0, loudMs = 0, quietMs = 0, heard = false, lastWordAt = started, lastT = started;
          var tick = function () {
            if (run !== st.run) return;
            var now = Date.now(), dt = Math.min(200, now - lastT); lastT = now;
            if (analyser) {
              analyser.getFloatTimeDomainData(buf);
              var m = 0, sq = 0; for (var i = 0; i < buf.length; i++) { var v = buf[i]; if (Math.abs(v) > m) m = Math.abs(v); sq += v * v; }
              var rms = Math.sqrt(sq / buf.length);
              peak = Math.max(peak, m);
              level.firstChild.style.width = Math.min(100, Math.round(m * 140)) + "%";
              if (idx < 0) { noise += rms; noiseN++; }
              else if (!stopping) {
                var thr = Math.max(VAD_MIN_THR, (noiseN ? noise / noiseN : 0) * 3);
                if (rms > thr) { loudMs += dt; quietMs = 0; if (loudMs >= VAD_LOUD_MS) heard = true; }
                else if (rms < thr * 0.6) { quietMs += dt; if (!heard) loudMs = 0; }
                if (sayNow) sayNow.classList.toggle("ro-hear", rms > thr);
                if (heard && quietMs >= VAD_QUIET_MS) {   // 한 마디 끝 → 다음 숫자
                  heard = false; loudMs = 0; quietMs = 0; lastWordAt = now; nudge.textContent = "";
                  if (idx + 1 < COUNT_WORDS.length) showWord(idx + 1); else stopRec();
                } else if (!heard && now - lastWordAt > VAD_NUDGE_MS) nudge.textContent = "소리가 잘 안 들려요 · 숫자를 조금 크게 읽어 주세요";
              }
            } else level.style.display = "none";
            if (!stopping && now - started > REC_MAX_MS) stopRec();   // 너무 길면 거기까지로
            if (st.rec && st.rec.state !== "inactive") later(tick, 50);
          };
          rec.start(250);
          onAir(true);   // ON AIR 불은 녹음기가 실제로 돌 때부터
          later(function () { if (run !== st.run) return; lastWordAt = Date.now(); showWord(0); }, GUIDE_WAIT_MS);
          if (!analyser) {   // 소리 크기를 못 재면 예전처럼 1초마다
            COUNT_WORDS.forEach(function (w, i) { if (i) later(function () { if (run === st.run) showWord(i); }, GUIDE_WAIT_MS + GUIDE_STEP_MS * i); });
            later(function () { if (run === st.run) stopRec(); }, GUIDE_WAIT_MS + GUIDE_STEP_MS * COUNT_WORDS.length);
          }
          tick();
        };
        countdown(beginRec);   // 안내 팝업 · 3 · 2 · 1 → 녹음
      }, function (e) {
        if (run !== st.run || st.finished) return;
        console.warn("[목소리] 마이크 거부", e);
        var denied = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
        showError(denied ? "마이크를 쓸 수 없어요 · 브라우저 주소창의 마이크 허용을 켜거나 건너뛰어 주세요" : "마이크를 찾지 못했어요(" + ((e && e.name) || "?") + ") · 건너뛰어 주세요", true);
        setActions(left() > 0 ? [subBtn("다시 시도", function () { showIdle(); })] : []);
      });
    };

    // ── 올리고 굽는 동안(실제 약 9초) — 1초마다 상태 ──
    var upload = function (blob, mime, resumeJob) {
      halt();
      var run = st.run;
      st.phase = "baking"; if (!resumeJob) st.uploads++;
      stage.innerHTML = "";
      var big = document.createElement("div"); big.className = "ro-voice-big"; big.style.fontSize = "22px"; big.textContent = "목소리를 만들고 있어요"; stage.appendChild(big);
      var bar = document.createElement("div"); bar.className = "ro-voice-bar"; bar.setAttribute("role", "progressbar"); bar.setAttribute("aria-label", "목소리 만들기 진행률");
      bar.setAttribute("aria-valuemin", "0"); bar.setAttribute("aria-valuemax", "100"); bar.innerHTML = "<div></div>"; stage.appendChild(bar);
      var pctLine = document.createElement("div"); pctLine.className = "ro-voice-hint"; stage.appendChild(pctLine);
      var craft = document.createElement("div"); craft.className = "ro-voice-hint"; craft.style.color = "#FFD966"; craft.style.fontWeight = "800"; stage.appendChild(craft);
      var crafts = ["목 가다듬는 중…", "기합 연습 중…", "'아야!' 연습 중…", "레벨 업 환호 연습 중…", "모험가 말투 익히는 중…"];
      var startedAt = Date.now(), expect = EXPECT_DEFAULT, last = 0, errors = 0;
      var show = function (pct, txt) {
        last = Math.max(last, Math.round(Math.max(0, Math.min(100, pct))));
        bar.firstChild.style.width = last + "%"; bar.setAttribute("aria-valuenow", last);
        pctLine.textContent = txt || (last + "% · 약 " + Math.max(1, Math.round(expect - (Date.now() - startedAt) / 1000)) + "초 남음 · 진행률은 예상치입니다");
        craft.textContent = crafts[Math.floor((Date.now() - startedAt) / 3000) % crafts.length];
      };
      show(2, resumeJob ? "목소리를 마무리하는 중…" : "목소리를 보내는 중…");
      setActions([]);
      var ctrl = new AbortController(), upTimer = resumeJob ? 0 : later(function () { ctrl.abort(); }, 30000);
      if (!resumeJob) getBase().then(function (b) {
        return fetch(b + "/voice/start?name=" + encodeURIComponent(name || "") + (gender === 0 || gender === 1 ? "&gender=" + gender : "") + (opts.race === 0 || opts.race === 1 ? "&race=" + opts.race : ""), { method: "POST", headers: RoEntryUI().devHeaders({ "Content-Type": mime }), body: blob, signal: ctrl.signal });
      }).then(function (r) {
        clearTimeout(upTimer);
        if (run !== st.run) return null;
        if (r.status === 429) { st.uploads = MAX_UPLOADS; showError("녹음 요청이 많아요 · 10분 뒤 다시 하거나 건너뛰어 주세요", false); return null; }
        if (r.status === 503) { st.uploads--; finish(""); return null; }   // 크레딧 소진·관리 툴 꺼짐 = 바로 기본 목소리로(2026-11-14 사용자 "막히면 자동으로 기본으로")
        if (!r.ok) { st.uploads--; throw new Error("start " + r.status); }   // 서버가 받지 않았으면 횟수에 넣지 않는다
        return r.json();
      }).then(function (j) {
        if (!j || run !== st.run) return;
        if (j.queued && j.ticket) {   // 줄 서기(2026-11-10) — 녹음만 단계면 줄 서기 표를 넘기고 확인 화면에서 기다린다
          if (opts.recordOnly) { handOff({ ticket: j.ticket, pos: j.pos, wait: j.wait }); return; }
          fetch(st.base + "/voice/queue/cancel?ticket=" + encodeURIComponent(j.ticket), { method: "POST" }).catch(function () {});
          showError("목소리 만들기 줄이 길어요 · 잠시 뒤 다시 하거나 건너뛰어 주세요", true); return;
        }
        st.job = j.job || "";
        expect = Math.max(3, Number(j.expect) || EXPECT_DEFAULT);
        if (!st.job) { showError("목소리 서버가 응답하지 않아요", true); return; }
        if (opts.recordOnly) { handOff(); return; }   // 녹음만 — 복제는 서버에서 계속, 확인은 얼굴을 고른 뒤
        poll();
      }).catch(function (e) {
        clearTimeout(upTimer);
        if (run !== st.run) return;
        console.warn("[목소리] 보내기 실패", e);
        showError("목소리 서버에 보내지 못했어요", true);
      });
      var poll = function () {
        if (run !== st.run) return;
        var ac = new AbortController(), t = later(function () { ac.abort(); }, 10000);
        fetch(st.base + "/voice/status?job=" + encodeURIComponent(st.job), { cache: "no-store", signal: ac.signal })
          .then(function (r) { if (!r.ok) throw new Error("status " + r.status); return r.json(); })
          .then(function (s) {
            clearTimeout(t);
            if (run !== st.run) return;
            errors = 0;
            if (Number(s.expect) > 0) expect = Math.max(3, Number(s.expect));
            var elapsed = (Date.now() - startedAt) / 1000;
            if (s.fail) { showError("목소리를 만들지 못했어요", true); return; }
            if (s.done) { show(100, "완성! 들어 보고 골라 주세요"); later(function () { if (run === st.run) showPreview(); }, 600); return; }
            if (elapsed > Math.max(90, expect * 4)) { showError("시간이 너무 오래 걸려요 · 다시 하거나 건너뛰어 주세요", true); return; }
            show(Math.min(95, elapsed / expect * 100));
            later(poll, 1000);
          }).catch(function () {
            clearTimeout(t);
            if (run !== st.run) return;
            if (++errors > 15) { showError("진행 상황을 확인하지 못했어요", true); return; }
            show(last, "진행 상황을 다시 확인하는 중…");
            later(poll, 2000);
          });
      };
      if (resumeJob) { st.job = resumeJob; getBase().then(function () { if (run === st.run) poll(); }, function () { if (run === st.run) showError("목소리 서버에 닿지 못했어요", true); }); }
    };
    // 녹음만 단계 — 보낸 작업을 넘기고 닫는다(지우지 않음)
    var handOff = function (queue) {
      if (st.finished) return;
      var job = st.job, uploads = st.uploads;
      st.finished = true; halt(); st.job = "";
      entry.cleanup = prevCleanup;
      c.wrap.remove();
      done({ job: job, uploads: uploads, queue: queue || null });
    };

    // ── 미리 듣기 + 고르기 ──
    // 미리 듣기 세 줄 고정 — 서버가 welcome.wav 를 더 만들지 않는다(2026-11-08). 대사 글은 voice_clone.py LINES 와 같게
    // 2026-11-09 — 세 줄 대신 자기소개 한 줄 intro(서버 voice_clone 이 /voice/start 의 이름으로 굽고 받침에 맞춰 이라고/라고)
    var introName = (name || "").trim() || "모험가";
    var lastCode = introName.charCodeAt(introName.length - 1);
    var josa = lastCode >= 0xAC00 && lastCode <= 0xD7A3 && (lastCode - 0xAC00) % 28 ? "이라고" : "라고";
    var lines = [{ id: "intro", name: "자기소개", say: "안녕~ 내 이름은 " + introName + josa + " 해!" }];
    var showPreview = function () {
      halt();
      st.phase = "preview";
      stage.innerHTML = "";
      var big = document.createElement("div"); big.className = "ro-voice-big"; big.style.fontSize = "20px"; big.textContent = "내 목소리 캐릭터 완성!"; stage.appendChild(big);
      var hint = document.createElement("div"); hint.className = "ro-voice-hint"; hint.textContent = "눌러서 들어 보세요"; stage.appendChild(hint);
      var grid = document.createElement("div"); grid.className = "ro-voice-lines"; stage.appendChild(grid);
      var plays = [];
      // 누르면 소리가 실제로 나오기('playing')까지 고리가 돈다 — 그동안 또 눌러도 무시(2026-11-16 사용자 "목소리 듣기를 누르면 바로 안 나와서 버근가 싶다")
      (function(){if(!document.getElementById('ro-spin-css')){var cs=document.createElement('style');cs.id='ro-spin-css';cs.textContent='@keyframes roSpin{to{transform:rotate(360deg)}}.ro-spin{display:inline-block;width:1.1em;height:1.1em;vertical-align:-0.2em;animation:roSpin .9s linear infinite}';document.head.appendChild(cs);}window.__roSpin=window.__roSpin||'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAALkUlEQVR42s1ZbYycV3U+9+u97/vOvPM94/3wx8bCxlnTxCJGIaSqx1VQDIhWBcaFVqmFBLbUFldVWon2z8yqpSJVBIpQK2KpiSt+sSP1RxBNAakZC5TWNJuAyQ54bccbr7273vHu7Hy/H/fe0x+244Q4ie3dxHuk+fPq6s55zjn3Oc+5l8A6GpbLtFasUQCAWq1odtfrZHq8ivV6iZQA4GC1anCyROFg1RAAvMkWBG7+/R2NrNlpRAK1CqtBDaAGMANd66HNI57rOXnC+RBBkuGUC22UUaibr72+/PKL3XClMnFCk9t0dl0BIJYpTC2w2g9OI6QgPjY6cq/l2A9KzvdyQXdzyjYDIUnOqaCUgNIGCAHd74cv/vrc4lfnX5BnD1ar+gMHgAhkuloSjfyScV9NJwvD3qOJhP0F2xK/57p2FgQDiDREkQaDoAkhBgAREQghxFgJKS+cvfz1bX90/AnEMiVkwqwFAL+dxZOTJXbm+SHeXTgjt5OtjyZ3uUekFL9vxyWJBgrCSIegDOWUcCE5ACEMENkbG1ACphdC0FcXAYBAZe3n7pYz8NLTh0XWClhLtz80Mpx53POcx+yYzQI/UgTAWJxawCj0eoHSkb6oAWeNMova6A4iUYxgigueajZ7tXOvLT7dnEp3P7ASmnnqgOynczxm6U9uyqf+2cvEdgS9UBMg2rKFFQYRDPywHin148j3fxqE0Xkk4YoyrB+2QEc8NN2BIvXXFw00ob9zOI77J06o9WC+9wRw/tlD9iXdFKNp77FN+fQTjivjvh/5Fmc2ZRRarcGL7V7vmUHff9E2bLEjop6/PY2dzmlsNApYKo1jtVonAACl0jhCBYBMrK3ub/kMzDx1QPZifb6ZJb5cyCe/ZVmC+YMosF3L7nX8Rrvde6q32v2+mxrMd9oj0c75YQ2VCSTkjulx/frA9ZrXseiLo8PZY4IzpjQq6Uprdbn785Vm8/HQ6v2SWdvCHScz0XpGdc0ZwHKZntlykvormYe2FjJPWpYQUaRD6VjW8tLqfy41W3/tDNkXejOe3nvkOxHcRaM3y8r07jrvzLtDhULiSdezs1GoA+lY1pVG6/mFxaWj924bmfu/Rj/ae+RYdDea6LsCwBfKrA3Ahgqpr2WysY8Gg8CXrpDN5e4rl+cWjmYyhQX40beDgwfXTIG47iVULgOdmlkgGY89lEw4R1SoNRdcDLpBs91q/+3u0bE5+FQmIn8ABjaIvSUDlWKZKv+Ck066R2KeHdcaFaOUNdvdf+lieHK6u4hrbf3vGwAEINCoY7aQ/Wg87nwmCiJlWUw2V3q/6jS7z1jxoegjB6shbDC7kYHJEn1+ocOTSefzbtyOIRKtDULPHzxDc535HSczEWxAo9cVJgDAlqS9mXP6KR1p5JzKTqs/0+52fhh2PbxbPH/LGSAHqyYe8+63pdiutNGUUwhD9aOWYBcb+aUN6fybAJTJZAmo6/AHnJgkBAAGvdAEUfjTIL8UFYsn9MYGUK2T9COPxBmj9wECUEJYFKnLvtJnAABuom3IXfKXvOl3A0Atv0Q84nmMsa2gDXDOiNbmfATRYhGK71sTul0rl4GUy28NHgUAaDQKmEiIFGU0q40BoAQQyWLUC30o1nHjFMw+urDwACvv28euZ4ICAExPjyPTzKWUuBoBgRBQSgcBDwxUxjcMgMyKw4ZhWGTuc9i1TCDFa/XEmBZX51dEAAREE/E+VxvF+XIZ6PCoZ3/snoTMZECOLDzAAAA4AcAyAEHKDCAaRCCAAIxQwZ2AwO462QgAPjtymPVEmJCKIx3IILsCwRtnoLK7TlSouoaQPiWEAABQTnIWxuxafnxDAFBuz9nkJdJuxo4XUsLpjnn0Bo2WAFp91URtGpxTMMoAZ3SLtGS2eJcPMSIQRCAZN5Nw4jKZ9GSMW8LuZVy8QaO1JaKauqWNOU8YBaW0ZoxuZZbYDLWlu5qBSgVItVIScc8ech07JalIu47Nx2Zn1VtodPrcJT+K9Olr7SJyXelKaX1sdnaMT06W2F0DAGX4yP0FTwi5WVjUY1LGKaPR/omr6oBeve6omnRzuxkE+uSgH2pE4IQzsCzr0wPeTpe2p+ldKZ9ymVahznOe3GpbdJQDcylFaUJ/gPimRkYIYOnPx8lKs/uy74enhaA89EPlSP7xlOc9PNsJWLkM9IOcdRGBwGcX2J4Hh5JSWnsYYzFC0TZK9UOtV9+mRmu1Gpyb+82C70c/oIyCMaAdz7Ys23osavS9P33wa+J9GNjJO62t1faxqal5kYtZ91pS7qCMCAR0QhVdqk5P+28DUKyc0PliyaysdP+j0xqsCEFF5Csdi7sHHGEfiKmA3eJZuF3WwptFf2x2jI+Mbs1LLh4lgEk0OqvCoNtq91+vQNFcF5g35oFrHy7R1eluz/8eE4xqrbVtW5brOn+jwitDpbwrrg8/7xF1vMXI33TdbO2QHCRNLJ6M/xlnbA8AxtHoRDAYnLr8y1dbUJnAmw71+/dP6Htyu9RiY/nY6kr3nC25CAZhmEnH7rOs5NdnZ1ftuWrJXofI45vXI1zlekQg5589ZEcXlTWSzX9RcP55IEQAQiGKwvr53zR+VSwW3yLvf/tg4qWTp/TZC/LsanvwjVApQikhoTIqk018haXSXwEAuPTcYfddMnEnIh+vR77FNMsP5z7nWPIoIagBIKG1bnd67R/Gh0MfihP6XS+29k+cUHseHCJL8+3nrix3viscLow2hlKCuVz8H4DbX7r+Z+vJOLO1QzK6qKwto6k/cRzxTwAqRhFtrYzb6/vfOzUzO1sH0L89XJF32nCuWrIboS5sy2WPZzcli343DLhglgqVf2W5/fdh1H+W5t1grNGPyB3c0r2RwanDHJYkne4upoczm456Mfk4IhoA2kLC2cAPvjF97ty/PbxnyCd7336VeVNuJwRwy/R4wIx7ZX5x5a+aV7ov2XEpVaRDLpi9qZD6thdPfFM1+pthHNirkyULsUxvy/naPga1Q3J+fl683m/v3ZItPJtJ2X+HqCkAEiB00yAIv3v61K+fKYxsC2/m/Hvy9eRkif2O5bmm1frQyGjhX1O5+MeDbhARQqglOWuv9n7R7gy+1Vrt/wRisLJ7exqhM4zVRh1L0+N4nS0qFSCVShlqtRotQhGmvAXC633Ls832uOf+sefaX3XisuD3o4AxIoRl0WY7ePLM3IVvpvNbujs//Z3gjhvOC+V9fNcntsiV5cFYIZt7IpeNfyYKFRgDgbSF9AcBBH74334YVUM//Fl0JZi7sHOpV2wUrtZq/poYnOmSM+4uBynmXNfa5drik1LyP4wlnHtUhKC19qUtbN9X/XbH/8fZpcvHCibZG/vyvwfv9p5MbvVNeOrYlG0Ey47kMn+RTrl/6XpOLBhECgygtLkwkYb+ILyotH4lCk1dobpMDXa0QUI4ERRJVgi2Q3B6HxN8lxtzpFEalMaAUiq5FNBp919tNTuV5bPz/9XfljKfOFgdrJtuQQRSO35I5lXftTz5cC4XOxp35SNCCgh9pQFAU0osbvGrU6k2oJQBBADGCFBGASgB0Aih0goMGs6ZRSWHfje40un6x5eby8cj1Z7lduqW72FvmwZfevqwKKSbfKmpUtmcdyCZcL8kLfa7bkw6AARUZAARNQBeE4wEAAGBAAEEblkMgFFQQQQDP7rg+9FznU7n+x3/yitubpf6RXdR3c7bA7lT3p46dpjb6SbxmyqbzcXud2xZtKW1lzG6i1CS45xJzujVoGuEINIIgE2tzVwU6VP9fvC//sD/n6V+/2wqIYPdAPpO6JisVa9DEShADaovB2JLIp/IpmIjgtEhAjxLCbUpA8toDAjAaqCjxU6nd6k7UC3ldAfFsaKCRh3JGl571k+7Q5lAtU5q+SXizXyYvDbfJM2R13DnfPxqJRUBvJkPEwCAB9JNA6WqWcNz7Bv2/53avvq1AkuAAAAAAElFTkSuQmCC';})();
      var paint = function () { plays.forEach(function (b) { var on = st.playing === b.line, ld = on && st.loading === b.line, ico = b.querySelector(".ro-voice-ico"); b.setAttribute("aria-pressed", on ? "true" : "false"); if (ld) ico.innerHTML = "<img class='ro-spin' alt='' src='" + window.__roSpin + "'>"; else ico.textContent = on ? "■" : "▶"; }); };
      lines.forEach(function (l) {
        var b = document.createElement("button"); b.type = "button"; b.className = "ro-voice-play"; b.line = l.id;
        b.innerHTML = "<span class='ro-voice-ico' aria-hidden='true'>▶</span><span>" + l.name + "</span><span class='ro-voice-say'>" + l.say + "</span>";
        b.setAttribute("aria-label", l.name + " 듣기");
        b.onclick = function () {
          if (st.loading === l.id) return;   // 받는 중 연타 무시
          var again = st.playing === l.id;
          stopAudio(); st.loading = "";
          if (!again) {
            var a = st.audio = new Audio(st.base + "/voice/job/" + encodeURIComponent(st.job) + "/" + l.id + ".mp3");
            st.playing = l.id; st.loading = l.id;
            var done = function () { if (st.audio === a) { st.audio = null; st.playing = ""; st.loading = ""; paint(); } };
            a.addEventListener("playing", function () { if (st.audio === a && st.loading === l.id) { st.loading = ""; paint(); } });
            a.onended = a.onerror = done;
            setTimeout(function () { if (st.audio === a && st.loading === l.id) { a.pause(); done(); } }, 9000);   // 9초 넘게 안 오면 풀기
            a.play().catch(done);
          }
          paint();
        };
        plays.push(b); grid.appendChild(b);
      });
      paint();
      var err = document.createElement("div"); err.className = "ro-voice-err"; stage.appendChild(err);
      var use = c.mainBtn("이 목소리로"); use.classList.add("ro-race-next"); use.style.marginTop = "10px";
      use.onclick = function () {
        if (st.picking) return;
        st.picking = true; use.disabled = true; stopAudio(); paint();
        var run = st.run, ac = new AbortController(), t = later(function () { ac.abort(); }, 20000);
        fetch(st.base + "/voice/pick?job=" + encodeURIComponent(st.job), { method: "POST", signal: ac.signal })
          .then(function (r) { clearTimeout(t); if (!r.ok) throw new Error("pick " + r.status); return r.json(); })
          .then(function (j) {
            if (run !== st.run || st.finished) return;
            var no = j && j.voice != null ? String(j.voice) : "";
            if (!no) throw new Error("pick 빈 번호");
            st.job = "";   // 골랐으니 지우지 않는다
            finish(no);
          }).catch(function (e) {
            clearTimeout(t);
            if (run !== st.run || st.finished) return;
            console.warn("[목소리] 고르기 실패", e);
            st.picking = false; use.disabled = false;
            err.textContent = "목소리를 저장하지 못했어요 · 다시 누르거나 건너뛰어 주세요"; c.shake();
          });
      };
      var r = redoBtn();
      setActions(r ? [use, r] : [use]);
    };

    if (opts.resume && opts.resume.job) {
      st.consent = true; st.uploads = Math.max(1, opts.resume.uploads || 1);
      agree.remove(); intro.remove(); consentBox.remove();   // 동의·안내는 녹음 때 이미 거쳤다
      upload(null, "", opts.resume.job);
    } else showIdle();
  },

  // 새 계정 세계관 프롤로그(2026-11-10 사용자 시안 Concept/ui/newchar_flow 6) — 종족별 5장, 그림 + 제목·본문 + 나레이션. 5초 뒤 오른쪽 위 '건너뛰기'(2026-11-12)(처음 만드는 계정만 — RoNewFlow 에서만 부른다).
  //   장마다 나레이션 mp3 를 틀고 소리 길이 + 0.8초 뒤 다음 장(소리가 없거나 실패면 글 길이로 4~7초). 그림은 천천히 확대·이동(켄 번스), 장 전환 0.6초 크로스페이드.
  //   소리가 막히면(자동 재생 거절) '소리 켜기' 버튼 — 누르면 그 장부터 소리. 끝나면 done(). 돌려주는 함수 = 멈추고 지우기(흐름 취소 때).
  //   파일 = Assets/_RO/Net/WebUI/prologue/<human|orc>_<1~5>.jpg·.mp3 → 웹 TemplateData/ro-onboarding/prologue/(WebGLNoUnityLogo 가 복사). 없으면 어두운 그라데이션·글 길이 시간
  $RoPrologue: function (race, done, hold) {   // hold = 새 캐릭터 흐름 — 끝나도 배경음을 끄지 않고 밤 전투 곡이 시작될 때까지 넘겨 둔다(window.__roPrologueHold, BgmPlayer 가 끈다 — 2026-11-22 사용자)
    var DIR = "TemplateData/ro-onboarding/prologue/";
    var PROLOGUE = {   // 임시 문구(UI 세션 2026-11-10, Concept/ui/prologue/prologue_draft.json) — 기획 문구가 오면 바꾼다. 그림 = GPT 2.6, 나레이션 = 사운드 세션
      human: [
        { img: "human_1.jpg", title: "빛의 왕국", text: "초원 너머 성벽 안, 인간들은 오래도록 평화를 누렸다.", voice: "human_1.mp3" },
        { img: "human_2.jpg", title: "북쪽의 그림자", text: "어느 밤, 붉은 황야의 오크들이 국경 마을을 불태웠다. 아이들의 울음은 아침까지 그치지 않았다.", voice: "human_2.mp3" },
        { img: "human_4.jpg", title: "협곡의 전쟁", text: "끊어질 듯한 다리 위에서, 두 종족의 피가 협곡 아래로 떨어진다.", voice: "human_4.mp3" },
        { img: "human_3.jpg", title: "기사들의 맹세", text: "살아남은 이들은 무너진 성문 앞에서 검을 들었다. 단 한 놈의 오크도 용서하지 않겠노라고.", voice: "human_3.mp3" },
        { img: "human_5.jpg", title: "새로운 모험가", text: "이제 당신의 차례다. 검을 쥐고, 저 초원으로 나서라.", voice: "human_5.mp3" }
      ],
      orc: [
        { img: "orc_1.jpg", title: "붉은 대지의 부족", text: "모래바람 부는 붉은 황야, 오크는 대대로 이 땅의 주인이었다.", voice: "orc_1.mp3" },
        { img: "orc_2.jpg", title: "탐욕스러운 인간", text: "철갑을 두른 인간들이 성지를 빼앗고 조상의 토템을 부쉈다.", voice: "orc_2.mp3" },
        { img: "human_4.jpg", flip: true, title: "협곡의 전쟁", text: "끊어질 듯한 다리 위에서, 우리는 인간의 피로 맹세를 갚는다.", voice: "orc_4.mp3" },
        { img: "orc_3.jpg", title: "피의 맹세", text: "핏빛 달 아래 족장이 포효했다. 인간의 성벽이 무너질 때까지 북은 멈추지 않는다.", voice: "orc_3.mp3" },
        { img: "orc_5.jpg", title: "젊은 전사여", text: "이제 너의 차례다. 도끼를 들고, 황야로 나서라.", voice: "orc_5.mp3" }
      ]
    };
    var orc = race === 1, list = PROLOGUE[orc ? "orc" : "human"];
    // 미리 깨운 오디오 요소(RoNewFlow 가 사용자 누름 안에서 한 번 재생해 둔 것) — 아이폰 사파리는 누름 안에서 재생한 적 있는 요소만 나중에 소리를 낸다(2026-11-11 사용자 "아이폰은 프롤로그 소리가 꺼져 있고 스피커를 눌러야 나온다")
    var PR = window.__roAudioPrime || null;
    // 장마다 카메라 [처음 x%, y%, 크기, 끝 x%, y%, 크기](2026-11-12 사용자 "그림이 너무 가만히 있다 — 스크롤·줌아웃") — 1 크게 줌아웃(드러냄) · 2 확 당겨 들어감 · 3 옆으로 훑기 · 4 반대로 훑으며 당김 · 5 줌아웃하며 위로.
    //   x·y 는 그림 크기의 % — 가로 그림이 세로 폰에선 가운데만 보이니 옆으로 훑으면 양옆이 지나간다. 크기 1.15 이상일 때만 크게 옮긴다(가장자리가 비지 않게). 처음 빠르고 끝 느리게(ease-out) 11초
    //   2026-11-12 사용자 "그림이 너무 커서 가운데만 보인다, 넓게" → 비교판(Concept/ui/prologue_fit/compare.jpg)을 보고 "지금 상태에서 50%만 줄여" —
    //   세로 화면은 그림 높이를 화면의 50%(예전 cover = 100%)로, 뒤는 같은 그림을 흐리고 어둡게 깔아 위아래 빈 곳을 채운다. 가로 화면은 그림 전체(contain).
    //   당기기는 작게(크기 1~1.12) — 크게 당기면 다시 가운데만 남는다. 세로 화면에선 그림이 화면보다 넓어 옆으로 훑기(±9%)는 그대로 양옆이 지나간다.
    var PAN = [[0, 0, 1.12, 0, 0, 1.0], [0, 0, 1.0, 0, -1, 1.1], [9, 0, 1.05, -9, 0, 1.05], [-8, 0, 1.08, 6, -1, 1.03], [0, -1, 1.1, 0, 0, 1.0]];   // 세로 옮김은 0 이하만(위에 붙인 그림 위로 틈이 안 생기게)
    //   같은 날 사용자 "80%만 줄이자" → 세로 화면 그림 높이 80%(50% 는 너무 작았다).
    //   2026-11-15 서버 세션(사용자 제보) — PC 는 기둥이 게임 캔버스 폭(세로)으로 좁아져 창 기준으로 보면 'contain' → 가로 그림이 기둥 위에 작게 붙었다. 기둥 가로세로로 판정
    // 세로 화면 옆 흐름(2026-11-15 사용자 "세로 뷰는 한 화면에 다 안 들어온다" → 시안 Concept/ui/prologue_v5/pan_board.jpg·pan_*.gif "좋아 반영") —
    //   세로 화면은 그림 폭의 약 40%만 보여, 나레이션 동안 보이는 창을 그림 위로 [시작, 끝](화면 가운데가 그림 폭의 어디, 0 왼끝~1 오른끝) 옮긴다. 끝 = 그 장의 핵심 장면
    var PANX = { human_1: [.25, .66],   /* 2026-11-20 그림 바꿈(시안 A — 왼쪽 성 → 오른쪽 성문 앞 축제·아이들) */ human_2: [.25, .62], human_3: [.77, .43], human_4: [.22, .62], human_5: [.73, .37],
                 orc_1: [.20, .66], orc_2: [.78, .30], orc_3: [.25, .57], orc_5: [.73, .43] };
    var panPos = function (img, k) {   // background-position-x(%) — 그림이 기둥보다 넓을 때만, 아니면 null
      var w = col ? col.clientWidth : 0, h = col ? col.clientHeight : 0, px = PANX[String(img).replace(/\.\w+$/, "")];
      if (!px || !(w > 0 && h > 0) || w >= h) return null;
      var pw = h * 1.5;   // 그림 3:2, 높이 꽉(2026-11-16 사용자 "70% 로 줄이고 위아래 양옆 여백을 2.6 으로 채워" — 원본은 그림 가운데 70%, 둘레는 그려 넣은 바깥)
      if (pw <= w + 1) return null;
      return Math.max(0, Math.min(100, ((.15 + .7 * px[k]) * pw - w / 2) / (pw - w) * 100));   // PANX 는 원본 기준 → 늘린 그림 기준(가운데 70%)
    };
    var picSize = function () { var w = col ? col.clientWidth : 0, h = col ? col.clientHeight : 0; if (!(w > 0 && h > 0)) { w = window.innerWidth; h = window.innerHeight; } return w < h ? "auto 100%" : "contain"; };
    var bg = orc ? "radial-gradient(ellipse at 50% 32%,#4a2a1e,#1a0d09 62%,#080403)" : "radial-gradient(ellipse at 50% 32%,#3a3326,#14100b 62%,#060504)";
    var root = document.createElement("div"); root.id = "ro-prologue";
    root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "프롤로그");
    // 바탕 = 로그인 카드와 같은 갈색 가죽 판 + 마름모 결(onboarding-fx 의 ro-tex-leather)(2026-11-10 사용자 "프롤로그 배경에도 로그인 화면의 멋진 배경 무늬")
    root.className = "ro-tex ro-tex-leather";
    root.style.cssText = "position:fixed;inset:0;z-index:10001;background:radial-gradient(ellipse at top,#71462c,#352014 80%);display:flex;justify-content:center;overflow:hidden;opacity:0;transition:opacity .6s;font-family:'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#fff1cd;word-break:keep-all;overflow-wrap:anywhere";
    var col = document.createElement("div");   // 휴대폰 세로 기준 9:16 기둥 — 넓은 화면에선 가운데
    col.style.cssText = "position:relative;width:min(100vw,56.25vh);height:100%;overflow:hidden;background:#0b0806";
    // 2026-11-11 사용자 "가로 좁은 폰에서 가로가 비어 보인다, 가로 더 넓게" → 사운드 세션이 가로 그림(1536×1024, 주인공은 가운데 1/3)으로 바꾼다.
    //   첫 장 그림이 가로면 기둥을 화면 전체로 펴서 그림이 화면을 채우게(cover — 세로 폰은 가운데만, 넓은 화면은 양옆까지). 세로 그림이면 지금 기둥 그대로
    // 2026-11-15 사용자 "PC 화면에서 프롤로그가 넓게 보인다, 게임 화면처럼 잘리게" — 펴는 폭 = 게임 캔버스가 실제로 보이는 폭(PC 는 세로 기둥).
    //   캔버스를 못 찾으면 터치 기기(폰·태블릿)만 화면 전체로, PC 는 9:16 기둥 그대로. 창 크기가 바뀌면 다시
    var wideCol = function () {
      var cv = document.getElementById("unity-canvas"), w = cv ? cv.getBoundingClientRect().width : 0;
      if (w > 0) col.style.width = Math.min(window.innerWidth, Math.round(w)) + "px";
      else if ((navigator.maxTouchPoints || 0) > 0 || ("ontouchstart" in window)) col.style.width = "100%";
      if (!col.__roResize) { col.__roResize = true; window.addEventListener("resize", function () { if (col.isConnected) wideCol(); }); }
    };
    (function () { var im = new Image(); im.onload = function () { if (im.naturalWidth > im.naturalHeight) wideCol(); }; im.src = DIR + list[0].img; })();
    root.appendChild(col);
    var dots = document.createElement("div");
    dots.style.cssText = "position:absolute;left:0;right:0;bottom:max(22px,env(safe-area-inset-bottom));display:flex;justify-content:center;gap:10px;z-index:3";
    var dotEls = list.map(function () { var d = document.createElement("span"); d.style.cssText = "width:9px;height:9px;border-radius:50%;background:#fff1cd44;transition:background .4s,transform .4s"; dots.appendChild(d); return d; });
    col.appendChild(dots);
    var soundBtn = document.createElement("button"); soundBtn.type = "button"; soundBtn.textContent = "🔊 소리 켜기";
    soundBtn.style.cssText = "position:absolute;top:max(14px,env(safe-area-inset-top));left:14px;z-index:4;display:none;font:inherit;font-size:14px;font-weight:800;padding:7px 14px;border:2px solid #C9963F;border-radius:999px;background:#2E2018dd;color:#fff1cd;cursor:pointer";
    col.appendChild(soundBtn);
    // 건너뛰기(2026-11-12 사용자 "5초 후 스킵 버튼 우상단에 슬쩍", 시안 B — Concept/ui/web_prologue_skip) — 처음 5초는 숨겼다가 옅은 글자만 0.8초에 걸쳐 스르륵. 누르면 finish()(어두워지며 다음 단계)
    var skipBtn = document.createElement("button"); skipBtn.type = "button"; skipBtn.innerHTML = "건너뛰기 <span style='font-size:18px;vertical-align:-1px'>›</span>";
    skipBtn.style.cssText = "position:absolute;top:max(16px,env(safe-area-inset-top));right:16px;z-index:4;font:inherit;font-size:15px;font-weight:700;padding:6px 4px;border:0;background:none;color:#fff1cd99;text-shadow:0 1px 4px #000;cursor:pointer;letter-spacing:.02em;opacity:0;transform:translateX(10px);pointer-events:none;transition:opacity .8s ease-out,transform .8s ease-out";
    col.appendChild(skipBtn);
    setTimeout(function () { if (finished) return; skipBtn.style.opacity = "1"; skipBtn.style.transform = "none"; skipBtn.style.pointerEvents = ""; }, 5000);
    skipBtn.onclick = function () { skipBtn.style.pointerEvents = "none"; finish(); };
    document.body.appendChild(root);
    requestAnimationFrame(function () { root.style.opacity = "1"; });
    var i = -1, timer = null, audio = null, soundOk = true, finished = false, layer = null;
    // 배경 음악(사운드 세션 bgm_<종족>.mp3, 60초) — 나레이션 아래 0.55 로 반복, 끝나면 1초 동안 줄여 끈다(2026-11-10)
    var bgm = null, BGM_VOL = 1, VOICE_VOL = 0.7;   // 2026-11-10 사용자 "프롤로그 목소리가 너무 크고 BGM 이 작다" — 배경음 0.55 → 1(최대), 나레이션 1 → 0.7
    var startBgm = function () {
      if (bgm || finished) return;
      var m = bgm = (PR && PR.bgm) ? PR.bgm : new Audio();
      m.src = DIR + "bgm_" + (orc ? "orc" : "human") + ".mp3"; m.muted = false;
      m.loop = true; m.volume = BGM_VOL;
      var p = m.play(); if (p && p.catch) p.catch(function () { if (bgm === m) bgm = null; });   // 막히면 '소리 켜기' 때 다시
    };
    var stopBgm = function (fade) {
      var m = bgm; bgm = null; if (!m) return;
      if (!fade) { try { m.pause(); } catch (_) {} return; }
      var t0 = Date.now(), v0 = m.volume;
      var tick = setInterval(function () { var k = Math.min(1, (Date.now() - t0) / 1000); m.volume = v0 * (1 - k); if (k >= 1) { clearInterval(tick); try { m.pause(); } catch (_) {} } }, 50);
    };
    var clearT = function () { clearTimeout(timer); timer = null; };
    var textTime = function (s) { return Math.min(7, Math.max(4, ((s.title || "").length + (s.text || "").length) / 12)) * 1000; };
    var stopAudio = function () { if (audio) { var a = audio; audio = null; a.onended = a.onerror = a.onloadedmetadata = null; try { a.pause(); a.removeAttribute("src"); a.load(); } catch (_) {} } };
    var next = function () { clearT(); stopAudio(); show(i + 1); };
    var byText = function (s) { clearT(); timer = setTimeout(next, textTime(s)); panGo(textTime(s) / 1000); };
    // 그림 흐름 = 이 장이 끝날 때 딱 맞게 끝나도록 길이를 안 순간 시작(2026-11-20 사용자 "나레이션 끝날 때까지 천천히 흘러 딱 맞게 끝나게 — 지금은 먼저 도착해 멈춘 채 나레이션이 이어진다")
    var panGo = function (sec) { if (panStart) { var f = panStart; panStart = null; f(Math.max(3, sec)); } }, panStart = null;
    // n 장 나레이션 — 끝나면 0.8초 뒤 다음 장, 파일이 없거나 실패면 글 길이 시간. 끝 알림이 안 와도 길이 + 2초(길이를 모르면 30초)에 넘긴다
    var playVoice = function (n) {
      var s = list[n];
      clearT(); stopAudio();
      if (!s.voice || !soundOk) { byText(s); return; }
      var a = audio = (PR && PR.voice) ? PR.voice : new Audio();
      a.src = DIR + s.voice; a.muted = false; a.loop = false;
      a.volume = VOICE_VOL;
      var fallback = function () { if (audio !== a) return; stopAudio(); byText(s); };
      a.onended = function () { if (audio !== a) return; clearT(); timer = setTimeout(next, 800); panGo(.8); };
      a.onerror = fallback;
      a.onloadedmetadata = function () { if (audio !== a) return; if (isFinite(a.duration) && a.duration > 0) { clearT(); timer = setTimeout(next, (a.duration + 2) * 1000); panGo(Math.max(0, a.duration - (a.currentTime || 0)) + .8); } };
      timer = setTimeout(next, 30000);
      var p = a.play();
      if (p && p.catch) p.catch(function (e) {
        if (audio !== a) return;
        if (e && e.name === "NotAllowedError") { soundOk = false; soundBtn.style.display = ""; }
        fallback();
      });
    };
    soundBtn.onclick = function () { soundOk = true; soundBtn.style.display = "none"; startBgm(); if (!finished && i >= 0) playVoice(i); };   // 그 장부터 소리
    var show = function (n) {
      if (finished) return;
      if (n >= list.length) { finish(); return; }
      i = n;
      var s = list[n], pan = PAN[n % PAN.length], px0 = panPos(s.img, 0), px1 = panPos(s.img, 1);
      if (px0 !== null) pan = [0, 0, 1.0, 0, 0, 1.04];   // 옆으로 흐르는 장은 켄 번스 옮김을 끄고 아주 작게만 커지게
      var old = layer;
      layer = document.createElement("div");
      layer.style.cssText = "position:absolute;inset:0;opacity:0;transition:opacity " + (n === 0 ? "1.4s" : ".6s") + ";z-index:1";   // 첫 장은 어둠에서 천천히
      var back = document.createElement("div");   // 뒤 = 같은 그림을 흐리고 어둡게 꽉 채움(그림 전체를 보여 줄 때 위아래·양옆 빈 곳)
      back.style.cssText = "position:absolute;inset:-8%;background:url('" + DIR + s.img + "') center/cover no-repeat," + bg + ";background-size:cover,cover;filter:blur(18px) brightness(.45) saturate(.9)";
      var pic = document.createElement("div");   // 앞 = 그림(세로 화면은 높이 50%), 글 자리를 피해 조금 위에 — 켄 번스는 작게
      pic.style.cssText = "position:absolute;inset:0;background:url('" + DIR + s.img + "') 50% 50%/" + picSize() + " no-repeat;transform-origin:50% 50%;will-change:transform;" +   // 위에 붙임(같은 날 사용자 "위쪽이 비어 있다, 올려서 상단에 붙이자") — 커지는 기준도 위 가운데
        "transform:translate(" + pan[0] + "%," + pan[1] + "%) scale(" + pan[2] + ")" + (px0 !== null ? ";background-position:" + px0 + "% 50%" : "");
      var shade = document.createElement("div");   // 아래 글 자리를 어둡게
      shade.style.cssText = "position:absolute;inset:0;background:linear-gradient(to bottom,transparent 56%,#050403cc 74%,#050403 94%)";   // 그림(위 25~55%)을 덜 가리게 어둡기를 아래로
      var words = document.createElement("div");
      words.style.cssText = "position:absolute;left:50%;transform:translateX(-50%);width:min(100%,56.25vh);box-sizing:border-box;bottom:calc(max(22px,env(safe-area-inset-bottom)) + 34px);padding:0 26px;text-align:center";   // 글은 넓은 화면에서도 기둥 폭 가운데
      var h = document.createElement("div"); h.textContent = s.title || "";
      h.style.cssText = "font-size:clamp(20px,6vw,26px);font-weight:900;color:#f3ca73;letter-spacing:-.02em;text-shadow:0 2px 6px #000;margin-bottom:10px";
      var t = document.createElement("div"); t.textContent = s.text || "";
      t.style.cssText = "font-size:clamp(15px,4.3vw,18px);font-weight:600;line-height:1.75;color:#fff1cd;text-shadow:0 1px 4px #000;white-space:pre-line";
      words.appendChild(h); words.appendChild(t);
      // 같은 그림을 두 종족이 같이 쓰는 장은 오크 쪽에서 좌우를 뒤집는다 — 내 편이 왼쪽(2026-11-20 사용자 "같은 그림 쓰자, 반전해서, 본인 편이 왼쪽에")
      var art = document.createElement("div"); art.style.cssText = "position:absolute;inset:0" + (s.flip ? ";transform:scaleX(-1)" : "");
      art.appendChild(back); art.appendChild(pic);
      layer.appendChild(art); layer.appendChild(shade); layer.appendChild(words);
      col.insertBefore(layer, dots);
      void pic.offsetWidth;
      requestAnimationFrame(function () { layer.style.opacity = "1"; });
      // 그림 흐름 = 나타나는 첫 프레임부터 움직이고, 사라지는 동안에도 멈추지 않고 이어 간다(2026-11-20 사용자 "스르륵 나오면서 이미 이동은 시작돼야, 사라지면서도 계속 이동") —
      //   예전엔 나레이션 길이를 안 뒤에야(첫 장 1초 넘게) 움직이고, 장 끝에 도착해 멈춘 채 흐려졌다. 이제 rAF 로 지금 자리에서 남은 시간 동안 같은 속도로 가며,
      //   길이를 알게 되면(panGo) 남은 시간만 고쳐 잡는다. 남은 시간 = 이 장이 끝날 때까지 + 사라지는 0.7초(다음 장이 겹쳐 흐려지는 동안도 이동)
      var pp = 0, rem = (n === 0 ? 13 : 11), last = 0;   // 길이를 끝내 모르면 예전 대략 값(나타남 대기 + 9~10초)
      var put = function () {
        var k = function (a, b) { return a + (b - a) * pp; };
        pic.style.transform = "translate(" + k(pan[0], pan[3]) + "%," + k(pan[1], pan[4]) + "%) scale(" + k(pan[2], pan[5]) + ")";
        if (px0 !== null) pic.style.backgroundPosition = k(px0, px1) + "% 50%";
      };
      var tick = function (now) {
        if (!pic.isConnected && last) return;   // 장이 지워지면 멈춤
        var dt = last ? Math.min(.1, (now - last) / 1000) : 0; last = now;
        if (pp < 1 && dt > 0) { pp = rem <= dt ? 1 : pp + (1 - pp) * dt / rem; rem -= dt; put(); }
        if (pp < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      var go = function (sec) { if (layer === myLayer) rem = sec + .7; }, myLayer = layer;   // 같은 속도로(2026-11-16 사용자 "가감 없이 같은 속도") — 남은 시간만 고침
      panStart = go;
      if (old) { old.style.opacity = "0"; setTimeout(function () { old.remove(); }, 700); }
      dotEls.forEach(function (d, k) { d.style.background = k === n ? "#FFD966" : k < n ? "#C9963F" : "#fff1cd44"; d.style.transform = k === n ? "scale(1.3)" : ""; });
      if (list[n + 1]) { var pre = new Image(); pre.src = DIR + list[n + 1].img; }
      if (n === 0) { clearT(); timer = setTimeout(function () { if (!finished && i === 0) playVoice(0); }, 900); }   // 첫 나레이션은 그림이 반쯤 밝아진 뒤
      else playVoice(n);
    };
    var finish = function () {
      if (finished) return;
      finished = true; clearT(); stopAudio();
      if (hold && bgm) { window.__roPrologueHold = bgm; bgm = null; } else stopBgm(true);   // 2026-11-22 사용자 "프롤로그 끝나고 마을 곡 말고 비장한 곡을 로딩 동안 계속, 밤 전투 곡이 시작되기 전까지"
      root.style.opacity = "0"; setTimeout(function () { root.remove(); }, 650);
      done();
    };
    // 영화관처럼(2026-11-11 사용자 "너무 급작스레 시작해 초반 음성이 잘린다 — 화면이 어두운 채 소리가 먼저, 그다음 화면") —
    //   어두운 화면에서 배경음이 1.5초 동안 차오르고(아이폰은 volume 을 무시해 바로 최대), 1.6초 뒤 첫 장이 1.4초에 걸쳐 밝아지며, 그 0.9초 뒤 나레이션
    startBgm();
    if (bgm) { var b0 = Date.now(); bgm.volume = 0; var up = setInterval(function () { var k = Math.min(1, (Date.now() - b0) / 1500); if (bgm) bgm.volume = BGM_VOL * k; if (k >= 1 || !bgm) clearInterval(up); }, 50); }
    timer = setTimeout(function () { show(0); }, 1600);
    return function () { if (finished) return; finished = true; clearT(); stopAudio(); stopBgm(false); root.remove(); };
  },

  // 새로 시작(2026-11-10 사용자 시안 Concept/ui/newchar_flow/flow.png) — 1 종족 → 2 성별 → 3 이름·비밀번호(카드 둘) → 4 사진 → 5 목소리 녹음(녹음만, 건너뛰기 가능)
  //   → 6 세계관 프롤로그(RoPrologue, 건너뛰기 없음) → 7 얼굴·목소리 확인 한 화면 → 바로 접속.
  //   사진을 고르는 즉시 얼굴 서버(페이지 옆 face.txt 의 주소)에 올려 생성을 시작한다(긴 쪽 1024 로 줄여서).
  //   사진 단계를 마치면 NetSession.OnHtmlNewStart(JSON {name,pin,gender,race,job}) — 사진이 있으면 올리기 응답(job)이 오는 대로(녹음을 막지 않고) 보낸다.
  //   확인 화면 = 사진이 있으면 생성 얼굴만(아직이면 생성 진행을 먼저), 사진 없이면 기본 얼굴만 + '목소리 듣기'(내 목소리 intro / 기본 견본).
  //   '모험 시작' = (목소리 작업이 끝났으면 POST /voice/pick → NetSession.OnHtmlVoice(번호)) → OnHtmlHeadScale → NetSession.OnHtmlFace(face) = 접속.
  //   얼굴이 둘 다 실패하면 "얼굴을 만들지 못했습니다" → 사진만 다시 올려 같은 기다림·확인으로(이름·성별·종족·목소리는 기억).
  $RoNewFlow__deps: ["$RoCard", "$RoEntryUI", "$RoVoiceStep", "$RoPrologue", "$RoQueueWait", "$RoQueueScene", "$RoKeepPref"],
  // 로그인 유지 선택(로그인 카드 체크 칸, 기본 켬) — 새로 시작도 같은 값을 OnHtmlNewStart keep 으로 보낸다(2026-11-12 서버 세션 규격)
  $RoKeepPref: function () { try { return localStorage.getItem("ro_remember_pref") === "0" ? 0 : 1; } catch (_) { return 1; } },

  $RoNewFlow: function (defName, resume) {
    // 프롤로그 소리 미리 깨우기 — 새로 시작 흐름의 아무 누름 안에서 배경음·나레이션 요소를 소리 없이 한 번 재생했다 멈춰 둔다(아이폰 자동 재생 막힘 피하기, 안 되면 프롤로그의 '소리 켜기' 버튼이 그대로 남음)
    if (!window.__roAudioPrime) {
      var PR = window.__roAudioPrime = { bgm: new Audio(), voice: new Audio() };
      var SILENT = "data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";
      var prime = function (el, src) {
        if (el.__primed || el.__priming) return;
        try {
          el.__priming = true; el.muted = true; el.src = src;
          var p = el.play();
          // 음소거를 여기서 풀지 않는다 — 사파리는 pause 가 늦게 먹어 푼 순간 끝부분이 새어 나왔다(2026-11-11 사용자 "아이폰에서 종족 고를 때 잠깐씩 프롤로그 나레이션이 들린다"). 소리는 RoPrologue 가 쓸 때 푼다.
          var ok = function () { try { el.pause(); el.currentTime = 0; } catch (_) {} el.__primed = true; el.__priming = false; };
          if (p && p.then) p.then(ok, function () { el.__priming = false; }); else ok();
        } catch (_) { el.__priming = false; }
      };
      var onTap = function () {
        prime(PR.bgm, SILENT); prime(PR.voice, SILENT);   // 진짜 곡·나레이션 대신 0.1초 무음으로 깨운다 — 요소만 깨워 두면 RoPrologue 가 src 를 바꿔 쓴다
        if (PR.bgm.__primed && PR.voice.__primed) { document.removeEventListener("pointerup", onTap, true); document.removeEventListener("touchend", onTap, true); }
      };
      document.addEventListener("pointerup", onTap, true); document.addEventListener("touchend", onTap, true);
    }
    var entry = RoEntryUI().ensure();
    entry.cancel();
    var st = { name: defName || "", pin: "", gender: 0, race: null, detail: 0, acc: [], noPhoto: false, photoNotice: "", job: "", up: null, base: null, sent: false, thumb: null, voiceRec: null, started: false, newStart: null, voice: null, voiceUploads: 0, prologueStop: null };   // started = 사진 단계를 마침(OnHtmlNewStart 보냄·보내는 중 = newStart), voice = 녹음 목소리 작업 상태 / voiceRec = 미리 녹음한 목소리 작업({job,uploads}) / "" 건너뜀 / null 아직
    // 아이폰 사파리는 사진첩·카메라 앱을 여는 동안 메모리가 큰 이 탭을 새로 열 때가 있다(2026-11-10 아이폰 사용자 "사진 보관함에서 넣으면 처음으로").
    //   열기 직전에 지금까지 고른 것을 이 탭(sessionStorage)에만 적어 두고, 새로 열리면 로그인 카드 대신 사진 단계로 바로 돌아온다(RoLoginOpen). 사진이 들어오면 지운다
    var saveResume = function () {
      try { sessionStorage.setItem("ro_photo_resume", JSON.stringify({ t: Date.now(), name: st.name, pin: st.pin, gender: st.gender, race: st.race, detail: st.detail, acc: st.acc, fails: st.photoFails || 0 })); } catch (_) {}
    };
    var clearResume = function () { try { sessionStorage.removeItem("ro_photo_resume"); } catch (_) {} };
    // 사진·셀카 단계 동안 뒤 게임을 저전력으로(WebLowPower.cs — 프레임 2·안 쓰는 메모리 비움, 아이폰 탭 새로 열림 줄이기)
    var lowPower = function (on) { try { SendMessage("WebLowPower", "OnHtmlLowPower", on ? "1" : "0"); } catch (_) {} };
    var getBase = function () {
      if (st.base) return Promise.resolve(st.base);
      return fetch("face.txt", { cache: "no-store" }).then(function (r) {
        if (!r.ok) throw new Error("face.txt " + r.status);
        return r.text();
      }).then(function (t) { st.base = t.trim().replace(/\/+$/, ""); return st.base; });
    };
    // 휴대폰 사진(수 MB)을 긴 쪽 1024 로 줄여 올린다 — 투명 PNG(캐릭터 그림)는 PNG 그대로
    var shrink = function (file) {
      // 먼저 작게 풀어 본다(가로 1024 — 12MP 사진을 다 풀면 48MB 라 아이폰에서 탭이 죽을 수 있다). 못 하는 브라우저는 아래 원래 방식
      if (window.createImageBitmap && file.type !== "image/png") {
        return createImageBitmap(file, { resizeWidth: 1024, resizeQuality: "high", imageOrientation: "from-image" }).then(function (bmp) {
          if (!bmp || bmp.width > 1100) { if (bmp && bmp.close) bmp.close(); throw new Error("resize 무시됨"); }
          return new Promise(function (done) {
            var s = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
            var cv = document.createElement("canvas");
            cv.width = Math.max(1, Math.round(bmp.width * s)); cv.height = Math.max(1, Math.round(bmp.height * s));
            cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
            if (bmp.close) bmp.close();
            cv.toBlob(function (b) { done(b || file); }, "image/jpeg", 0.92);
          });
        }).catch(function () { return shrinkImg(file); });
      }
      return shrinkImg(file);
    };
    var shrinkImg = function (file) {
      return new Promise(function (done) {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          var s = Math.min(1, 1024 / Math.max(img.width, img.height));
          var cv = document.createElement("canvas");
          cv.width = Math.max(1, Math.round(img.width * s)); cv.height = Math.max(1, Math.round(img.height * s));
          cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
          URL.revokeObjectURL(url);
          var type = file.type === "image/png" ? "image/png" : "image/jpeg";
          cv.toBlob(function (b) { done(b || file); }, type, 0.92);
        };
        img.onerror = function () { URL.revokeObjectURL(url); done(file); };
        img.src = url;
      });
    };
    // 기본 얼굴 미리보기를 미리 받아 둔다(2026-11-09 사용자 "프리셋 얼굴 미리보기 처음 한 번이 느리다") — 얼굴 서버가 no-store 라
    //   브라우저 캐시 대신 받은 그림을 객체 URL 로 들고 있다가 고르기 화면이 같은 주소면 그대로 쓴다. 성별·종족이 정해질 때마다 그 조합 3장(머리 100%)
    var presetHeads = function () {
      var prefix = "head_" + (st.gender === 1 ? "female" : "male") + "_" + (st.race === 1 ? "orc" : "human") + "_";
      return [prefix + "00", prefix + "01", prefix + "02"];
    };
    var preCache = {};   // 주소 → Promise<객체 URL | "">
    var uploadEpoch = 0, uploadAbort = null;
    var discardJob = function (job) {
      if (job && st.base) fetch(st.base + "/face/discard?job=" + encodeURIComponent(job), { method: "POST" }).catch(function () {});
    };
    var upload = function (file) {
      var race = st.race, detail = st.detail, gender = st.gender, acc = st.acc.join(","), epoch = ++uploadEpoch;
      if (race !== 0 && race !== 1) return;
      if (uploadAbort) uploadAbort.abort();
      if (st.faceQueue) { st.faceQueue.cancel(); st.faceQueue = null; }
      st.faceQ = null;
      var controller = uploadAbort = new AbortController();
      discardJob(st.job); st.job = ""; st.upErr = 0;
      var stale = function () { return epoch !== uploadEpoch || race !== st.race || detail !== st.detail || gender !== st.gender || acc !== st.acc.join(","); };
      var startUrl = "", sent = null, base = "";
      // 응답이 끝내 안 오면(터널 지연) 생성 화면에 갇히지 않게 60초에 끊는다(2026-11-06 감사 A16)
      var post = function () {
        var upTimer = setTimeout(function () { controller.abort(); }, 60000);
        return fetch(startUrl, { method: "POST", headers: RoEntryUI().devHeaders({ "Content-Type": sent.type || "image/jpeg" }), body: sent, signal: controller.signal })
          .then(function (r) { clearTimeout(upTimer); return r; }, function (e) { clearTimeout(upTimer); throw e; });
      };
      var take = function (r) {
        if (!r) return "";
        if (r.status === 202) return r.json().then(queueUp);
        if (!r.ok) { if (epoch === uploadEpoch) st.upErr = r.status; throw new Error("start " + r.status); }
        return r.json().then(function (j) { return j && j.job || ""; });
      };
      // 줄 서기(2026-11-10) — 차례가 오면 그 작업으로, 자리가 사라지면(15초 못 물음 등) 같은 사진으로 다시 줄을 선다, 그만두면 ""
      var queueUp = function (q) {
        if (stale() || !q || !q.ticket) return "";
        var qw = st.faceQueue = RoQueueWait(base, "face", q, function (pos, wait) {
          if (qw && st.faceQueue !== qw) return;   // 첫 알림은 RoQueueWait 안에서 qw 가 정해지기 전에 온다
          st.faceQ = { pos: pos, wait: wait };
          if (st.faceQueueUi) st.faceQueueUi(pos, wait);
          if (loadUi) loadUi(0, "얼굴 만들기 줄을 서는 중 · " + (pos > 1 ? "앞에 " + (pos - 1) + "명" : "곧 내 차례"), false);
        });
        if (waiting) wait();   // 진행 화면을 보고 있었으면 줄 서기 화면으로
        return qw.promise.then(function (res) {
          if (st.faceQueue === qw) st.faceQueue = null;
          if (res.cancelled) return "";
          if (stale()) { if (res.job) discardJob(res.job); return ""; }
          if (res.gone) {
            if (st.faceQueueNote) st.faceQueueNote("자리가 사라져 다시 줄을 서는 중…");
            return post().then(take);
          }
          st.faceQ = null;
          return new Promise(function (ok) {
            var tf = st.faceQueueTurn;
            if (!tf || !tf(function () { ok(res.job); })) ok(res.job);   // 줄 서기 화면이 보이면 '내 차례' 연출 뒤에
          });
        });
      };
      st.up = getBase().then(function (b) {
        base = b;
        // 나만의 캐릭터 의상(2026-11-21) — 의상 사진이 있으면 얼굴 사진 뒤에 이어 붙이고 olen(끝 바이트 수)·memo 로 알린다. 서버가 얼굴·의상을 한 장으로 만든다
        var outfit = st.outfit && (st.outfit.file || st.outfit.text) ? st.outfit : null;
        return Promise.all([shrink(file), outfit && outfit.file ? shrink(outfit.file) : null]).then(function (blobs) {
          if (stale()) return null;
          var blob = blobs[0], ob = blobs[1];
          sent = ob ? new Blob([blob, ob], { type: blob.type || "image/jpeg" }) : blob;
          startUrl = b + "/face/start?race=" + race + "&gender=" + gender + "&detail=" + detail + (acc ? "&acc=" + acc : "") +
            (ob ? "&olen=" + ob.size + (outfit.memo ? "&memo=" + encodeURIComponent(outfit.memo.slice(0, 60)) : "")
              : outfit && outfit.memo ? "&otext=1&memo=" + encodeURIComponent(outfit.memo.slice(0, 60)) : "");   // 말로 설명 — 사진 없이 글만
          return post();
        });
      }).then(take).then(function (job) {
        job = job || "";
        if (stale()) { discardJob(job); return ""; }
        st.job = job; return job;
      }).catch(function (e) { if (epoch === uploadEpoch) { console.warn("[얼굴] 올리기 실패", e); st.job = ""; st.faceQ = null; } return ""; });
    };

    var c = RoCard(5);
    var showPhoto, showName, showPin, showGender, showRace;
    var wrapRaceOff = function () { c.wrap.classList.remove("ro-race-card"); };
    var disposePreview = null;

    // 카메라(PC 사진 찍기)는 사진 카드를 벗어날 때 꼭 끈다
    var stopCam = function () {
      if (st.stream) { st.stream.getTracks().forEach(function (t) { t.stop(); }); st.stream = null; }
    };
    // 종족/품질 변경은 유료 생성을 자동 재시작하지 않고 명시적인 사진 재선택을 요구한다.
    var invalidatePhoto = function () {
      uploadEpoch++; if (uploadAbort) uploadAbort.abort(); uploadAbort = null;
      stopCam(); clearFaceProgress(); if (disposePreview) disposePreview();
      if (st.faceQueue) { st.faceQueue.cancel(); st.faceQueue = null; } st.faceQ = null;
      discardJob(st.job); st.job = ""; st.up = null; st.sent = false;
      result = null; waiting = false; lastPct = 0;
      if (st.thumb) URL.revokeObjectURL(st.thumb); st.thumb = null; st.faceFile = null;
    };
    // 고른·찍은 사진 하나로 — 미리보기 그림을 잡아 두고 올리기를 시작한 뒤 다음 단계(다시 올리기면 바로 기다림)
    // 사진을 넣으면 카드 위에 초록 판(큰 체크 원 + 글)을 잠깐 띄우고 다음으로(2026-11-24 사용자 "넣으면 확실하게 들어갔다고 표시 — 사진 이미지 말고 도형으로, 녹색으로")
    // 사진을 넣으면 사진 칸만 초록 테두리 + 작은 체크 + 글로 0.8초 보이고 다음으로(2026-11-24 사용자 "넣으면 확실하게 들어갔다고 — 도형으로, 녹색으로"
    //   → 2026-11-25 "너무 크게 나온다, 얌전하게" 시안 A: 카드 전체를 덮던 초록 판 대신 칸 안에서만)
    var showInserted = function (label, then, box) {
      if (!box || !box.isConnected) { then(); return; }
      box.style.borderColor = "#4fe36a"; box.style.boxShadow = "0 0 10px rgba(79,227,106,.45)";
      box.innerHTML = "<span style='display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;background:#3fd65c;color:#fff;font-size:24px;font-weight:900'>&#10003;</span>" +
        "<span style='font-size:15px;font-weight:700;color:#bff5c8'>" + label + "</span>";
      setTimeout(then, 800);
    };
    var usePhoto = function (f) {
      clearResume();
      stopCam();
      if (st.race !== 0 && st.race !== 1) { showRace(); return; }
      if (st.thumb) URL.revokeObjectURL(st.thumb);
      st.thumb = URL.createObjectURL(f); st.photoNotice = ""; st.noPhoto = false;
      if (st.mode === "custom" && !st.started) { st.faceFile = f; showInserted("얼굴 사진을 넣었어요", showOutfit, st.photoBox); return; }   // 나만의 캐릭터 = 얼굴과 의상을 한 번에 만든다 — 의상 단계까지 받은 뒤 올린다
      upload(f);
      startFaceProgress();
      if (st.started) { c.wrap.remove(); wait(); } else afterPhoto();   // 2026-11-10 사진 다음 = 목소리 녹음(이름·비번은 사진 앞으로)
    };
    var touch = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

    // ── 4 사진 — '사진 찍기'(휴대폰 = 전면 카메라 바로, PC = 카드 안 카메라 미리보기) · '이미지 넣기'(사진첩·파일) ──
    // 4 얼굴은 선택(2026-11-11 사용자 "얼굴 이미지 만드는 것도 스킵할지 만들지 물어보자, 사운드처럼") — [사진으로 만들기] = 사진 카드,
    //   [건너뛰기] = 사진 카드의 '사진 없이 진행'과 같은 길(기본 얼굴 → 목소리 물음 → 프롤로그 → 7 확인에서 기본 얼굴 고르기)
    // 물음 카드(얼굴·목소리)의 두 버튼을 나란히 큰 정사각 타일로 — 아이콘 + 글(2026-11-13 사용자 "사진 만들기·기본 사진 버튼 두껍게" → 시안 B, "사운드도 해당 정사각 버튼으로", Concept/ui/face_ask_btn/)
    var askTiles = function (list) {   // [[버튼, 아이콘 svg 안쪽, 글(<br> 가능), 그림 주소(있으면 svg 대신 — 글 위·그림 아래 긴 타일)], ...]
      var tiles = document.createElement("div");
      tiles.style.cssText = "display:flex;gap:12px;margin-top:20px";
      list.forEach(function (t) {
        if (t[3]) {
          // 2026-11-22 사용자 시안 C(Concept/ui/make_choice/draft_C.png) "버튼 팝업 크기 키우고 나만의·랜덤 뜻에 맞는 귀여운 그림" — 글 위, 그림 아래, 타일을 세로로 길게
          t[0].innerHTML = "<div style='line-height:1.2;margin-top:4px'>" + t[2] + "</div>" +
            "<img alt='' draggable='false' src='" + t[3] + "' style='display:block;flex:0 0 auto;width:100%;height:auto;max-height:62%;object-fit:contain;margin-top:4px;pointer-events:none;filter:drop-shadow(0 4px 5px #0006)'>";
          t[0].style.cssText += ";flex:1;margin:0!important;height:min(300px,46vh);display:flex;flex-direction:column;align-items:center;justify-content:space-evenly;font-size:24px!important;padding:14px 4px 10px!important;box-sizing:border-box";
        } else {
          t[0].innerHTML = "<svg width='34' height='34' viewBox='0 0 64 64' fill='none' stroke='currentColor' stroke-width='5' stroke-linecap='round' stroke-linejoin='round'>" + t[1] + "</svg>" +
            "<div style='margin-top:8px;line-height:1.25'>" + t[2] + "</div>";
          t[0].style.cssText += ";flex:1;margin:0!important;height:132px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:20px!important;padding:0!important";
        }
        tiles.appendChild(t[0]);
      });
      c.card.appendChild(tiles);
    };
    // 외부 서비스 크레딧이 떨어져 만들기가 안 되는 동안엔 물음 카드에서 미리 알린다(2026-11-14 사용자 "소진이 찍히면 이미지 생성·보이스 생성에 아예 표시를 해서
    //   작동 안 한다고 알려 주자" — 그날 얼굴·목소리가 전부 '만들지 못했어요'로만 떠 원인을 못 찾았다). 얼굴 서버 GET /service/status → {"face":"ok"|"credit","voice":…}.
    //   주소가 없거나(옛 서버) 못 물으면 평소대로 둔다. 눌러서 만들 타일만 잠그고 건너뛰기 타일은 그대로.
    var serviceDown = function (kind, btn, card, text) {
      getBase().then(function (b) { return fetch(b + "/service/status", { cache: "no-store" }); })
        .then(function (r) { return r.ok ? r.json() : {}; })
        .then(function (j) {
          if (!j || j[kind] !== "credit" || !btn.isConnected) return;
          btn.disabled = true; btn.onclick = null;
          btn.style.opacity = "0.4"; btn.style.pointerEvents = "none";
          var label = btn.querySelector("div"); if (label) label.innerHTML = "지금은<br>쓸 수 없어요";
          var note = document.createElement("div");
          note.style.cssText = "margin-top:14px;font-size:14px;line-height:1.5;color:#ffd9a0;text-align:center";
          note.textContent = text;
          var bk = card.querySelector(".ro-step-back"); if (bk) bk.before(note); else card.appendChild(note);   // 뒤로가기 버튼 위에
        }).catch(function () {});
    };
    // 관리 툴에서 끈 기능(얼굴 서버 /service/status 의 "off")은 그 물음 카드부터 아예 건너뛴다(2026-11-14 사용자 "꺼 두면 얼굴 생성·보이스 생성 화면이 아예 안 나오게").
    //   흐름을 열 때 한 번 묻고, 물음 카드 차례에 아직 답이 없으면 2.5초까지 기다린다(못 물으면 평소대로 보여 줌 — 서버가 만들기를 거절한다).
    var svcOff = { face: false, voice: false };
    var svcReady = new Promise(function (done) {
      var t = setTimeout(done, 2500);
      getBase().then(function (b) { return fetch(b + "/service/status", { cache: "no-store" }); })
        .then(function (r) { return r.ok ? r.json() : {}; })
        .then(function (j) { if (j) { svcOff.face = j.face === "off"; svcOff.voice = j.voice === "off"; } clearTimeout(t); done(); }, function () { clearTimeout(t); done(); });
    });
    var askFace = function () {
      if (!svcReady.done) { svcReady.then(function () { svcReady.done = true; askFace(); }); return; }
      if (svcOff.face) { stopCam(); invalidatePhoto(); st.noPhoto = true; st.photoNotice = ""; afterPhoto(); return; }   // 얼굴 만들기 꺼짐 = '기본 얼굴로'를 누른 것과 같은 길
      stopCam();
      // 2026-11-21 사용자 "얼굴·사운드를 나눠 물었는데 통합 — 나만의 캐릭터 or 기본 캐릭터, 버튼 두 개로" — 나만의 = 얼굴 사진 → 바로 녹음(목소리 물음 없음),
      //   기본 = 사진·녹음 없이 기본 얼굴 고르기로(예전 '기본 얼굴로' + '기본 목소리로'를 한 번에) → 2026-11-21 '랜덤 캐릭터' = 기본 머리 셋 중 무작위, 고르기 화면 없음
      st.mode = null;
      c.card.innerHTML = c.raceShell(5, "어떻게 만들까요?", "", 7);
      c.anim();
      var make = c.mainBtn("나만의 캐릭터"); make.type = "button"; make.classList.add("ro-race-next");
      make.onclick = function () { st.mode = "custom"; showPhoto(); };
      var no = c.defaultFaceBtn("랜덤 캐릭터"); no.classList.add("ro-face-ask-skip");
      no.onclick = function () { st.mode = "preset"; invalidatePhoto(); st.noPhoto = true; st.photoNotice = ""; afterPhoto(); };
      askTiles([[make, "<rect x='6' y='16' width='52' height='38' rx='7'/><path d='M22 16 l5 -7 h10 l5 7'/><circle cx='32' cy='35' r='10'/>", "나만의<br>캐릭터", "TemplateData/ro-onboarding/make/make_custom.webp"],
                [no, "<circle cx='32' cy='32' r='24'/><circle cx='24' cy='28' r='2.5' fill='currentColor'/><circle cx='40' cy='28' r='2.5' fill='currentColor'/><path d='M22 40 q10 9 20 0'/>", "랜덤<br>캐릭터", "TemplateData/ro-onboarding/make/make_random.webp"]]);   // 마법 거울 = 내 얼굴로 / 마법 모자 = 무작위(시안 C)
      c.card.appendChild(c.stepBack(showPin));   // 뒤로가기 = 3 비밀번호
      serviceDown("face", make, c.card, "나만의 캐릭터 만들기가 잠시 멈췄어요 · 랜덤 캐릭터로 시작해 주세요");
    };
    showPhoto = function () {
      stopCam();
      lowPower(true);
      c.card.innerHTML = c.raceShell(5, "얼굴 사진", "원하는 얼굴 이미지를 넣어 주세요", 7);
      c.anim();
      var detailBox = document.createElement("label");
      detailBox.style.cssText = "display:flex;align-items:center;gap:10px;color:#EBDDBC;font-size:16px;padding:6px 0;cursor:pointer";
      var detailCheck = document.createElement("input"); detailCheck.type = "checkbox"; detailCheck.checked = st.detail === 1;
      detailCheck.style.cssText = "width:22px;height:22px;flex-shrink:0;accent-color:#F2C77A";
      detailCheck.setAttribute("aria-label", "디테일하게 만들기");
      var detailText = document.createElement("span"); detailText.textContent = "디테일하게 만들기";
      detailBox.appendChild(detailCheck); detailBox.appendChild(detailText);
      var detailHint = document.createElement("div");
      detailHint.style.cssText = "font-size:13px;color:#EBDDBC;opacity:.75;line-height:1.5;margin-bottom:10px";
      detailHint.textContent = "체크하면 생성에 시간이 걸립니다. 더 디테일하게 적용됩니다.";
      var detailMode = document.createElement("div");
      detailMode.style.cssText = "font-size:13px;color:#EBDDBC;line-height:1.5;margin-bottom:10px;overflow-wrap:anywhere";
      detailMode.textContent = (st.detail === 1 ? "선택한 생성 방식: 상세 생성" : "기본 생성 방식: 빠른 생성") + (st.photoNotice ? " · " + st.photoNotice : "");
      detailCheck.onchange = function () {
        var nextDetail = detailCheck.checked ? 1 : 0;
        if (nextDetail === st.detail) return;
        var hadPhoto = !!st.up || !!st.thumb;
        invalidatePhoto(); st.detail = nextDetail;
        st.photoNotice = hadPhoto ? "설정을 바꿨습니다. 사진을 다시 선택해 주세요." : "";
        showPhoto();
      };
      // 얼굴 꾸미기(2026-11-10 사용자 "얼굴 코스튬 — 안경·수염·피어싱·점") — 여러 개 고르는 칩, 고른 것은 생성 프롬프트에 들어간다(서버 acc).
      //   사진을 고르는 순간 생성이 시작되므로 '디테일'처럼 사진 전에 정한다 — 사진을 넣은 뒤 바꾸면 사진을 다시 고르게 한다. 안경·선글라스는 하나만
      //   2026-11-17 시안 C(Concept/ui/face_deco/draft_C.png, 사용자 "이대로 넘기기") — 작은 칸 5개씩 두 줄: 밝은 양피지 받침 위 아이콘 + 아래 작은 이름,
      //   고르면 금테 두께·오른쪽 위 체크 원·밝아짐, 안 고르면 어두운 칸. 열 번째 흉터(scar) 추가(얼굴 서버 허용 목록은 서버 세션 e3b6cfcbd).
      //   아이콘 = 한 장 스프라이트 TemplateData/ro-onboarding/face_deco.webp(96px 칸 5×2, 순서 = 아래 목록 — Concept/ui/face_deco/make_sheet.py)
      //   좁은 휴대폰(360 폭)에선 칸이 50px 보다 좁아진다 — 받침은 칸 폭까지 줄고, 이름은 한 줄 그대로 칸 폭(26cqi)에 맞춰 글자가 작아진다
      if (!document.getElementById("ro-deco-style")) {
        var decoCss = document.createElement("style"); decoCss.id = "ro-deco-style";
        decoCss.textContent = ".ro-deco-head{display:flex;align-items:baseline;gap:8px;margin:18px 0 4px;padding-top:14px;border-top:1px dashed #C9963F55}" +
          ".ro-deco-head b{font-size:21px;font-weight:900;color:#ffe18b;text-shadow:0 2px #3b1c0b;letter-spacing:-.02em}.ro-deco-head small{font-size:14px;font-weight:700;color:#f3d5a0}" +
          ".ro-deco-note{font-size:12.5px;font-weight:700;color:#EBDDBC;opacity:.72;margin-bottom:10px}" +
          ".ro-deco-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px;padding:6px 2px 0}" +
          ".ro-deco-tile{position:relative;box-sizing:border-box;width:100%;margin:0;font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;border-radius:12px;border:2px solid #6b4426;" +
          "background:linear-gradient(#4a2f1e,#2a1a11);box-shadow:inset 0 2px #ffffff12,0 3px 0 #1a0f09;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:6px 2px;color:#e6d3ae;container-type:inline-size}" +
          ".ro-deco-plate{width:min(50px,100%);aspect-ratio:1;border-radius:12px;overflow:hidden;background:radial-gradient(circle at 50% 42%,#f6ead0 0,#e6d2a6 60%,#cdb07a 100%);" +
          "box-shadow:inset 0 -3px 0 #a9874f,0 2px 4px #0006;display:flex;align-items:center;justify-content:center;filter:saturate(.75) brightness(.86)}" +
          ".ro-deco-plate i{display:block;width:84%;height:84%;background:url(TemplateData/ro-onboarding/face_deco.webp) 0 0/500% 200% no-repeat}" +
          ".ro-deco-nm{margin-top:5px;font-size:11.5px;font-size:min(11.5px,26cqi);white-space:nowrap;font-weight:800;letter-spacing:-.04em;line-height:1.15;text-align:center;min-height:2.3em;display:flex;align-items:center}" +
          ".ro-deco-tile.ro-deco-on{border:3px solid #ffe18b;padding:5px 1px;background:linear-gradient(#8a5a33,#5a3720);box-shadow:0 0 14px #f5bd4daa,inset 0 0 0 1px #fff2b5,0 3px 0 #1a0f09;color:#fff6dc}" +
          ".ro-deco-on .ro-deco-plate{filter:none;box-shadow:inset 0 -3px 0 #a9874f,0 0 0 3px #f5bd4d,0 2px 6px #0007}.ro-deco-on .ro-deco-nm{color:#ffe9a8}" +
          ".ro-deco-on::after{content:'\\2713';position:absolute;right:-6px;top:-6px;width:20px;height:20px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#ffd36b,#df9d28 70%);" +
          "border:2px solid #fff3c6;color:#4a2306;font-size:13px;font-weight:900;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 4px #0008}";
        document.head.appendChild(decoCss);
      }
      var accBox = document.createElement("div");
      accBox.innerHTML = "<div class='ro-deco-head'><b>얼굴 꾸미기</b><small>(여러 개 골라도 돼요)</small></div><div class='ro-deco-note'>다시 누르면 빠져요</div>";
      var accGrid = document.createElement("div"); accGrid.className = "ro-deco-grid"; accBox.appendChild(accGrid);
      var accChips = {};
      var paintChip = function (chip, on) {
        chip.setAttribute("aria-pressed", on ? "true" : "false");
        chip.classList.toggle("ro-deco-on", on);
      };
      [["glasses", "안경"], ["sunglasses", "선글라스"], ["mustache", "콧수염"], ["beard", "턱수염"], ["lip_piercing", "입술 피어싱"],
        ["brow_piercing", "눈썹 피어싱"], ["nose_piercing", "코 피어싱"], ["earrings", "귀걸이"], ["mole", "애교점"], ["scar", "흉터"]].forEach(function (a, i) {
        var chip = document.createElement("button"); chip.type = "button"; chip.className = "ro-deco-tile ro-tex ro-tex-leather";
        chip.setAttribute("aria-label", a[1]);
        chip.innerHTML = "<span class='ro-deco-plate'><i style='background-position:" + (i % 5) * 25 + "% " + (i < 5 ? 0 : 100) + "%'></i></span><span class='ro-deco-nm'>" + a[1].replace(" ", "<br>") + "</span>";
        paintChip(chip, st.acc.indexOf(a[0]) >= 0);
        chip.onclick = function () {
          var on = st.acc.indexOf(a[0]) < 0;
          var other = a[0] === "glasses" ? "sunglasses" : a[0] === "sunglasses" ? "glasses" : "";
          var next = st.acc.filter(function (x) { return x !== a[0] && (!on || x !== other); });
          if (on) next.push(a[0]);
          if (st.up || st.thumb) {   // 이미 넣은 사진은 옛 설정으로 만드는 중 — 지우고 다시 고르게
            invalidatePhoto(); st.acc = next;
            st.photoNotice = "설정을 바꿨습니다. 사진을 다시 선택해 주세요.";
            showPhoto(); return;
          }
          st.acc = next;   // 사진 전이면 카드를 다시 그리지 않고 칩만 칠한다
          Object.keys(accChips).forEach(function (k) { paintChip(accChips[k], st.acc.indexOf(k) >= 0); });
        };
        accChips[a[0]] = chip; accGrid.appendChild(chip);
      });
      var box = document.createElement("div");   // 미리보기 자리 — 고른 사진 / 카메라 / 찍은 사진
      st.photoBox = box;   // 사진 넣음 표시(showInserted)가 이 칸에 그린다
      box.style.cssText = "box-sizing:border-box;width:100%;height:clamp(110px,24vh,210px);border:3px solid #a76c3b;border-radius:18px;background:radial-gradient(ellipse,#4c2c1a,#28170f);box-shadow:inset 0 3px 8px #0006;" +
        "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#EBDDBC;overflow:hidden;position:relative";
      var err = c.errLine();
      if (st.resumeNotice) { err.textContent = st.resumeNotice; st.resumeNotice = ""; }
      var row = document.createElement("div");
      row.style.cssText = "display:flex;gap:10px;margin-top:4px";
      var mkInput = function (capture) {
        var i = document.createElement("input");
        i.type = "file"; i.accept = "image/*"; i.style.display = "none";
        if (capture) i.setAttribute("capture", "user");   // 휴대폰 = 전면 카메라를 바로 연다
        i.onchange = function () { if (!i.isConnected) return; var f = i.files && i.files[0]; if (f) usePhoto(f); };
        c.card.appendChild(i);
        return i;
      };
      var fileIn = mkInput(false), camIn = mkInput(true);
      var buttons = function (list) {   // [{text, fn, ghost}] — 아래 줄 버튼을 갈아 끼운다
        row.innerHTML = "";
        list.forEach(function (d) {
          var b = c.mainBtn(d.text);
          b.classList.add("ro-race-next");
          b.style.flex = "1"; b.style.marginTop = "8px"; b.style.fontSize = "18px";
          if (d.ghost || d.text === "셀카 찍기") { b.classList.remove("ro-race-next"); b.style.cssText += ";border-radius:16px;border:2px solid #bd864d;background:linear-gradient(#9e6738,#704019);color:#fff1cd;clip-path:none;box-shadow:0 3px #38200e"; }
          if (d.ghost) { b.style.background = "transparent"; b.style.color = "var(--ro-ui-edge,#C9963F)"; b.style.clipPath = "none"; b.style.borderRadius = "4px"; }
          b.onclick = d.fn;
          row.appendChild(b);
        });
      };
      var noCam = function () { err.textContent = "카메라를 쓸 수 없습니다 — '이미지 넣기'를 눌러 주세요"; c.shake(); };
      // 카메라 모드(2026-11-09 사용자 "사진 찍기 화면이 너무 작다, 얼굴 크기로") — 미리보기를 카드 폭을 꽉 채운 세로 3:4 로 키우고
      //   버튼 줄 아래(안내·디테일·사진 없이 진행)는 잠깐 숨긴다. 낮은 화면은 화면 높이에 맞춰 줄어든다. idle 로 돌아오면 원래대로
      var camMode = function (on) {
        box.style.height = on ? "auto" : "clamp(110px,24vh,210px)";
        box.style.aspectRatio = on ? "3/4" : "";
        box.style.maxHeight = on ? "max(200px,min(330px,calc(100dvh - 380px)))" : "";
        // 2026-11-09 사용자 "카메라 표시되는 크기도 좀 줄일까, 크니까 부담스럽더라" — 카드 폭을 꽉 채우지 않고 72% 가운데(높이 최대 330)
        box.style.width = on ? "72%" : "100%";
        box.style.margin = on ? "0 auto" : "";
        for (var el = row.nextElementSibling; el; el = el.nextElementSibling) {
          if (on) { if (el.style.display !== "none") { el.style.display = "none"; el.setAttribute("data-ro-cam-hide", "1"); } }
          else if (el.getAttribute("data-ro-cam-hide")) { el.style.display = ""; el.removeAttribute("data-ro-cam-hide"); }
        }
      };
      var idle;
      var shootPc = function () {
        err.textContent = "";
        camMode(true);
        box.innerHTML = "<span style='font-size:14px;opacity:.7'>카메라를 켜는 중…</span>";
        buttons([{ text: "취소", ghost: true, fn: function () { stopCam(); idle(); } }]);
        saveResume();   // 아이폰은 카메라를 켠 채로도 이 탭을 새로 열 수 있다 — 사진첩과 같이 사진 단계로 돌아오게
        // 해상도 960×720(얼굴 생성은 긴 쪽 1024 로 줄여 올리니 충분) — 1280 은 아이폰에서 메모리를 더 썼다
        navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } }, audio: false }).then(function (stream) {
          if (!document.body.contains(box)) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }   // 그새 카드를 넘겼다
          stopCam();
          st.stream = stream;
          var v = document.createElement("video");
          v.autoplay = true; v.muted = true; v.setAttribute("playsinline", ""); v.setAttribute("muted", ""); v.srcObject = stream;
          var played = v.play && v.play(); if (played && played.catch) played.catch(function (e) { console.warn("[얼굴] 카메라 영상 재생 실패", e); });
          v.style.cssText = "width:100%;height:100%;object-fit:cover;transform:scaleX(-1) scale(1.06);filter:blur(3px) brightness(1.06) contrast(0.9) saturate(0.95)";   // 블러 1.5 → 2(2026-11-10 사용자) → 3·확대 1.06(2026-11-11 사용자 "좀 더 올리자")   // 거울처럼 + 살짝 뿌옇게(2026-11-09 사용자 "카메라가 너무 또렷해 내 사진이 부담스럽다, 블러 살짝") — 미리보기만, 찍는 사진(drawImage)은 또렷하게. 1.03 배 = 흐린 가장자리가 틀 안에 안 보이게
          box.innerHTML = ""; box.appendChild(v);
          // 얼굴 맞춤 가이드(2026-11-10 사용자 시안 A) — 점선 얼굴선 + 눈썹·코·입 자리만 얇게. 미리보기 위 표시일 뿐 찍는 사진엔 안 들어간다
          var guide = document.createElement("div");
          guide.style.cssText = "position:absolute;inset:0;pointer-events:none";
          guide.innerHTML = "<svg viewBox='0 0 300 400' preserveAspectRatio='xMidYMid slice' style='width:100%;height:100%'>" +
            "<ellipse cx='150' cy='182' rx='80' ry='106' fill='none' stroke='#EBDDBC' stroke-opacity='.85' stroke-width='3' stroke-dasharray='10 8'/>" +
            "<g fill='none' stroke='#EBDDBC' stroke-opacity='.8' stroke-width='3' stroke-linecap='round'>" +
            "<path d='M106 168 q14 -9 28 0'/><path d='M166 168 q14 -9 28 0'/><path d='M150 186 v20 l-6 4'/><path d='M132 236 q18 10 36 0'/></g></svg>" +
            "<div style='position:absolute;left:0;right:0;bottom:8px;text-align:center;font-size:13px;font-weight:700;color:#EBDDBC;text-shadow:0 1px 3px #000'>얼굴을 선 안에 맞춰 주세요</div>";
          box.appendChild(guide);
          buttons([
            { text: "취소", ghost: true, fn: function () { stopCam(); idle(); } },
            { text: "찍기", fn: function () {
              if (!v.videoWidth) { err.textContent = "카메라를 준비하고 있어요 — 잠시 뒤 다시 눌러 주세요"; if (v.play) v.play().catch(function () {}); return; }   // 2026-11-10 아이폰 "셀카를 찍어도 안 넘어간다" — 예전엔 조용히 무시했다
              var cv = document.createElement("canvas");
              cv.width = v.videoWidth; cv.height = v.videoHeight;
              cv.getContext("2d").drawImage(v, 0, 0);   // 올리는 사진은 뒤집지 않은 그대로
              stopCam();
              // 찍으면 바로 얼굴 만들기로 — 찍힌 사진을 보여 주는 확인 단계는 뺐다(2026-11-09 사용자 "찍힌 화면을 보여 주는 과정 빼자, 그냥 찍게 하고 찍은 이미지는 안 보여 준다, 즉시 만들어")
              box.innerHTML = "<span style='font-size:15px;font-weight:700;color:var(--ro-ui-edge,#C9963F)'>찰칵! 얼굴을 만들러 갑니다</span>";
              buttons([]);
              var give = function (blob) {
                if (!blob) {   // 아이폰에서 toBlob 이 빈손으로 올 때가 있다 — dataURL 로 대신 만든다
                  try {
                    var d = atob(cv.toDataURL("image/jpeg", 0.92).split(",")[1]), u = new Uint8Array(d.length);
                    for (var k = 0; k < d.length; k++) u[k] = d.charCodeAt(k);
                    blob = new Blob([u], { type: "image/jpeg" });
                  } catch (e) { console.warn("[얼굴] 사진 만들기 실패", e); idle(); err.textContent = "사진을 만들지 못했어요 — '이미지 넣기'로 넣어 주세요"; return; }
                }
                var f = blob; try { f = new File([blob], "photo.jpg", { type: "image/jpeg" }); } catch (_) {}   // 옛 사파리는 File 생성자가 없다 — Blob 그대로
                usePhoto(f);
              };
              try { cv.toBlob(give, "image/jpeg", 0.92); } catch (e) { give(null); }
            } }
          ]);
        }, function (e) { console.warn("[얼굴] 카메라 실패", e); idle(); noCam(); });
      };
      var shoot = function () {
        err.textContent = "";
        // 셀카 넣기 = 휴대폰에서도 카드 안 카메라(앞 카메라 facingMode user)를 바로 켠다(2026-11-06 사용자 "셀카 누르면 셀카 카메라로 바로").
        //   휴대폰 카메라 앱(capture=user)은 기종에 따라 뒤 카메라나 마지막에 쓴 카메라로 열렸다. 카메라를 못 쓰는 브라우저만 카메라 앱으로
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) { shootPc(); return; }
        if (touch) { saveResume(); camIn.click(); return; }
        noCam();
      };
      var pick = function () { err.textContent = ""; saveResume(); fileIn.click(); };
      idle = function () {
        camMode(false);
        // 넣은 사진은 다시 보여 주지 않는다(2026-11-09 사용자 "찍은 이미지는 안 보여준다") — 넣었다는 표시만
        if (st.thumb) box.innerHTML = "<svg width='56' height='56' viewBox='0 0 64 64' fill='none' stroke='var(--ro-ui-edge,#C9963F)' stroke-width='5' stroke-linecap='round' stroke-linejoin='round'><circle cx='32' cy='32' r='26'/><path d='M20 33 l9 9 l16 -18'/></svg>" +
          "<span style='font-size:16px;font-weight:700'>사진을 넣었어요 — 바꾸려면 아래 버튼</span>";
        else box.innerHTML = "<svg width='64' height='64' viewBox='0 0 64 64' fill='none' stroke='var(--ro-ui-edge,#C9963F)' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'>" +
          "<rect x='6' y='16' width='52' height='38' rx='6'/><path d='M22 16 l5 -7 h10 l5 7'/><circle cx='32' cy='35' r='10'/></svg>" +
          "<span style='font-size:16px;font-weight:700'>얼굴이 정면으로 잘 보이면 좋아요</span>";
        buttons([{ text: "셀카 찍기", fn: shoot }, { text: "이미지 넣기", fn: pick }]);
      };
      c.card.appendChild(box); c.card.appendChild(err); c.card.appendChild(row);
      // 안심 안내(2026-11-05 사용자 "이미지 생성에만 사용되고 바로 삭제 처리됩니다") — 사진은 얼굴을 만드는 데만 쓰고, 얼굴을 고르면 서버에서 지운다.
      //   사진 버튼 바로 아래에 둔다 — 카드 맨 아래면 낮은 화면에서 잘렸다(QA B4 2026-11-07)
      var safe = document.createElement("div");
      safe.textContent = "이미지 생성에만 사용되고 바로 삭제 처리됩니다";
      safe.style.cssText = "color:#EBDDBC;opacity:.75;font-size:13px;text-align:center;margin-top:8px";
      c.card.appendChild(safe);
      // '디테일하게 만들기'는 사진 생성 설정이라 사진 버튼 묶음 안에 둔다 — 사진을 고르기 '전에' 정해야 올릴 때 반영된다(나중에 바꾸면 사진을 다시 골라야 함).
      //   QA 개선 2('사진 없이 진행엔 의미 없음')는 숨기는 대신 아래 '또는' 구분선으로 사진 묶음과 떼어 놓아 해결
      c.card.appendChild(accBox);   // '디테일하게 만들기' 체크·설명 두 줄은 뺐다(2026-11-16 사용자) — 늘 빠른 생성(st.detail 0)
      // 사진 없이 진행(2026-11-07 사용자) — 사진 생성을 건너뛰고 마지막에 기본 템플릿 얼굴 3개 중에서만 고른다
      //   확인·실패 화면에서 사진 단계로 돌아왔을 때(st.started)도 같은 링크를 둔다(2026-11-10 사용자 "돌아온 사진 카드엔 기본 얼굴 링크가 없다") —
      //   목소리·프롤로그는 이미 지났으니 하던 사진 생성은 버리고 바로 기본 얼굴 고르기로(useDefaultFace, 대기 화면 '기본 얼굴로 시작'과 같은 길)
      {
        var orLine = document.createElement("div");
        orLine.style.cssText = "display:flex;align-items:center;gap:10px;margin:12px 0 2px;color:#C9963F;font-size:13px;font-weight:700";
        orLine.innerHTML = "<span style='flex:1;height:1px;background:#C9963F66'></span>또는<span style='flex:1;height:1px;background:#C9963F66'></span>";
        c.card.appendChild(orLine);
        var skip = c.mainBtn("사진 없이 진행");
        skip.classList.remove("ro-race-next");
        // 비활성처럼 보이지 않게 양피지 글자·바랜 금 테두리 — 셀카·이미지 넣기보다 한 단계 약하게(QA 개선 1)
        skip.style.cssText += ";margin-top:10px;font-size:16px;background:rgba(201,150,63,.12);color:#EBDDBC;clip-path:none;border:2px solid #C9963F;border-radius:12px;box-shadow:none;opacity:1";
        skip.onclick = function () { invalidatePhoto(); st.noPhoto = true; st.photoNotice = ""; if (st.started) useDefaultFace(); else afterPhoto(); };
        c.card.appendChild(skip);
        var skipHint = document.createElement("div");
        skipHint.textContent = "기본 얼굴 중에서 고릅니다";
        skipHint.style.cssText = "color:#EBDDBC;opacity:.7;font-size:12px;text-align:center;margin-top:4px";
        c.card.appendChild(skipHint);
      }
      idle();
      if (st.thumb && !st.started) {
        var next = c.mainBtn("다음");
        next.onclick = function () { stopCam(); if (st.mode === "custom" && st.faceFile) showOutfit(); else afterPhoto(); };
        c.card.appendChild(next);
      }
      if (!st.started) c.card.appendChild(c.stepBack(function () { stopCam(); lowPower(false); askFace(); }));   // 뒤로가기 = 4 '내 얼굴로 만들까요?'(얼굴 고르기에서 돌아온 사진 단계는 없음)
    };

    // ── 나만의 캐릭터: 얼굴 사진 다음 의상 사진(2026-11-21 사용자 확정, 애니 세션 안내) — 옷 사진 한 장 + 글 메모(선택), 건너뛰면 기본 의상.
    //   얼굴·의상 두 장으로 시트 한 장을 만드니 얼굴 생성은 여기서(옷 사진을 넣는 순간 또는 건너뛰기) 한 번에 요청한다.
    //   2026-11-21 사용자 "의상 사진 넣으면 바로 넘어가자, 다음 버튼 필요 없다" — 찍거나 고르면 곧바로 목소리 녹음으로. 메모는 사진 앞에 적게 버튼 위로 올림
    //   st.outfit {file, memo} 는 upload 가 얼굴 사진 뒤에 이어 붙여 /face/start 에 같이 보낸다(olen·memo, 2026-11-21 서버 연결)
    var showOutfit = function () {
      stopCam();
      c = RoCard(0);
      c.card.innerHTML = c.raceShell(5, "의상", "입고 싶은 옷 사진을 넣거나 글로 설명해 주세요", 7);
      c.anim();
      var o = st.outfit || { file: null, memo: "" };
      var box = document.createElement("div");
      box.style.cssText = "box-sizing:border-box;width:100%;height:clamp(110px,24vh,210px);border:3px solid #a76c3b;border-radius:18px;background:radial-gradient(ellipse,#4c2c1a,#28170f);box-shadow:inset 0 3px 8px #0006;" +
        "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#EBDDBC;overflow:hidden;position:relative";
      var paint = function () {
        box.innerHTML = o.file
          ? "<svg width='56' height='56' viewBox='0 0 64 64' fill='none' stroke='var(--ro-ui-edge,#C9963F)' stroke-width='5' stroke-linecap='round' stroke-linejoin='round'><circle cx='32' cy='32' r='26'/><path d='M20 33 l9 9 l16 -18'/></svg>" +
            "<span style='font-size:16px;font-weight:700'>옷 사진을 넣었어요 — 바꾸려면 아래 버튼</span>"
          : "<svg width='64' height='64' viewBox='0 0 64 64' fill='none' stroke='var(--ro-ui-edge,#C9963F)' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'>" +
            "<path d='M22 8 l-14 8 l5 12 l6 -3 v31 h26 v-31 l6 3 l5 -12 l-14 -8 q-5 6 -10 6 q-5 0 -10 -6 z'/></svg>" +
            "<span style='font-size:16px;font-weight:700'>옷 전체가 잘 보이면 좋아요</span>";
      };
      var mk = function (capture) {
        var i = document.createElement("input"); i.type = "file"; i.accept = "image/*"; i.style.display = "none";
        if (capture) i.setAttribute("capture", "environment");   // 휴대폰 = 뒤 카메라(옷을 찍는다)
        i.onchange = function () { if (!i.isConnected) return; var f = i.files && i.files[0]; if (f) { o.file = f; o.memo = memo.value; st.outfit = o; paint(); showInserted("의상 사진을 넣었어요", function () { go(true); }, box); } };   // 넣자마자 다음(목소리 녹음)
        c.card.appendChild(i); return i;
      };
      var fileIn = mk(false), camIn = mk(true);
      var row = document.createElement("div"); row.style.cssText = "display:flex;gap:8px;margin-top:4px";
      // 말로 설명(2026-11-23 사용자 "이미지 넣기 옆에 '말로 설명' 하나 추가") — 사진 없이 위 글만으로 옷을 만든다(/face/start 에 otext=1·memo, 서버 세션 짝).
      //   글이 비었으면 글칸을 밝히고 적게 한 뒤 다시 누르게 한다. 서버가 아직 otext 를 모르면 얼굴만 만들어지고 기본 의상(예전과 같음)
      var talk = function () {
        var t = (memo.value || "").trim();
        if (!t) { memo.placeholder = "입고 싶은 옷을 적고 다시 눌러 주세요"; memo.style.borderColor = "#ffdb75"; memo.focus(); return; }
        o.file = null; o.memo = t; o.text = true; st.outfit = o; go(true);
      };
      [["사진 찍기", function () { saveResume(); (touch ? camIn : fileIn).click(); }], ["이미지 넣기", function () { saveResume(); fileIn.click(); }], ["글로 설명", talk]].forEach(function (d) {
        var b = c.mainBtn(d[0]); b.classList.add("ro-race-next"); b.style.flex = "1"; b.style.minWidth = "0"; b.style.marginTop = "8px"; b.style.fontSize = "clamp(13px,4.2vw,16px)"; b.style.whiteSpace = "nowrap"; b.onclick = d[1]; row.appendChild(b);   // 세 개라 좁은 폰(340)에서 '이미지 넣기'가 넘치지 않게 (2026-11-24: 0be20b571 때 onclick·appendChild 가 이 주석 안으로 들어가 버튼 셋이 안 붙었다)
      });
      var memo = document.createElement("input"); memo.type = "text"; memo.maxLength = 60; memo.value = o.memo || "";
      memo.placeholder = "원하는 옷·느낌 (예: 주황 도복에 파란 띠)";
      memo.style.cssText = "box-sizing:border-box;width:100%;margin-top:10px;padding:10px 12px;font:inherit;font-size:16px;color:#fff1cd;background:#2a1a11;border:2px solid #a76c3b;border-radius:12px;outline:none";
      memo.oninput = function () { o.memo = memo.value; st.outfit = o; };
      var go = function (useOutfit) {   // 얼굴 사진 + (의상) → 한 번에 생성 요청 → 녹음
        st.outfit = useOutfit && o.file ? { file: o.file, memo: (o.memo || "").trim() }
          : useOutfit && o.text && (o.memo || "").trim() ? { file: null, memo: o.memo.trim(), text: true } : null;
        if (!st.faceFile) { afterPhoto(); return; }
        upload(st.faceFile);
        startFaceProgress();
        afterPhoto();
      };
      var skip = c.mainBtn("의상 사진 없이 진행");
      skip.classList.remove("ro-race-next");
      skip.style.cssText += ";margin-top:10px;font-size:16px;background:rgba(201,150,63,.12);color:#EBDDBC;clip-path:none;border:2px solid #C9963F;border-radius:12px;box-shadow:none;opacity:1";
      skip.onclick = function () { go(false); };
      var skipHint = document.createElement("div"); skipHint.textContent = "기본 의상 그대로 입어요";
      skipHint.style.cssText = "color:#EBDDBC;opacity:.7;font-size:12px;text-align:center;margin-top:4px";
      c.card.appendChild(box); c.card.appendChild(memo); c.card.appendChild(row); c.card.appendChild(skip); c.card.appendChild(skipHint);
      c.card.appendChild(c.stepBack(function () { showPhoto(); }));   // 뒤로가기 = 얼굴 사진
      paint();
    };

    // ── 3 이름(= 아이디) ──
    showName = function () {
      c.wrap.classList.remove("ro-race-card");
      c.card.innerHTML = c.raceShell(3, "당신의 이름은?", "모험에서 불릴 이름을 정해 주세요", 7);
      c.anim();
      var err = c.errLine();
      var inp, checking = false;
      var go = function () {
        if (checking) return;
        var v = inp.value.trim();
        if (!v.length) { err.textContent = "이름을 입력해 주세요"; c.shake(); return; }
        if (v.length > 6) { err.textContent = "이름은 최대 6자까지예요"; c.shake(); inp.focus(); return; }   // 휴대폰 한글 조합 중엔 maxLength 를 넘을 수 있다
        if (/[\r\n=]/.test(v)) { err.textContent = "이름에 쓸 수 없는 글자가 있어요"; c.shake(); return; }
        checking = true; next.disabled = true; err.textContent = "이름을 확인하고 있습니다…";
        var controller = new AbortController();
        var timeout = setTimeout(function () { controller.abort(); }, 10000);
        // 이름을 쓸 수 있는지 얼굴 서버에 먼저 묻는다(2026-11-23 메인·서버 세션 — 얼굴·목소리까지 고른 뒤 접속 때 거절돼 처음부터 다시 했다).
        //   답 {available|ok: false, reason} = 그 글을 그대로(없으면 '이미 사용 중'), 400 {error} = 그 글, 429 = 잠시 후 다시.
        //   얼굴 서버가 꺼졌거나·늦거나·모르는 답이면 막지 않고 넘어간다 — 최종 판정은 접속 때 게임 서버가 다시 한다
        var pass = function () { if (!c.wrap.isConnected || !inp.isConnected || inp.value.trim() !== v) return; st.name = v; inp.blur(); showPin(); };
        var stop = function (t) { if (!c.wrap.isConnected || !inp.isConnected || inp.value.trim() !== v) return; err.textContent = t; c.shake(); inp.focus(); };
        getBase().then(function (base) {
          return fetch(base + "/account/name?name=" + encodeURIComponent(v), { cache: "no-store", signal: controller.signal, headers: RoEntryUI().devHeaders({}) });
        }).then(function (r) {
          if (r.status === 429) return r.json().catch(function () { return {}; }).then(function (j) { stop((j && (j.reason || j.error)) || "잠시 후 다시 시도해 주세요"); });
          if (r.status === 400) return r.json().catch(function () { return {}; }).then(function (j) { if (j && (j.reason || j.error)) stop(j.reason || j.error); else pass(); });
          if (!r.ok) { pass(); return; }
          return r.json().then(function (result) {
            if (result && (result.available === false || result.ok === false)) stop(result.reason || "이미 사용 중인 이름이에요. 다른 이름을 입력해 주세요");
            else pass();
          });
        }).catch(function () { pass(); })
          .then(function () { clearTimeout(timeout); checking = false; next.disabled = false; });
      };
      inp = c.input("모험가 이름", go);
      if (inp.previousElementSibling) inp.previousElementSibling.remove();   // 입력칸 위 라벨 없음(2026-11-16 사용자)
      inp.setAttribute("aria-label", "모험가 이름");
      inp.type = "text"; inp.maxLength = 6; inp.value = st.name.slice(0, 6);   // 2026-11-16 사용자 "최대 6자로"
      inp.placeholder = "이름을 입력해 주세요";
      inp.style.cssText += ";border:3px solid #a76c3b;border-radius:16px;background:linear-gradient(#28150d,#472717);color:#fff2d1;box-shadow:inset 0 3px 6px #0008;padding:16px;font-size:22px";
      var nameHint = document.createElement("div");
      nameHint.style.cssText = "display:flex;justify-content:space-between;gap:8px;color:#e7c99d;font-size:12px;line-height:1.6;margin:8px 0 4px";
      var count = document.createElement("span"); count.textContent = "최대 6자";
      var hint = document.createElement("span"); hint.textContent = "이 이름이 아이디로 사용됩니다";
      nameHint.appendChild(hint); nameHint.appendChild(count); c.card.appendChild(nameHint);
      inp.oninput = function () { if (err.textContent) err.textContent = ""; };
      inp.addEventListener("compositionend", function () { if (inp.value.length > 6) inp.value = inp.value.slice(0, 6); });   // 한글 조합이 끝나면 6자로 자름
      c.card.appendChild(err);
      var next = c.mainBtn("결정"); next.classList.add("ro-race-next");
      next.style.marginTop = "6px";
      next.onclick = go;
      c.card.appendChild(next);
      c.card.appendChild(c.stepBack(showGender));   // 뒤로가기 = 2 성별
      setTimeout(function () { inp.focus(); }, 50);
    };

    // ── 3 비밀번호(이름과 같은 단계, 카드는 따로) ──
    showPin = function () {
      c.wrap.classList.remove("ro-race-card");
      c.card.innerHTML = c.raceShell(4, "비밀번호를 정해 주세요", "", 7);   // QA 새 유저 v152 — 이름과 같은 3/7 이었다
      c.anim();
      // 2026-11-22 사용자 "비밀번호 화면 한 화면에 두 개 표시해서 한 번에 받는다 — 정해 주세요 4칸, 아래 '한 번 입력' 4칸, 결정" — 예전 = 같은 4칸에 두 번(제목만 바뀜)
      var err = c.errLine();
      var inp, inp2, paintPin, paintPin2;
      var go = function () {
        if (!/^[0-9]{8}$/.test(inp.value)) { err.textContent = "비밀번호는 숫자 8자리예요"; c.shake(); inp.focus(); return; }
        if (!/^[0-9]{8}$/.test(inp2.value)) { err.textContent = "아래 칸에 같은 비밀번호를 한 번 더 넣어 주세요"; c.shake(); inp2.focus(); return; }
        if (inp.value !== inp2.value) { inp2.value = ""; paintPin2.hide(); err.textContent = "서로 달라요 — 아래 칸을 다시 넣어 주세요"; c.shake(); inp2.focus(); return; }
        if (st.race !== 0 && st.race !== 1) { showRace(); return; }
        st.pin = inp.value; inp.blur(); inp2.blur();
        askFace();   // 2026-11-10 비번 다음 = 사진(얼굴 생성은 사진을 넣는 순간 시작) → 2026-11-11 그 앞에 '내 얼굴로 만들까요?' 물음
      };
      var pinInput = function (label, aria, onEnter) {
        var x = c.input(label, onEnter);
        x.type = "password"; x.maxLength = 8; x.setAttribute("inputmode", "numeric"); x.setAttribute("pattern", "[0-9]*");
        x.autocomplete = "one-time-code";   // 아이폰 사파리가 '강력한 암호'(영문 섞인 긴 암호)를 제안해 노란 칸으로 채우지 않게
        x.setAttribute("aria-label", aria);
        return x;
      };
      inp = pinInput("비밀번호 · 숫자 8자리", "비밀번호 숫자 8자리", function () { if (inp.value.length === 8) inp2.focus(); else go(); });
      if (inp.previousElementSibling) inp.previousElementSibling.remove();   // 첫 칸 위 라벨 없음(2026-11-16 사용자) — 제목이 대신
      inp.value = st.pin;
      paintPin = c.pinBoxes(inp, 64);
      inp2 = pinInput("한 번 더 입력", "비밀번호 확인 숫자 8자리", go);
      inp2.value = st.pin;
      paintPin2 = c.pinBoxes(inp2, 64);
      var pinHint = document.createElement("div"); pinHint.textContent = "다음 접속 때 필요하니 꼭 기억해 주세요";
      pinHint.style.cssText = "color:#e7c99d;font-size:13px;line-height:1.6;margin:6px 0 12px"; c.card.appendChild(pinHint);
      var onType = function (x, paint, after) {
        x.oninput = function () {
          var v = x.value.replace(/[^0-9]/g, "").slice(0, 8); if (v !== x.value) x.value = v; paint(); if (err.textContent) err.textContent = "";
          if (after && v.length === 8) after();
        };
      };
      onType(inp, paintPin, function () { if (inp2.value.length < 8) inp2.focus(); });   // 위 4칸을 다 넣으면 아래 칸으로
      onType(inp2, paintPin2, function () { if (inp.value.length === 8) go(); });   // 아래 4칸까지 다 넣으면 '결정'을 안 눌러도 바로 다음(2026-11-22 사용자) — 다르면 go 가 아래 칸을 비우고 알린다
      c.card.appendChild(err);
      var next = c.mainBtn("결정"); next.classList.add("ro-race-next");
      next.style.marginTop = "6px";
      next.onclick = go;
      c.card.appendChild(next);
      c.card.appendChild(c.stepBack(showName));   // 뒤로가기 = 3 이름
      setTimeout(function () { (inp.value.length === 8 ? inp2 : inp).focus(); }, 50);
    };

    // 사진 단계를 마침(사진 넣음 / 사진 없이 진행) → NetSession.OnHtmlNewStart(데이터 모양 그대로) → 5 목소리 녹음(녹음만) → 6 프롤로그 → 7 확인(2026-11-10)
    //   사진이 있으면 올리기 응답(job)을 받는 대로 보낸다 — 녹음은 기다리지 않고 바로. 접속(OnHtmlFace)은 이 보냄이 끝난 뒤에만(enterGame)
    var afterPhoto = function () {
      stopCam();
      if ((!st.up && !st.noPhoto) || (st.race !== 0 && st.race !== 1)) { showRace(); return; }
      if (!st.name || !/^[0-9]{8}$/.test(st.pin)) { showName(); return; }
      st.started = true; st.faceFirst = false;   // 얼굴 고르기에서 '사진으로 얼굴 만들기'로 돌아와도 예전 길(프롤로그 → 생성 확인)로
      if (st.noPhoto && !st.up) {
        window.__roSttAuth = { n: st.name, p: st.pin }; SendMessage("NetSession", "OnHtmlNewStart", JSON.stringify({ name: st.name, pin: st.pin, gender: st.gender, race: st.race, job: "", keep: RoKeepPref() }));
        st.newStart = Promise.resolve();
      } else {
        // 2026-11-22 사용자 "프롤로그 보고 계속 로딩 화면만" — 예전엔 사진 올리기 응답(job)을 받은 뒤에야 보내, 응답이 늦거나 얼굴 줄을 서면 접속 신호(OnHtmlFace)가 그동안 못 나갔다.
        //   게임은 job 을 쓰지 않으니(생성 얼굴은 접속 뒤 OnHtmlFaceLate) 올리기를 기다리지 않고 바로 보낸다
        window.__roSttAuth = { n: st.name, p: st.pin }; SendMessage("NetSession", "OnHtmlNewStart", JSON.stringify({ name: st.name, pin: st.pin, gender: st.gender, race: st.race, job: "", keep: RoKeepPref() }));
        st.newStart = Promise.resolve();
      }
      if (st.mode === "preset") { startVoiceWatch(""); st.faceFirst = true; toConfirm(); return; }   // 랜덤 캐릭터 = 목소리도 기본, 프롤로그 뒤 무작위 머리로 바로 접속
      if (st.mode === "custom") { recordVoice(); return; }   // 나만의 캐릭터 = 사진 다음 바로 녹음
      askVoice();
    };
    // 나만의 캐릭터 — 목소리 물음 없이 녹음 카드로(녹음 카드의 건너뛰기는 그대로 = 기본 목소리). 뒤로가기 = 얼굴 사진
    var recordVoice = function () {
      if (svcOff.voice) { startVoiceWatch(""); showPrologue(); return; }
      c = RoCard(0); c.wrap.remove();
      RoVoiceStep(st.base, st.name, function (v) { startVoiceWatch(v); showPrologue(); }, st.gender, { recordOnly: true, step: 6, total: 7, race: st.race, onBack: function () { c = RoCard(0); voiceBack(); } });
    };
    // 5 목소리는 선택(2026-11-11 사용자 "구구절절 글 많이 넣지 말자, 할 사람만 하게" — 사운드 세션 전달) — 짧게 묻고 [녹음하기] = 녹음 카드, [건너뛰기] = 녹음 카드의 건너뜀과 같은 "" 로 바로 프롤로그.
    //   사진을 넣었든 사진 없이 왔든 같은 물음(어느 쪽이든 목소리는 따로 고르는 것이라)
    var voiceBack = function () {
      st.started = false; st.newStart = null;
      if (st.up || st.thumb) showPhoto(); else if (svcOff.face) showPin(); else askFace();   // 얼굴 만들기를 꺼 두면 물음 카드가 없으니 비밀번호로
    };
    var askVoice = function () {
      if (svcOff.voice) {   // 목소리 만들기 꺼짐 = '기본 목소리로'를 누른 것과 같은 길(카드를 띄우지 않음)
        startVoiceWatch("");
        if (st.noPhoto && !st.up) { st.faceFirst = true; toConfirm(); return; }
        showPrologue(); return;
      }
      c = RoCard(0);
      c.card.innerHTML = c.raceShell(6, "보이스도 만들까요?", "캐릭터가 내 목소리로 말해요", 7);   // 2026-11-16 사용자 "보이스도 만들까요? 로, 녹음하면 글자 삭제"
      var rec = c.mainBtn("녹음하기"); rec.type = "button"; rec.classList.add("ro-race-next");
      rec.onclick = function () {
        c.wrap.remove();
        RoVoiceStep(st.base, st.name, function (v) { startVoiceWatch(v); showPrologue(); }, st.gender, { recordOnly: true, step: 6, total: 7, race: st.race, onBack: askVoice });   // 녹음 카드 뒤로가기 = 목소리 물음
      };
      var no = c.defaultFaceBtn("기본 목소리로"); no.classList.add("ro-voice-ask-skip");
      no.onclick = function () {
        c.wrap.remove(); startVoiceWatch("");
        // 사진도 목소리도 건너뛰었으면 만들 것이 없으니 기본 얼굴 고르기를 프롤로그 전에 바로 — 고른 뒤 '모험 시작'에서 프롤로그를 보고 접속(2026-11-11 사용자 "스킵했다면 바로 얼굴 고르게, 했다면 프롤로그 이후로")
        if (st.noPhoto && !st.up) { st.faceFirst = true; toConfirm(); return; }
        showPrologue();
      };
      askTiles([[rec, "<rect x='22' y='6' width='20' height='32' rx='10'/><path d='M12 30 a20 20 0 0 0 40 0'/><path d='M32 50 v8'/><path d='M22 58 h20'/>", "녹음하기"],
                [no, "<path d='M10 26 h10 l14 -12 v36 l-14 -12 h-10 z'/><path d='M42 22 q7 10 0 20'/><path d='M49 15 q13 17 0 34'/>", "기본 목소리로"]]);
      c.card.appendChild(c.stepBack(voiceBack));   // 뒤로가기 = 4 사진(넣었으면) / '내 얼굴로 만들까요?' — 얼굴 카드와 세로 길이도 같아진다(2026-11-13 사용자)
      serviceDown("voice", rec, c.card, "목소리 만들기가 잠시 멈췄어요 · 기본 목소리로 시작해 주세요");
    };
    // 6 프롤로그 → 7 확인. 사진이 있으면 생성 진행(wait)부터, 없으면 바로 기본 얼굴 확인
    var showPrologue = function () {
      entry.hideBusy();
      st.prologueStop = RoPrologue(st.race, function () { st.prologueStop = null; st.prologueSeen = true; toConfirm(); }, true);
    };
    var toConfirm = function () {
      if (st.up && !st.noPhoto) { autoEnter(); return; }   // 2026-11-21 기획 확정 — 사진을 넣었으면 고르기 없이 바로 접속(생성 얼굴은 접속 뒤에 끼움)
      getBase().then(function () { randomEnter(); }, function (e) { console.warn("[얼굴] 서버 주소 실패", e); randomEnter(); });
    };

    // ── 2 성별 ──
    showGender = function () {
      c.wrap.classList.remove("ro-race-card");
      c.card.innerHTML = c.raceShell(2, "성별 선택", "모험가의 모습을 골라 주세요", 7); c.wrap.classList.add("ro-race-wide");
      c.anim();
      c.card.appendChild(c.genderTiles(function () { return st.gender; }, function (v) {
        if (v !== st.gender && (st.up || st.thumb)) { invalidatePhoto(); st.photoNotice = "성별을 바꿨습니다. 사진을 다시 선택해 주세요."; }
        st.gender = v;
      }, st.race === 1));
      var next = c.mainBtn("결정");
      next.classList.add("ro-race-next");
      next.onclick = showName;   // 2026-11-10 성별 다음 = 이름
      c.card.appendChild(next); c.card.appendChild(c.stepBack(function () { wrapRaceOff(); showRace(); }));   // 뒤로가기 = 1 종족
      c.wrap.classList.add("ro-race-wide"); c.padTo(next);
    };

    // 종족을 바꾸면 사진부터 다시 선택한다. 이전 종족의 비동기 결과는 모두 무효화한다.
    showRace = function () {
      RoEntryUI().setRacePreview(false);
      SendMessage("NetSession", "OnHtmlRacePreviewReset", "");
      stopCam(); entry.hideBusy();
      c.card.innerHTML = c.raceShell(1, null, null, 7); c.wrap.classList.add("ro-race-wide");
      c.anim();
      var next = c.mainBtn("결정");
      var raceErr = c.errLine();
      // 고르기 전엔 흐리게 — 눌러도 막지 않고 카드를 흔들며 안내(QA B3: 예전엔 disabled 라 눌러도 아무 반응이 없었다)
      var dimNext = function () { var on = st.race === 0 || st.race === 1; next.style.opacity = on ? "" : ".45"; next.style.filter = on ? "" : "grayscale(.6)"; };
      c.card.appendChild(c.raceTiles(function () { return st.race; }, function (value) {
        if (st.race !== value) {
          invalidatePhoto(); st.photoNotice = "";
        }
        st.race = value; document.documentElement.dataset.roUiRace = value === 1 ? "orc" : "human";
        RoEntryUI().setRacePreview(false);
        SendMessage("NetSession", "OnHtmlRace", String(value));
        raceErr.textContent = ""; dimNext();
      }));
      c.card.appendChild(raceErr);
      next.classList.add("ro-race-next");
      next.onclick = function () {
        if (st.race !== 0 && st.race !== 1) { raceErr.textContent = "종족을 골라 주세요"; c.shake(); return; }
        c.raceH = c.card.offsetHeight; wrapRaceOff(); showGender();
      }; next.style.marginTop = "4px"; c.card.appendChild(next); dimNext();   // 다음을 조금 올려 아래에 뒤로가기
      c.card.appendChild(c.stepBack(function () {   // 뒤로가기 = 로그인 카드(예전 '← 처음으로')
        entry.cancel(); c.wrap.remove(); SendMessage("NetSession", "OnHtmlNewCharBack", "");
      }));
    };

    // 하나의 폴링 루프만 유지한다. 카드 교체/뒤로/사진 재선택 때 낡은 응답은 무시한다.
    var loadUi = null, progressRun = 0, progressTimer = null, progressAbort = null, progressStarted = 0;
    var result = null, waiting = false, lastPct = 0, completionTimer = null;
    var clearFaceProgress = function () {
      progressRun++; clearTimeout(completionTimer); completionTimer = null;
      clearTimeout(progressTimer); progressTimer = null;
      if (progressAbort) progressAbort.abort(); progressAbort = null;
      loadUi = null;
      var old = document.getElementById("ro-face-progress"); if (old) old.remove();
      var oldMini = document.getElementById("ro-face-mini"); if (oldMini) oldMini.remove();
    };
    entry.cleanup = function () {
      Object.keys(preCache).forEach(function (k) { preCache[k].then(function (o) { if (o) URL.revokeObjectURL(o); }); }); preCache = {};
      uploadEpoch++; if (uploadAbort) uploadAbort.abort(); if (st.faceQueue) st.faceQueue.cancel(); discardJob(st.job); if (disposePreview) disposePreview(); clearFaceProgress(); stopCam(); if (st.thumb) URL.revokeObjectURL(st.thumb);
      stopVoiceWatch(); discardVoice(); if (st.prologueStop) { st.prologueStop(); st.prologueStop = null; } };
    var showLoading = function () {
      if (document.getElementById("ro-face-progress")) return;
      var panel = document.createElement("div"); panel.id = "ro-face-progress";
      // 2026-11-11 사용자 "얼굴 생성 중 위 진행 UI 가 세로로 너무 길다 → '얼굴 생성 중 NN%' 한 줄 + 아랫줄 게이지 바만". 안내 문구는 오류일 때만 한 줄 보인다
      panel.style.cssText = "width:100%;box-sizing:border-box;padding:10px 16px 12px;border:1px solid var(--ro-ui-edge,#C9963F);border-radius:12px;background:rgba(35,24,18,.96);color:#EBDDBC;box-shadow:0 4px 24px #0008";
      panel.innerHTML = "<div style='text-align:center;font-size:16px;font-weight:800;margin-bottom:8px'><span id='ro-face-title'>얼굴 생성 중</span> <span id='ro-face-percent' style='color:#F2C77A'>0%</span></div><div role='progressbar' aria-label='얼굴 생성 진행률' aria-valuemin='0' aria-valuemax='100' aria-valuenow='0' style='height:10px;border-radius:6px;background:#59432f;overflow:hidden'><div id='ro-load-fill' style='height:100%;width:0%;background:linear-gradient(90deg,#C9963F,#F2C77A);transition:width .6s ease'></div></div><div id='ro-load-txt' aria-live='polite' hidden style='font-size:13px;margin-top:6px;text-align:center;color:#ffb38a'></div>";
      entry.top.appendChild(panel);
      // 프롤로그(z 10001)가 진행 판을 덮어도 화면 맨 위 끝에 얇은 막대 + 작은 글로 보인다(2026-11-25 사용자 "프롤로그 나올 때도 상단 끝에 붙어서 미니멀하게")
      //   프롤로그가 떠 있을 때만 보인다(:has) — 그 밖에는 위 진행 판이 보이므로 숨김
      if (!document.getElementById("ro-face-mini-css")) { var mcss = document.createElement("style"); mcss.id = "ro-face-mini-css"; mcss.textContent = "#ro-face-mini{display:none}body:has(#ro-prologue) #ro-face-mini{display:block}"; document.head.appendChild(mcss); }
      var mini = document.createElement("div"); mini.id = "ro-face-mini";
      mini.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:10002;text-align:center;pointer-events:none";
      mini.innerHTML = "<div style='height:3px;background:rgba(0,0,0,.35)'><div id='ro-face-mini-fill' style='height:100%;width:0%;background:linear-gradient(90deg,#C9963F,#F2C77A);box-shadow:0 0 6px rgba(242,199,122,.6);transition:width .6s ease'></div></div><div id='ro-face-mini-txt' style='display:inline-block;max-width:80vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px;padding:1px 8px;border-radius:0 0 8px 8px;background:rgba(20,13,9,.55);color:#F2C77A;font-size:11px;font-weight:700'>얼굴 생성 중 0%</div>";
      document.body.appendChild(mini);
      loadUi = function (pct, txt, working) {
        lastPct = Math.max(lastPct, Math.round(Math.max(0, Math.min(100, pct))));
        panel.querySelector("#ro-load-fill").style.width = lastPct + "%";
        panel.querySelector("[role=progressbar]").setAttribute("aria-valuenow", lastPct);
        panel.querySelector("#ro-face-percent").textContent = lastPct + "%";
        panel.querySelector("#ro-face-title").textContent = lastPct >= 100 ? "얼굴 완성" : "얼굴 생성 중";
        if (txt) { var note = panel.querySelector("#ro-load-txt"), bad = /실패|못했|많아요|다시 확인/.test(txt); note.hidden = !bad; if (bad) note.textContent = txt; }
        mini.querySelector("#ro-face-mini-fill").style.width = lastPct + "%";
        mini.querySelector("#ro-face-mini-txt").textContent = txt && /실패|못했|많아요/.test(txt) ? txt : lastPct >= 100 ? "얼굴 완성" : "얼굴 생성 중 " + lastPct + "%";
      };
    };
    var finishGeneration = function () {
      if (!waiting || !result) return;
      if (!result.ok.length) { waiting = false; fail(); return; }
      if (completionTimer !== null) return;
      if (loadUi) loadUi(100, "얼굴 완성! 잠시 후 골라 주세요", false);
      var readyResult = result, run = progressRun;
      completionTimer = setTimeout(function () {
        completionTimer = null;
        if (run !== progressRun || !waiting || result !== readyResult) return;
        waiting = false; autoEnter();   // 예전 고르기 화면 대신 바로 접속(2026-11-21 미리보기 폐기)
      }, 700);
    };
    var startFaceProgress = function () {
      clearFaceProgress(); result = null; waiting = false; lastPct = 0; showLoading();
      progressStarted = Date.now();
      var run = progressRun, uploadPromise = st.up, errors = 0, jobSeen = false;
      var poll = function () {
        uploadPromise.then(function (job) {
          if (run !== progressRun) return;
          if (!job) { result = { job: job, ok: [] }; if (loadUi) loadUi(0, st.upErr === 429 ? "요청이 많아요 · 잠시 후 다시 시도해 주세요" : "사진 전송 실패 · 사진을 다시 넣어 주세요"); finishGeneration(); return; }
          if (!jobSeen) { jobSeen = true; progressStarted = Date.now(); }
          progressAbort = new AbortController();
          var timeout = setTimeout(function () { if (run === progressRun && progressAbort) progressAbort.abort(); }, 12000);
          fetch(st.base + "/face/status?job=" + encodeURIComponent(job), { cache: "no-store", signal: progressAbort.signal }).then(function (r) { if (!r.ok) throw new Error("status"); return r.json(); }).then(function (status) {
            clearTimeout(timeout);
            if (run !== progressRun) return;
            errors = 0;
            var done = status.done || [], failed = status.fail || [], ok = [], n = Math.max(done.length, failed.length), over = n > 0;
            for (var i = 0; i < n; i++) { if (done[i]) ok.push(i); else if (!failed[i]) over = false; }
            var elapsed = (Date.now() - progressStarted) / 1000;
            var expired = elapsed > Math.max(120, (status.expect || 20) * 6);
            if (loadUi) loadUi((over || expired) && ok.length ? 100 : Math.min(95, elapsed / Math.max(10, status.expect || 20) * 100), ok.length + " / " + (n || 2) + "장 완성 · 진행률은 예상치입니다", !over && !expired);
            if (over || expired) { result = { job: job, ok: ok }; if (loadUi) loadUi(lastPct, ok.length ? "생성 완료 · 다음 단계에서 얼굴을 골라 주세요" : "얼굴 생성 실패 · 사진을 다시 넣어 주세요"); finishGeneration(); }
            else progressTimer = setTimeout(poll, 1000);
          }).catch(function () {
            clearTimeout(timeout);
            if (run !== progressRun) return;
            if (++errors > 15) { result = { job: job, ok: [] }; if (loadUi) loadUi(lastPct, "진행 상황을 확인하지 못했습니다. 사진을 다시 넣어 주세요"); finishGeneration(); return; }
            if (loadUi) loadUi(lastPct, "진행 상황을 다시 확인하는 중…");
            progressTimer = setTimeout(poll, 2000);
          });
        });
      };
      poll();
    };
    // 줄 서기 화면(2026-11-10) — 얼굴 만들기 차례를 기다리는 동안. 차례가 오면 '내 차례' 연출 뒤 보통 진행 화면(wait)으로
    var showQueue = function () {
      c.card.innerHTML = c.raceShell(7, "줄을 서 주세요", "지금 얼굴을 만드는 사람이 많아요 · 차례가 되면 바로 시작해요", 7);
      var pp = document.getElementById("ro-face-progress"); if (pp) pp.style.display = "none";
      var scene = RoQueueScene("face"); c.card.appendChild(scene.el);
      scene.update(st.faceQ.pos, st.faceQ.wait);
      var quit = c.defaultFaceBtn("그만두고 기본 얼굴로");
      quit.onclick = function () { useDefaultFace(); };
      c.card.appendChild(quit);
      st.faceQueueUi = function (p, w) { if (scene.el.isConnected) scene.update(p, w); };
      st.faceQueueNote = function (t) { if (scene.el.isConnected) scene.note(t); };
      st.faceQueueTurn = function (cb) {
        if (!scene.el.isConnected) return false;
        quit.disabled = true; quit.style.visibility = "hidden";
        scene.turn(function () { var still = scene.el.isConnected; cb(); if (still && waiting) wait(); });
        return true;
      };
    };
    var wait = function () {
      waiting = true;
      entry.hideBusy();
      c = RoCard(0);
      if (st.faceQ) { showQueue(); return; }
      c.card.innerHTML = c.raceShell(7, "얼굴을 만들고 있어요", "모험가의 얼굴에 생명을 불어넣는 중", 7);
      var medallion = document.createElement("div"); medallion.id = "ro-face-medallion";
      medallion.setAttribute("aria-hidden", "true");
      medallion.style.cssText = "margin:18px auto;width:120px;height:120px;display:grid;place-items:center;border:5px solid var(--ro-ui-edge,#f0bd56);border-radius:50%;font-size:64px;background:#eacb8a22;box-shadow:0 0 24px #c9963f44";
      medallion.innerHTML = "<svg viewBox='0 0 120 120' width='100' height='100' fill='#f2dbab' aria-hidden='true'><circle cx='60' cy='44' r='24'/><circle cx='35' cy='47' r='7'/><circle cx='85' cy='47' r='7'/><path d='M20 108c0-36 80-36 80 0z'/></svg>"; c.card.appendChild(medallion);
      showLoading();
      var progressPanel = document.getElementById("ro-face-progress");
      if (progressPanel) { progressPanel.style.display = ""; c.card.appendChild(progressPanel); progressPanel.querySelector("#ro-load-fill").style.height = "100%"; progressPanel.querySelector("[role=progressbar]").style.height = "22px"; }
      // 생성을 기다리지 않고 기본 얼굴로(2026-11-09 v.0.053 "얼굴이 생성 안 된다") — 언제든 누를 수 있고, 40초가 넘으면 안내 글과 함께 버튼을 밝힌다
      var slowNote = document.createElement("div"); slowNote.setAttribute("aria-live", "polite");
      slowNote.style.cssText = "font-size:13px;line-height:1.5;color:#FFD966;margin:12px 0 0;min-height:0";
      var skip = c.defaultFaceBtn("기본 얼굴로 시작");
      skip.onclick = function () { useDefaultFace(); };
      c.card.appendChild(slowNote); c.card.appendChild(skip);
      var slowRun = progressRun;
      setTimeout(function () {
        if (slowRun !== progressRun || !waiting || !skip.isConnected) return;
        slowNote.textContent = "얼굴 만들기가 오래 걸리고 있어요 — 기본 얼굴로 바로 시작할 수 있어요";
        skip.classList.add("ro-default-face-hot");
      }, Math.max(0, 40000 - (Date.now() - progressStarted)));
      if (result && result.ok.length) {
        lastPct = 0;
        if (loadUi) loadUi(0, "완성되면 얼굴을 고를 수 있어요", false);
        var waitRun = progressRun;
        requestAnimationFrame(function () { requestAnimationFrame(function () { if (waitRun === progressRun) finishGeneration(); }); });
      } else {
        if (loadUi) loadUi(lastPct, "완성되면 얼굴을 고를 수 있어요", !result);
        finishGeneration();
      }
    };

    var fail = function () {
      if (st.upErr === 503) { useDefaultFace(); return; }   // 크레딧 소진·관리 툴 꺼짐 = 다시 해도 안 됨 → 바로 기본 얼굴로(2026-11-14 사용자 "막히면 자동으로 기본으로")
      st.photoFails = (st.photoFails || 0) + 1;
      if (st.photoFails >= 2) { useDefaultFace(); return; }   // 거듭 실패 = 기본 얼굴로 자동 진행(사용자 2026-11-10)
      clearFaceProgress();
      c = RoCard(0);
      c.card.innerHTML = c.head(0, "얼굴 만들기에 실패했어요", "기본 얼굴로 시작할 수 있어요 · 다른 사진으로 다시 해 봐도 돼요(얼굴이 정면으로 잘 보이는 사진이 좋아요)");
      c.shake();
      var basic = c.mainBtn("기본 얼굴로 시작");
      basic.onclick = function () { useDefaultFace(); };
      c.card.appendChild(basic);
      var again = c.defaultFaceBtn("사진 다시 올리기");
      again.onclick = function () { if (st.thumb) URL.revokeObjectURL(st.thumb); st.thumb = null; showPhoto(); };
      c.card.appendChild(again);
    };
    // 생성 얼굴 없이 기본 얼굴 고르기로 — 기다림을 멈추고 생성 작업은 버린다(서버 접속은 OnHtmlNewStart 로 이미 기다리는 중)
    var useDefaultFace = function () {
      waiting = false; result = null;
      if (st.faceQueue) { st.faceQueue.cancel(); st.faceQueue = null; } st.faceQ = null;
      uploadEpoch++; if (uploadAbort) uploadAbort.abort(); uploadAbort = null;
      discardJob(st.job); st.job = ""; st.up = null;
      clearFaceProgress();
      if (st.thumb) URL.revokeObjectURL(st.thumb); st.thumb = null;
      if (!st.newStart) { st.newStart = Promise.resolve(); window.__roSttAuth = { n: st.name, p: st.pin }; SendMessage("NetSession", "OnHtmlNewStart", JSON.stringify({ name: st.name, pin: st.pin, gender: st.gender, race: st.race, job: "", keep: RoKeepPref() })); }
      randomEnter();   // 미리보기 폐기(2026-11-21) — 기본 머리 셋 중 무작위로 바로
    };

    // 녹음한 목소리 작업 지켜보기(2026-11-10) — 녹음 직후부터(프롤로그 동안) 1.5초마다 /voice/status, 확인 화면이 voiceUi 로 그린다.
    //   실패·404·10분 넘김이면 작업을 버리고 기본 목소리로(안내 한 줄)
    var voiceUi = null, voiceTimer = null;
    var stopVoiceWatch = function () { clearTimeout(voiceTimer); voiceTimer = null; };
    var discardVoice = function () {
      var vo = st.voice;
      if (vo && vo.queue) { vo.queue.cancel(); vo.queue = null; }
      if (vo && vo.job && vo.state !== "picked") { var job = vo.job; vo.job = ""; getBase().then(function (b) { fetch(b + "/voice/discard?job=" + encodeURIComponent(job), { method: "POST" }).catch(function () {}); }, function () {}); }
    };
    var voiceFail = function (vo, note) {
      if (st.voice !== vo || vo.state !== "baking") return;
      discardVoice(); vo.state = "fail"; vo.note = note || "보이스를 만들지 못해 기본 보이스로 갑니다";
      if (voiceUi) voiceUi();
    };
    var pollVoice = function (vo) {
      if (st.voice !== vo || vo.state !== "baking") return;
      if (Date.now() - vo.started > 600000) { voiceFail(vo); return; }
      var ac = new AbortController(), t = setTimeout(function () { ac.abort(); }, 10000);
      getBase().then(function (b) { return fetch(b + "/voice/status?job=" + encodeURIComponent(vo.job), { cache: "no-store", signal: ac.signal }); })
        .then(function (r) { clearTimeout(t); if (r.status === 404) return { fail: true }; if (!r.ok) throw new Error("voice status " + r.status); return r.json(); })
        .then(function (s) {
          if (st.voice !== vo || vo.state !== "baking") return;
          vo.errors = 0;
          if (Number(s.expect) > 0) vo.expect = Math.max(3, Number(s.expect));
          if (s.fail) { voiceFail(vo); return; }
          if (s.done) { vo.state = "done"; if (voiceUi) voiceUi(); return; }
          if (voiceUi) voiceUi();
          voiceTimer = setTimeout(function () { pollVoice(vo); }, 1500);
        }).catch(function (e) {
          clearTimeout(t);
          if (st.voice !== vo || vo.state !== "baking") return;
          console.warn("[목소리] 상태 확인 실패", e);
          voiceTimer = setTimeout(function () { pollVoice(vo); }, 3000);   // 10분 시한은 위에서
        });
    };
    // 목소리 줄 서기(2026-11-10) — 녹음을 보냈는데 굽기 자리가 차 있으면 확인 화면 버튼에 '줄 서는 중 · 앞에 N명', 차례가 오면 굽기로
    var queueVoice = function (vo, q) {
      vo.state = "queued"; vo.pos = Number(q.pos) || 1; vo.wait = Number(q.wait) || 0;
      getBase().then(function (b) {
        if (st.voice !== vo || vo.state !== "queued") return;
        var qw = vo.queue = RoQueueWait(b, "voice", q, function (p, w) { vo.pos = p; vo.wait = w; if (voiceUi) voiceUi(); });
        qw.promise.then(function (res) {
          if (vo.queue === qw) vo.queue = null;
          if (res.cancelled) return;
          if (st.voice !== vo || vo.state !== "queued") {
            if (res.job) fetch(b + "/voice/discard?job=" + encodeURIComponent(res.job), { method: "POST" }).catch(function () {});
            return;
          }
          if (res.job) {
            vo.job = res.job; vo.state = "baking"; vo.started = Date.now();
            if (res.expect > 0) vo.expect = Math.max(3, res.expect);
            if (voiceUi) voiceUi();
            pollVoice(vo); return;
          }
          vo.state = "fail"; vo.note = "줄에서 자리가 사라져 기본 보이스로 갑니다 · 다시 녹음하면 다시 줄을 서요";
          if (voiceUi) voiceUi();
        });
      }, function () {
        if (st.voice !== vo || vo.state !== "queued") return;
        vo.state = "fail"; vo.note = "보이스 서버에 닿지 못해 기본 보이스로 갑니다";
        if (voiceUi) voiceUi();
      });
    };
    // RoVoiceStep(녹음만)이 넘긴 값 — {job, uploads} = 녹음함, "" = 건너뜀
    var startVoiceWatch = function (v) {
      stopVoiceWatch();
      st.voiceRec = v || "";
      if (v && v.uploads) st.voiceUploads = v.uploads;
      var job = v && v.job || "";
      st.voice = { job: job, state: job ? "baking" : "none", started: Date.now(), expect: 15, note: "", errors: 0 };
      if (job) pollVoice(st.voice);
      else if (v && v.queue && v.queue.ticket) queueVoice(st.voice, v.queue);
    };
    // '모험 시작' — 목소리 작업이 끝났으면 pick → OnHtmlVoice(번호), 아니면 보내지 않음(기본 목소리, 작업은 버림). 그다음 머리 크기·얼굴(= 접속).
    //   OnHtmlNewStart 를 보낸 뒤에만 보낸다(사진 올리기 응답이 늦을 때)
    // 새 캐릭터 흐름이 쥔 큰 자원을 접속 직전에 모두 놓는다(2026-11-11 아이폰 — 얼굴 고른 뒤 월드를 여는 순간 사파리 탭 메모리 초과로 첫 화면 복귀).
    //   얼굴 미리보기·후보 시트 객체 URL, 회전 타이머·미리보기 그림, 사진 미리보기 URL, 카메라, 얼굴 진행 판, 프롤로그(소리)·미리 깨운 소리 요소, 종족 외침, 카드 안 그림·영상·캔버스.
    //   서버 작업(얼굴 job·목소리)은 버리지 않는다(접속에 쓰인다). 이 흐름은 여기서 끝나고, 접속이 거절돼 새 캐릭터를 다시 열면 RoNewFlow 가 새로 만든다(미리 깨운 소리도 그때 다시)
    var releaseOnboarding = function () {
      try {
        Object.keys(preCache).forEach(function (k) { preCache[k].then(function (o) { if (o) URL.revokeObjectURL(o); }, function () {}); }); preCache = {};
        if (disposePreview) disposePreview();
        stopCam(); clearFaceProgress();
        if (st.thumb) { URL.revokeObjectURL(st.thumb); st.thumb = null; }
        if (st.prologueStop) { st.prologueStop(); st.prologueStop = null; }
        var kill = function (a) { if (!a) return; try { a.pause(); a.removeAttribute("src"); a.load(); } catch (_) {} };
        var PR = window.__roAudioPrime; if (PR) { kill(PR.bgm); kill(PR.voice); window.__roAudioPrime = null; }
        kill(window.__roRaceVoice); window.__roRaceVoice = null;
        var cardEl = document.getElementById("ro-name-card");
        if (cardEl) {
          cardEl.querySelectorAll("video").forEach(function (v) { try { v.pause(); v.srcObject = null; v.removeAttribute("src"); v.load(); } catch (_) {} });
          cardEl.querySelectorAll("audio").forEach(kill);
          cardEl.querySelectorAll("canvas").forEach(function (cv) { cv.width = cv.height = 0; });
          cardEl.querySelectorAll("img").forEach(function (im) { im.removeAttribute("src"); });
          cardEl.querySelectorAll("[style*='background-image']").forEach(function (el) { el.style.backgroundImage = "none"; });
          cardEl.remove(); entry.busy("캐릭터를 준비하고 있습니다");   // 빈 카드를 남기지 않고 가운데 로딩으로
        }
      } catch (e) { console.warn("[새 캐릭터] 정리 실패", e); }
    };
    window.roReleaseOnboarding = releaseOnboarding;
    var enterGame = function (face, scale) {
      if (st.faceFirst && !st.prologueSeen) {
        st.prologueSeen = true; entry.hideBusy();
        st.prologueStop = RoPrologue(st.race, function () { st.prologueStop = null; enterGame(face, scale); }, true);
        return;
      }
      var vo = st.voice; voiceUi = null; stopVoiceWatch();
      entry.busy("캐릭터를 준비하고 있습니다");
      var send = function (voice) {
        (st.newStart || Promise.resolve()).then(function () {
          SendMessage("NetSession", "OnHtmlVoice", String(voice || ""));   // 늘 보낸다 — 빈 값이면 게임이 ro_voice 를 지워 기본 목소리(다른 계정 쓰던 기기에서 옛 목소리가 따라가지 않게, 2026-11-10 사운드 세션)
          SendMessage("NetSession", "OnHtmlHeadScale", String(scale));
          releaseOnboarding();   // 접속(월드 열기) 직전 — 흐름이 쥔 그림·소리·카메라를 놓는다
          SendMessage("NetSession", "OnHtmlFace", face);
        });
      };
      if (!vo || !vo.job || vo.state !== "done") { discardVoice(); send(""); return; }
      var ac = new AbortController(), t = setTimeout(function () { ac.abort(); }, 20000);
      fetch(st.base + "/voice/pick?job=" + encodeURIComponent(vo.job), { method: "POST", signal: ac.signal })
        .then(function (r) { clearTimeout(t); if (!r.ok) throw new Error("pick " + r.status); return r.json(); })
        .then(function (j) {
          var no = j && j.voice != null ? String(j.voice) : "";
          if (!no) throw new Error("pick 빈 번호");
          vo.state = "picked"; send(no);
        }).catch(function (e) { clearTimeout(t); console.warn("[목소리] 고르기 실패 — 기본 목소리로", e); discardVoice(); send(""); });
    };

    // ── 바로 접속(2026-11-21 기획 세션 plan_intro_raid 1절, 사용자 확정) — 사진(·목소리)을 넣었으면 프롤로그 뒤 대기·고르기 없이 기본 얼굴로 바로 접속하고
    //   (NetSession.OnHtmlFacePending("1") → OnHtmlFace("")), 게임 안에서도 /face/status(1초)·/voice/status(1.5초)를 계속 묻는다.
    //   얼굴 1장째가 나오면 바로 /face/pick → NetSession.OnHtmlFaceLate(번호) — 게임은 첫 입장 연출(기획)이 마법진에서 FacePending 이 풀리길 기다린다.
    //   실패(올리기 실패·후보 0·시한 넘김)면 게임 화면 위에 고르기 창(기본 얼굴로 / 사진 다시). 크레딧 소진(503)·거듭 실패(2번)는 묻지 않고 기본 얼굴.
    //   목소리는 끝나는 대로 /voice/pick → OnHtmlVoice(번호), 실패면 기본 목소리 그대로. 랜덤 캐릭터(사진 없음)는 randomEnter(확인 화면 없음).
    var autoRun = 0;
    var autoEnter = function () {
      var vo = st.voice; voiceUi = null; stopVoiceWatch();
      entry.busy("캐릭터를 준비하고 있습니다");
      (st.newStart || Promise.resolve()).then(function () {
        SendMessage("NetSession", "OnHtmlFacePending", "1");
        SendMessage("NetSession", "OnHtmlVoice", "");   // 목소리는 끝나면 따로 보낸다(그전까진 기본)
        SendMessage("NetSession", "OnHtmlHeadScale", "110");   // 나만의 캐릭터 기본 머리 크기 110%(2026-11-23 사용자) — 얼굴이 나온 뒤 묻는 창에서 작게 100 / 크게 120
        releaseOnboarding();   // 접속(월드 열기) 직전 — 흐름이 쥔 그림·소리·카메라를 놓는다(얼굴 진행 묻기도 멈추므로 아래에서 새로)
        entry.cleanup = null;   // 월드가 열리면 entry.ready → cancel → cleanup 이 얼굴·목소리 작업을 버린다 — 이제 접속 뒤에 끝내야 하므로 떼어 둔다
        window.__roLateOk = 1;   // 로그인 카드가 다시 열리면(나감·접속 실패) 0 — 늦게 온 얼굴·목소리를 다른 계정에 보내지 않게
        SendMessage("NetSession", "OnHtmlFace", "");
        autoFace(); autoVoice(vo);
      });
    };
    var autoLate = function (face) { if (!window.__roLateOk) return; try { SendMessage("NetSession", "OnHtmlFaceLate", face || ""); } catch (e) { console.warn("[얼굴] 끼우기 보내기 실패", e); } };
    var autoFace = function () {
      var run = ++autoRun, up = st.up;
      if (!up) { autoFail(); return; }
      up.then(function (job) {
        if (run !== autoRun) return;
        if (!job) { autoFail(); return; }
        var t0 = Date.now(), errors = 0;
        var poll = function () {
          if (run !== autoRun) return;
          var ac = new AbortController(), to = setTimeout(function () { ac.abort(); }, 12000);
          fetch(st.base + "/face/status?job=" + encodeURIComponent(job), { cache: "no-store", signal: ac.signal })
            .then(function (r) { clearTimeout(to); if (!r.ok) throw new Error("status " + r.status); return r.json(); })
            .then(function (s) {
              if (run !== autoRun) return;
              errors = 0;
              var done = s.done || [], failed = s.fail || [], n = Math.max(done.length, failed.length), over = n > 0, first = -1;
              for (var i = 0; i < n; i++) { if (done[i]) { if (first < 0) first = i; } else if (!failed[i]) over = false; }
              var expired = (Date.now() - t0) / 1000 > Math.max(120, (s.expect || 20) * 6);
              if (first >= 0) autoPick(run, job, first, 0);   // 생성 1장째 그대로(고르기 없음)
              else if (over || expired) autoFail();
              else setTimeout(poll, 1000);
            }).catch(function (e) {
              clearTimeout(to);
              if (run !== autoRun) return;
              if (++errors > 15) { console.warn("[얼굴] 진행 확인 실패", e); autoFail(); return; }
              setTimeout(poll, 2000);
            });
        };
        poll();
      });
    };
    var autoPick = function (run, job, i, tries) {
      var ac = new AbortController(), to = setTimeout(function () { ac.abort(); }, 20000);
      fetch(st.base + "/face/pick?job=" + encodeURIComponent(job) + "&i=" + i, { method: "POST", signal: ac.signal })
        .then(function (r) { clearTimeout(to); if (!r.ok) throw new Error("pick " + r.status); return r.json(); })
        .then(function (j) {
          if (run !== autoRun) return;
          var face = j && j.face ? String(j.face) : "";
          if (!face) throw new Error("pick 빈 번호");
          st.job = ""; st.up = null;
          autoLate(face);
        }).catch(function (e) {
          clearTimeout(to);
          if (run !== autoRun) return;
          if (tries < 3) { setTimeout(function () { autoPick(run, job, i, tries + 1); }, 2000); return; }   // 같은 job·i 다시 고르기는 서버가 같은 번호를 준다(감사 A16)
          console.warn("[얼굴] 고르기 실패", e); autoFail();
        });
    };
    var autoFail = function () {
      var run = ++autoRun;
      st.photoFails = (st.photoFails || 0) + 1;
      if (st.job) { discardJob(st.job); st.job = ""; } st.up = null;
      if (st.upErr === 503 || st.photoFails >= 2) { autoLate(""); return; }   // 다시 해도 안 됨·거듭 실패 = 묻지 않고 기본 얼굴(2026-11-10·11-14 사용자)
      // 게임 화면(마법진) 위 고르기 창 — 게임 HTML 카드 색(갈색 판·금테)을 따르는 작은 창. 안 보이는 사진 입력은 창 안에
      var old = document.getElementById("ro-late-face"); if (old) old.remove();
      var box = document.createElement("div"); box.id = "ro-late-face";
      box.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483000;width:min(86vw,360px);box-sizing:border-box;padding:18px 18px 16px;" +
        "border:3px solid #C9963F;border-radius:18px;background:radial-gradient(ellipse at top,#71462c,#352014 80%);color:#fff1cd;text-align:center;box-shadow:0 12px 36px #000a;font-family:inherit";
      box.innerHTML = "<div style='font-size:19px;font-weight:900;margin-bottom:6px'>얼굴 만들기에 실패했어요</div>" +
        "<div style='font-size:13px;opacity:.85;line-height:1.5;margin-bottom:12px'>기본 얼굴로 시작하거나, 얼굴이 정면으로 잘 보이는 사진으로 다시 해 볼 수 있어요</div>";
      var btn = function (label, main) {
        var b = document.createElement("button"); b.type = "button"; b.textContent = label;
        b.style.cssText = "display:block;width:100%;margin-top:8px;padding:12px 10px;font:inherit;font-size:17px;font-weight:900;border-radius:14px;cursor:pointer;" +
          (main ? "border:3px solid #d7891b;border-top-color:#fff1a9;background:linear-gradient(#ffe78a,#ffc336 48%,#efa214);color:#452108;box-shadow:inset 0 2px #fff8,0 4px 0 #793b0d"
                : "border:2px solid #C9963F;background:rgba(201,150,63,.12);color:#EBDDBC");
        box.appendChild(b); return b;
      };
      var basic = btn("기본 얼굴로", true), again = btn("사진 다시", false);
      var pick = document.createElement("input"); pick.type = "file"; pick.accept = "image/*"; pick.style.display = "none"; box.appendChild(pick);
      basic.onclick = function () { if (run !== autoRun) return; box.remove(); autoLate(""); };
      again.onclick = function () { pick.click(); };
      pick.onchange = function () {
        var f = pick.files && pick.files[0];
        if (!f || run !== autoRun) return;
        box.remove();
        st.faceFile = f; upload(f); autoFace();   // 같은 이름·종족·성별·의상으로 다시 — 결과는 같은 길(1장째 그대로 끼움)
      };
      if (!window.__roLateOk) return;
      document.body.appendChild(box);
    };
    var autoVoice = function (vo) {
      if (!vo || !vo.job && vo.state !== "queued") return;   // 녹음 안 함 = 기본 목소리
      if (vo.state === "baking") pollVoice(vo);   // releaseOnboarding 전에 멈춘 묻기를 다시
      var check = function () {
        if (st.voice !== vo) return;
        if (vo.state === "fail" || vo.state === "picked" || vo.state === "none") return;   // 실패 = 기본 목소리 그대로
        if (vo.state !== "done") { setTimeout(check, 1000); return; }
        var ac = new AbortController(), to = setTimeout(function () { ac.abort(); }, 20000);
        fetch(st.base + "/voice/pick?job=" + encodeURIComponent(vo.job), { method: "POST", signal: ac.signal })
          .then(function (r) { clearTimeout(to); if (!r.ok) throw new Error("pick " + r.status); return r.json(); })
          .then(function (j) {
            var no = j && j.voice != null ? String(j.voice) : "";
            if (!no) throw new Error("pick 빈 번호");
            vo.state = "picked"; if (window.__roLateOk) SendMessage("NetSession", "OnHtmlVoice", no);
          }).catch(function (e) { clearTimeout(to); console.warn("[목소리] 고르기 실패 — 기본 목소리로", e); discardVoice(); });
      };
      check();
    };

    // 랜덤 캐릭터(2026-11-21 사용자 "나만의 캐릭터 vs 랜덤 캐릭터 — 랜덤은 프리셋 3종 중 무작위로 바로 시작, 미리보기 화면 폐기") —
    //   얼굴·목소리 확인 화면(choose)은 지웠다. 기본 머리 셋 중 하나를 골라 프롤로그(아직이면) 뒤 바로 접속, 목소리는 기본
    var randomEnter = function () {
      var heads = presetHeads(), head = heads[Math.floor(Math.random() * heads.length)];
      st.faceFirst = true;   // 프롤로그를 아직 안 봤으면 enterGame 이 먼저 튼다
      enterGame("preset:" + head, 100);
    };

    if (resume && (resume.race === 0 || resume.race === 1) && /^[0-9]{8}$/.test(resume.pin || "") && resume.name) {
      st.name = resume.name; st.pin = resume.pin; st.gender = resume.gender === 1 ? 1 : 0; st.race = resume.race;
      st.detail = resume.detail === 1 ? 1 : 0; st.acc = Array.isArray(resume.acc) ? resume.acc : [];
      document.documentElement.dataset.roUiRace = st.race === 1 ? "orc" : "human";
      SendMessage("NetSession", "OnHtmlRace", String(st.race));
      // 2026-11-10 사용자 "사진이 계속 걸리면(실패하면) 자동으로 다음으로 — 사진은 기본 결정된 걸로 스킵": 두 번째 새로 열림이면 사진 없이(기본 얼굴) 다음 단계로
      st.photoFails = (Number(resume.fails) || 0) + 1;
      if (st.photoFails >= 2) { st.noPhoto = true; st.photoNotice = ""; afterPhoto(); return; }
      st.resumeNotice = "사진을 고르는 동안 화면이 새로 열렸어요. 사진을 다시 넣어 주세요";
      showPhoto();
    } else showRace();
  },

  // 새 캐릭터 카드 — 없는 이름으로 로그인하면 서버가 띄운다. 종족 → 성별(지금 접속 카드의 두 단계 그대로).
  //   '모험 시작' = OnHtmlGender → OnHtmlRace → OnHtmlNewChar(""), 처음 단계에서 뒤로 = OnHtmlNewCharBack("")(로그인 카드로)
  RoNewCharOpen__deps: ["$RoCard", "$RoEntryUI"],
  RoNewCharOpen: function (defRace, defGender) {
    RoEntryUI().cancel();
    // 새 계정 비밀번호는 숫자 8자리만(2026-11-23) — 로그인 카드에 없는 이름 + 예전 4자리를 넣고 왔으면 만들지 않고 로그인 카드로 돌려보내 8자리를 다시 받는다(서버는 4자리 새 계정을 거절한다)
    var auP = (window.__roSttAuth && window.__roSttAuth.p) || "";
    if (auP && !/^[0-9]{8}$/.test(auP)) {
      window.__roLoginNote = "새 계정 비밀번호는 숫자 8자리예요";
      setTimeout(function () { SendMessage("NetSession", "OnHtmlNewCharBack", ""); }, 0);   // C# 호출 안에서 바로 되부르지 않게 한 박자 뒤
      return;
    }
    var race = defRace === 1 ? 1 : 0;
    var gender = defGender === 1 ? 1 : 0;
    var c = RoCard(2);
    var showGender, showRace, showPin;
    var pin0 = window.__roSttAuth && /^[0-9]{8}$/.test(window.__roSttAuth.p || "") ? window.__roSttAuth.p : "";   // 로그인 카드에서 넣은 비번(없으면 확인 단계 없이)
    var steps = pin0 ? 3 : 2;
    var backToLogin = function () { c.wrap.remove(); RoEntryUI().cancel(); SendMessage("NetSession", "OnHtmlNewCharBack", ""); };
    showGender = function () {
      c.wrap.classList.remove("ro-race-card");
      c.card.innerHTML = c.raceShell(steps, "성별 선택", "모험가의 모습을 골라 주세요", steps); c.wrap.classList.add("ro-race-wide");   // 이 흐름은 (비번 확인 →) 종족 → 성별(QA B10)
      c.anim();
      c.card.appendChild(c.genderTiles(function () { return gender; }, function (v) { gender = v; }, race === 1));
      var next = c.mainBtn("모험 시작");
      next.onclick = function () {
        c.wrap.remove(); RoEntryUI().busy("캐릭터를 준비하고 있습니다");
        SendMessage("NetSession", "OnHtmlGender", String(gender));
        SendMessage("NetSession", "OnHtmlRace", String(race));
        SendMessage("NetSession", "OnHtmlNewChar", "");
      };
      c.card.appendChild(next); c.card.appendChild(c.stepBack(showRace));   // 뒤로가기 = 종족
      c.padTo(next);
    };
    showRace = function () {
      RoEntryUI().setRacePreview(false);
      SendMessage("NetSession", "OnHtmlRacePreviewReset", "");
      c.card.innerHTML = c.raceShell(steps - 1, null, null, steps); c.wrap.classList.add("ro-race-wide");
      c.anim();
      c.card.appendChild(c.raceTiles(function () { return race; }, function (v) { race = v; document.documentElement.dataset.roUiRace = v === 1 ? "orc" : "human"; RoEntryUI().setRacePreview(false); SendMessage("NetSession", "OnHtmlRace", String(v)); go.disabled = false; }));
      var go = c.mainBtn("결정"); go.classList.add("ro-race-next");
      go.disabled = race !== 0 && race !== 1; go.onclick = function () { c.raceH = c.card.offsetHeight; c.wrap.classList.remove("ro-race-card"); showGender(); };   // 이전 종족이 골라진 채 뜨므로 켜 둔다(QA B9 — 늘 꺼 두면 '다음'이 무반응)
      go.style.marginTop = "6px"; c.card.appendChild(go);
      c.card.appendChild(c.stepBack(pin0 ? showPin : backToLogin));   // 뒤로가기 = 비번 확인(있으면) / 로그인 카드
    };
    // 비밀번호 확인(2026-11-19 사용자 "새 계정이 생기는 모든 길에서 두 번 묻는다") — 로그인 카드에 넣은 비번(__roSttAuth, 메모리)과 같아야 다음으로.
    //   다르면 만들지 않고 다시 묻는다. 처음 넣은 비번이 틀렸다고 느끼면 '← 로그인으로'에서 다시 넣는다
    showPin = function () {
      c.wrap.classList.remove("ro-race-wide");
      c.card.innerHTML = c.raceShell(1, "비밀번호 확인", "새 모험가를 만들어요 · 비밀번호를 한 번 더 넣어 주세요", steps);
      c.anim();
      var err = c.errLine(), inp, paint;
      var go = function () {
        if (!/^[0-9]{8}$/.test(inp.value)) { err.textContent = "비밀번호는 숫자 8자리예요"; c.shake(); inp.focus(); return; }
        if (inp.value !== pin0) { err.textContent = "처음 넣은 비밀번호와 달라요 · 다시 넣어 주세요"; c.shake(); inp.value = ""; paint(); inp.focus(); return; }
        inp.blur(); showRace();
      };
      inp = c.input("비밀번호 확인 · 한 번 더", go);
      inp.type = "password"; inp.maxLength = 8; inp.setAttribute("inputmode", "numeric"); inp.setAttribute("pattern", "[0-9]*"); inp.setAttribute("enterkeyhint", "next");
      inp.autocomplete = "one-time-code"; inp.setAttribute("aria-label", "비밀번호 확인 숫자 8자리");
      paint = c.pinBoxes(inp, 72);
      inp.oninput = function () { var v = inp.value.replace(/[^0-9]/g, "").slice(0, 8); if (v !== inp.value) inp.value = v; paint(); if (err.textContent) err.textContent = ""; if (inp.value.length === 8) go(); };
      c.card.appendChild(err);
      var next = c.mainBtn("다음"); next.classList.add("ro-race-next"); next.style.marginTop = "6px"; next.onclick = go;
      c.card.appendChild(next);
      c.card.appendChild(c.stepBack(backToLogin));   // 뒤로가기 = 로그인 카드(비번을 다시 넣는다)
      setTimeout(function () { inp.focus({ preventScroll: true }); }, 60);
    };
    if (pin0) showPin(); else showRace();
  },

  // 열린 입력줄의 안내 글만 바꾼다 — 채팅 탭(전체·개발)을 바꿨을 때(2026-11-17 QA v0.1.146 '개발 탭 안내 글이 남음'). 닫혀 있으면 아무것도 안 함
  RoChatHint: function (placeholderPtr) {
    var bar = document.getElementById("ro-chat-bar"), inp = document.getElementById("ro-chat-input");
    if (!bar || !inp || bar.style.display === "none") return;
    var ph = UTF8ToString(placeholderPtr), was = inp.dataset.ph;
    inp.dataset.ph = ph;
    if (inp.placeholder === was) inp.placeholder = ph;   // 마이크 안내처럼 잠깐 띄운 글이면 그 글이 끝날 때 새 안내 글로 돌아간다
  },
  // 게임 채팅 창의 보내기(종이비행기) 버튼 — 열린 입력줄에 친 글을 꺼내고 비운다(없으면 빈 글). 글은 NetChat 이 엔터·HTML 보내기와 같은 Send 로 보낸다
  //   2026-11-20 QA v0.1.166: 웹에선 이 버튼이 늘 '창 닫기'라 '/qa tp …' 를 쳐 놓고 눌러도 안 보내지고 글만 입력칸에 남았다
  RoChatTake: function (peek) {
    var bar = document.getElementById("ro-chat-bar"), inp = document.getElementById("ro-chat-input");
    var v = (bar && inp && bar.style.display !== "none" && inp.value.trim().length) ? inp.value : "";
    if (v && !peek) { inp.value = ""; inp.maxLength = 60; inp.focus({ preventScroll: true }); }
    var size = lengthBytesUTF8(v) + 1;
    var buf = _malloc(size);
    stringToUTF8(v, buf, size);
    return buf;
  },
  // 채팅창을 닫으면 입력줄도 숨긴다(ChatView 닫기 → NetChat.CloseInput)
  RoChatClose: function () {
    var bar = document.getElementById("ro-chat-bar");
    if (!bar) return;
    if (window.__roChatHide) { window.__roChatHide(); return; }
    bar.style.display = "none";
    var inp = document.getElementById("ro-chat-input");
    if (inp) inp.blur();
  },
  // 게임 화면에서 브라우저 기본 손가락 동작(두 손가락 확대·스크롤·당겨서 새로 고침)을 끈다 — 안 끄면 크롬이 두 손가락 동작 중
  // 터치를 취소해 게임의 두 손가락 확대·축소가 '가끔만' 됐다(2026-11-02)
  RoDisableBrowserGestures: function () {
    var c = document.querySelector("#unity-canvas");
    if (c) c.style.touchAction = "none";
    document.body.style.touchAction = "none";
    document.body.style.overscrollBehavior = "none";
    if (!window.__roGestureOff) { window.__roGestureOff = true; document.addEventListener("gesturestart", function (e) { e.preventDefault(); }, { passive: false }); }
  },
  // 버그·의견 입력 카드 — 브라우저 prompt 대신 진짜 HTML 글칸(2026-11-21 사용자 '휴대폰에서 시스템 창이 먼저 뜨고 키보드가 안 올라온다').
  //   채팅 입력줄(RoChatOpen)과 같은 방식: 포커스 재시도(120·400ms) + 0.45초 뒤에도 포커스가 없으면 다음 한 번의 터치에서 포커스(금빛 '여기를 눌러 입력').
  //   보내기 = go.OnHtmlFeedback(글), 닫기·바깥 누름 = go.OnHtmlFeedbackClose(글 — 쓰던 글을 남겨 둘 수 있게). 닫기 버튼은 아래 가운데.
  //   RoTextCard = 같은 카드를 여러 창이 쓰도록 뺀 몸통(2026-11-21 채널 '이름으로 찾기'도 씀) — okM·closeM = 알릴 메서드 이름, single = 한 줄 입력(엔터 = 확인, 글자 수 표시 없음).
  //   photo(의견 카드만) = undefined 면 사진 줄 없음, "" = '사진 붙이기' 단추, JPG base64 = 작은 미리 보기 + '떼기'(2026-11-22 플레이어 신고 #10, 서버 BugShot).
  //     단추 = go.OnHtmlFeedbackPhoto(글)·OnHtmlFeedbackPhotoClear(글) — 카드를 닫고 게임이 사진 고르기(RoBugShotPick)를 띄운 뒤 다시 연다
  $RoTextCard: function (title, ph, text, go, okM, closeM, MAX, okLabel, single, photo, minLen, note) {   // minLen·note = 의견 창만(최소 글자 수·제목 아래 안내 줄, 2026-11-22 QA v0.1.178)
    var old = document.getElementById("ro-fb-layer");
    if (old) { var ta0 = document.getElementById("ro-fb-text"); if (ta0) ta0.focus({ preventScroll: true }); return; }   // 두 번 열기 막기
    if (!(MAX > 0)) MAX = 300;
    var layer = document.createElement("div");
    layer.id = "ro-fb-layer";
    layer.style.cssText = "position:fixed;left:0;top:0;width:100%;height:100%;z-index:10000;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;" +
      "padding:12px;box-sizing:border-box;font-family:'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif;pointer-events:none;";
    var card = document.createElement("div");
    card.style.cssText = "width:min(560px,calc(100vw - 24px));max-height:100%;overflow:auto;box-sizing:border-box;padding:18px 18px 14px;border-radius:8px;" +
      "background:var(--ro-ui-bg,#2E2018);border:2px solid var(--ro-ui-edge,#C9963F);box-shadow:0 8px 28px rgba(0,0,0,0.6);display:flex;flex-direction:column;gap:10px;";
    var head = document.createElement("div");
    head.textContent = title;
    head.style.cssText = "text-align:center;font-size:19px;font-weight:bold;color:#f3ca73;word-break:keep-all;";
    var ta = document.createElement(single ? "input" : "textarea");
    if (single) { ta.type = "text"; ta.setAttribute("enterkeyhint", "search"); } else ta.rows = 5;
    ta.id = "ro-fb-text"; ta.maxLength = MAX; ta.placeholder = ph; ta.value = (text || "").slice(0, MAX);
    ta.setAttribute("autocomplete", "off");
    ta.style.cssText = "width:100%;box-sizing:border-box;resize:none;" + (single ? "" : "min-height:120px;") + "font-size:17px;line-height:1.45;padding:10px 12px;border-radius:6px;" +
      "border:1px solid var(--ro-ui-edge,#C9963F);background:#EBDDBC;color:var(--ro-ui-bg,#2E2018);outline:none;font-family:inherit;";
    var count = document.createElement("div");
    count.style.cssText = "text-align:right;font-size:13px;color:#cdb68a;margin-top:-4px;";
    var paintCount = function () { count.textContent = ta.value.length + " / " + MAX; };
    paintCount();
    var send = document.createElement("button");
    send.type = "button"; send.textContent = okLabel || "보내기";
    send.style.cssText = "width:100%;font-size:18px;padding:11px 16px;border-radius:6px;border:none;background:var(--ro-ui-button,#9E3B2E);color:#EBDDBC;font-weight:bold;";
    var close = document.createElement("button");
    close.type = "button"; close.textContent = "닫기";
    close.style.cssText = "align-self:center;min-width:120px;font-size:17px;padding:9px 22px;border-radius:6px;border:1px solid var(--ro-ui-edge,#C9963F);background:#5a4636;color:#EBDDBC;font-weight:bold;";
    var shot = null;
    if (typeof photo === "string") {
      shot = document.createElement("div");
      shot.style.cssText = "display:flex;align-items:center;gap:10px;";
      var sb = document.createElement("button"); sb.type = "button";
      sb.style.cssText = "flex:1;font-size:16px;padding:9px 12px;border-radius:6px;border:1px dashed var(--ro-ui-edge,#C9963F);background:#3d2c20;color:#EBDDBC;font-weight:bold;";
      if (photo.length) {
        var im = document.createElement("img"); im.src = "data:image/jpeg;base64," + photo;
        im.style.cssText = "width:64px;height:64px;object-fit:cover;border-radius:4px;border:1px solid var(--ro-ui-edge,#C9963F);";
        var lb = document.createElement("div"); lb.textContent = "사진 1장 붙음"; lb.style.cssText = "flex:1;font-size:15px;color:#cdb68a;";
        sb.textContent = "떼기"; sb.style.flex = "0 0 auto"; sb.style.minWidth = "80px";
        shot.appendChild(im); shot.appendChild(lb); shot.appendChild(sb);
        sb.onclick = function () { finish("OnHtmlFeedbackPhotoClear"); };
      } else {
        sb.textContent = "📷 사진 붙이기";
        shot.appendChild(sb);
        sb.onclick = function () { finish("OnHtmlFeedbackPhoto"); };
      }
    }
    var noteEl = null, warn = null;
    if (note) { noteEl = document.createElement("div"); noteEl.innerHTML = note; noteEl.style.cssText = "text-align:center;font-size:15px;color:#EBDDBC;word-break:keep-all;margin-top:-4px;"; }   // 우리 코드가 만든 고정 글(10골드 색)
    if (minLen > 0) { warn = document.createElement("div"); warn.style.cssText = "text-align:center;font-size:15px;font-weight:bold;color:#FF7A5C;min-height:0;"; }
    card.appendChild(head); if (noteEl) card.appendChild(noteEl); card.appendChild(ta); if (!single) card.appendChild(count); if (warn) card.appendChild(warn); if (shot) card.appendChild(shot); card.appendChild(send); card.appendChild(close);
    layer.appendChild(card);
    document.body.appendChild(layer);
    // 여는 터치 뒤에 따라오는 click 이 바로 새 카드(바깥 = 닫기)에 떨어지지 않게 잠깐 누름을 막는다
    setTimeout(function () { if (layer.isConnected) layer.style.pointerEvents = ""; }, 350);

    // 키보드가 올라와도 카드는 보이는 화면(visualViewport) 가운데 — 아이폰은 문서를 고정하고 밀리면 되돌린다, 안드로이드 overlays-content 는 VirtualKeyboard 위끝도 본다
    var de = document.documentElement, b = document.body;
    var saved = { de: de.style.overflow, bo: b.style.overflow, bp: b.style.position, bt: b.style.top, bl: b.style.left, bw: b.style.width, bh: b.style.height };
    de.style.overflow = "hidden"; b.style.overflow = "hidden"; b.style.position = "fixed"; b.style.top = "0"; b.style.left = "0"; b.style.width = "100%"; b.style.height = "100%";
    var fit = function () {
      if (!layer.isConnected) return;
      if (window.scrollY || window.scrollX || de.scrollTop || b.scrollTop) { window.scrollTo(0, 0); de.scrollTop = b.scrollTop = 0; }
      var vv = window.visualViewport;
      var top = vv ? vv.offsetTop : 0, bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      var vk = navigator.virtualKeyboard;
      if (vk && vk.overlaysContent && vk.boundingRect && vk.boundingRect.height > 0) bottom = Math.min(bottom, vk.boundingRect.top);
      layer.style.top = Math.round(top) + "px";
      layer.style.height = Math.max(120, Math.round(bottom - top)) + "px";
    };
    if (window.visualViewport) { window.visualViewport.addEventListener("resize", fit); window.visualViewport.addEventListener("scroll", fit); }
    if (navigator.virtualKeyboard) navigator.virtualKeyboard.addEventListener("geometrychange", fit);
    window.addEventListener("scroll", fit, { passive: true });
    ta.addEventListener("focus", function () { fit(); setTimeout(fit, 50); setTimeout(fit, 300); });
    ta.addEventListener("blur", function () { setTimeout(fit, 50); });
    fit();

    var once = null;
    var done = false;
    var finish = function (method) {
      if (done) return; done = true;
      var v = ta.value;
      if (once) document.removeEventListener("touchend", once, true);
      if (window.visualViewport) { window.visualViewport.removeEventListener("resize", fit); window.visualViewport.removeEventListener("scroll", fit); }
      if (navigator.virtualKeyboard) navigator.virtualKeyboard.removeEventListener("geometrychange", fit);
      window.removeEventListener("scroll", fit);
      ta.blur();
      if (layer.parentNode) layer.parentNode.removeChild(layer);
      de.style.overflow = saved.de; b.style.overflow = saved.bo; b.style.position = saved.bp; b.style.top = saved.bt; b.style.left = saved.bl; b.style.width = saved.bw; b.style.height = saved.bh;
      window.__roFeedbackClose = null;
      if (method && go) { try { SendMessage(go, method, v); } catch (_) {} }
    };
    window.__roFeedbackClose = function () { finish(null); };   // RoFeedbackClose(게임이 닫음) = 알림 없이 치우기
    send.onclick = function () {
      if (!ta.value.trim().length) { ta.focus({ preventScroll: true }); return; }
      if (minLen > 0 && ta.value.trim().length < minLen) { if (warn) warn.textContent = "조금 더 자세히 적어 주세요 (" + minLen + "자 이상)"; ta.focus({ preventScroll: true }); return; }   // 카드 안에서 바로 거절(토스트는 다시 열린 카드에 덮였다)
      finish(okM);
    };
    close.onclick = function () { finish(closeM); };
    layer.addEventListener("click", function (e) { if (e.target === layer) close.onclick(); });
    ta.addEventListener("input", paintCount);
    // 입력 중 키가 게임 조작(WASD 등)으로 새지 않게 — 채팅 입력줄과 같이 keydown·keyup·keypress 모두 막는다
    ta.onkeydown = function (e) {
      e.stopPropagation();
      if (e.key === "Escape") close.onclick();
      else if (single && e.key === "Enter" && !e.isComposing) { e.preventDefault(); send.onclick(); }   // 한 줄 입력 = 엔터로 확인(한글 조합 중 엔터는 무시)
    };
    ta.onkeyup = function (e) { e.stopPropagation(); };
    ta.onkeypress = function (e) { e.stopPropagation(); };

    ta.focus({ preventScroll: true });
    try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (_) {}
    setTimeout(function () { if (!done) ta.focus({ preventScroll: true }); }, 120);
    setTimeout(function () { if (!done && document.activeElement !== ta) ta.focus({ preventScroll: true }); }, 400);
    // 아이폰은 터치 처리 안에서만 focus 가 키보드를 띄운다 — 못 띄웠으면 다음 한 번의 터치에서 포커스, 그동안 글칸을 금빛으로
    setTimeout(function () {
      if (done || document.activeElement === ta) return;
      ta.placeholder = "여기를 눌러 입력";
      ta.style.boxShadow = "0 0 0 3px #FFD966,0 0 14px #FFD966aa";
      var calm = function () { ta.placeholder = ph; ta.style.boxShadow = ""; ta.removeEventListener("focus", calm); if (once) document.removeEventListener("touchend", once, true); };
      once = function (e) {
        document.removeEventListener("touchend", once, true);
        if (done) return;
        if (e.target && e.target.closest && e.target.closest("#ro-fb-layer button")) return;   // 보내기·닫기 누름은 그대로
        if (e.target === layer) return;   // 바깥 누름 = 닫기
        ta.focus({ preventScroll: true }); if (document.activeElement === ta) calm();
      };
      document.addEventListener("touchend", once, true);
      ta.addEventListener("focus", calm);
    }, 450);
  },
  RoFeedbackOpen__deps: ["$RoTextCard"],
  RoFeedbackOpen: function (titlePtr, placeholderPtr, textPtr, goPtr, photoPtr, minLen, notePtr) {
    var photo = UTF8ToString(photoPtr);   // "-" = 사진 못 붙임(줄 숨김)
    RoTextCard(UTF8ToString(titlePtr), UTF8ToString(placeholderPtr), UTF8ToString(textPtr), UTF8ToString(goPtr), "OnHtmlFeedback", "OnHtmlFeedbackClose", 300, "보내기", 0, photo === "-" ? undefined : photo,
      minLen, notePtr ? UTF8ToString(notePtr) : "");
  },
  // 같은 카드를 다른 창이 쓸 때 — 알릴 메서드 이름·글자 수·확인 글자·한 줄 여부를 정한다(채널 '이름으로 찾기')
  RoTextOpen__deps: ["$RoTextCard"],
  RoTextOpen: function (titlePtr, placeholderPtr, textPtr, goPtr, okPtr, closePtr, maxLen, okLabelPtr, singleLine) {
    RoTextCard(UTF8ToString(titlePtr), UTF8ToString(placeholderPtr), UTF8ToString(textPtr), UTF8ToString(goPtr),
      UTF8ToString(okPtr), UTF8ToString(closePtr), maxLen, UTF8ToString(okLabelPtr), singleLine ? 1 : 0);
  },
  // 버그·의견 입력 카드가 떠 있으면 닫는다(게임 쪽 창이 먼저 닫힐 때)
  RoFeedbackClose: function () {
    if (window.__roFeedbackClose) { window.__roFeedbackClose(); return; }
    var l = document.getElementById("ro-fb-layer");
    if (l && l.parentNode) l.parentNode.removeChild(l);
  },
  RoPrompt: function (msgPtr, defPtr) {
    var r = window.prompt(UTF8ToString(msgPtr), UTF8ToString(defPtr));
    if (r === null) r = "";
    var size = lengthBytesUTF8(r) + 1;
    var buf = _malloc(size);
    stringToUTF8(r, buf, size);
    return buf;
  }
});

// 로그인 카드를 엔진보다 먼저 띄우는 틀(뒤) — ro-pre-head.js 참고
  pre.hand = function (send) {   // 엔진 안 RoLoginOpen 이 부른다 — 이제부터 바로 보내고, 모아 둔 것을 차례로
    pre.handed = 1; window.__roUnitySend = send;
    var q = Q.splice(0);
    setTimeout(function () { q.forEach(function (x) { try { send(x[0], x[1], x[2]); } catch (e) {} }); }, 0);   // C# 호출 안에서 바로 되부르지 않게 한 박자 뒤
  };
  // 위쪽 작은 띠 — 카드를 쓰는 동안 엔진을 얼마나 받았는지(엔진이 켜지면 사라짐). %는 index.html 진행 콜백이 넣는 window.__roLoadPct
  var bar = document.createElement("div"); bar.id = "ro-pre-bar"; bar.setAttribute("aria-live", "polite");
  bar.style.cssText = "position:fixed;left:50%;top:max(8px,env(safe-area-inset-top));transform:translateX(-50%);z-index:2147482000;padding:4px 12px;border-radius:99px;background:#000a;color:#f3d5a0;font:700 12px/1.4 'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif;pointer-events:none;white-space:nowrap";
  var tick = setInterval(function () {
    // 유령 프롤로그 길은 엔진이 켜져도 혼자 장면 맵을 받는 동안 그대로 — C# 가 RoGhostIntroReady(장면 그려짐)를 부르거나 로그인 카드로 넘어가면(handed) 걷는다
    var ghostWait = pre.ghostBusy && !pre.handed && !window.__roInWorld;
    if (!ghostWait && (window.__roUnityReady || pre.handed || window.__roInWorld)) {
      clearInterval(tick); bar.remove();
      if (pre.keepBusy) {   // 저장 로그인 길 — 엔진이 켜지면 우리 로딩 화면을 걷어 유니티 쪽(소환진·입장)을 가리지 않게. 그새 C# 가 카드를 띄웠으면 그대로
        pre.keepBusy = 0;
        var u = RoEntryUI(); u.hideBusy();
        if (u.root && !document.getElementById("ro-name-card")) { u.root.remove(); u.root = u.top = null; }
      }
      return;
    }
    var p = Math.round((window.__roLoadPct || 0) * 100);
    // 90% 뒤(엔진을 다 받고 압축 풀기·wasm 준비 — 숫자가 30초 넘게 안 움직여 멈춘 줄 알았다, QA v0.1.183)는 숫자 대신 점이 도는 글
    bar.textContent = p >= 90 ? "세계의 문을 여는 중" + "...".slice(0, 1 + Math.floor(Date.now() / 400) % 3) : "세계를 불러오는 중 " + p + "%";   // 세계관 말투(2026-11-23 사용자 — '게임 받는 중'은 세계관과 안 맞음)
  }, 250);
  pre.open = function () {
    if (pre.opened || pre.handed || window.__roUnityReady) return;
    pre.opened = 1; document.body.appendChild(bar);
    var name = ""; try { name = localStorage.getItem("ro_login_name") || ""; } catch (e) {}
    RoLoginOpen("", "", name ? 0 : 4);   // 처음 온 기기(저장된 이름 없음) = 신규 큰 버튼 카드(C# tone 4 와 같은 뜻)
  };
  // 저장 로그인(로그인 유지 열쇠 있음 — 카드 없이 자동 접속) 길(2026-11-22 QA v0.1.165 "기본 로고 + 흰 막대만 보인다") — 카드 대신
  //   우리 로딩 화면(포링 + Loading…)과 '게임 받는 중 n%' 띠만. 엔진이 켜지면 위 tick 이 걷는다(그다음은 C#·유니티 화면)
  pre.openKeep = function () {
    if (pre.opened || pre.handed || window.__roUnityReady) return;
    pre.opened = 1; pre.keepBusy = 1; document.body.appendChild(bar);
    RoEntryUI().busy("게임을 준비하고 있습니다");
  };
  // 유령 프롤로그(2026-11-26 사용자 "계정보다 플레이 먼저", .claude/plan_ghost_intro.md) — 첫 방문은 로그인 카드 대신 로딩 화면 + 띠만.
  //   걷는 때 = C# 가 혼자 장면을 그리기 시작해 RoGhostIntroReady 를 부를 때(그 전까진 엔진이 켜져도 유지). C# 가 예전처럼 로그인 카드를 부르면 그대로 카드로
  pre.openGhost = function () {
    if (pre.opened || pre.handed || window.__roUnityReady) return;
    pre.opened = 1; pre.ghostBusy = 1; document.body.appendChild(bar);
    RoEntryUI().busy("세계를 준비하고 있습니다");
  };
})();
