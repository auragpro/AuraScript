// AuraScript — panneau HTML (CEP)
(function () {
    "use strict";

    var VERSION = "3.0.2";
    var cep = window.__adobe_cep__;
    var nodeRequire = (window.cep_node && window.cep_node.require) || (typeof require === "function" ? require : null);
    var fs = null, path = null, os = null, cp = null;
    try { fs = nodeRequire("fs"); path = nodeRequire("path"); os = nodeRequire("os"); cp = nodeRequire("child_process"); } catch (e) {}

    var $ = function (id) { return document.getElementById(id); };
    document.getElementById("version").textContent = "v" + VERSION;

    // =====================================================================
    // Pont vers After Effects (host.jsx)
    // =====================================================================

    function S(v) { return esc(JSON.stringify(String(v))); }          // chaîne simple
    function J(v) { return esc(JSON.stringify(JSON.stringify(v))); }  // données JSON
    function esc(s) { return s.split(String.fromCharCode(0x2028)).join("\\u2028").split(String.fromCharCode(0x2029)).join("\\u2029"); }

    function extensionPath() {
        if (!cep) return "";
        var p = cep.getSystemPath("extension") || "";
        p = decodeURI(p).replace(/^file:\/{2,3}/, "");
        return p;
    }

    function evalRaw(script) {
        return new Promise(function (resolve) {
            if (!cep) { resolve("EvalScript error."); return; }
            cep.evalScript(script, function (res) { resolve(res); });
        });
    }

    // Appelle AuraAPI.fn(args...) dans After Effects et renvoie { ok, msg, data }
    function host(fn) {
        var args = Array.prototype.slice.call(arguments, 1).join(", ");
        var script = "(function(){try{if(typeof AuraAPI==='undefined')return '{\"ok\":false,\"msg\":\"AuraScript n\\'est pas encore chargé dans After Effects.\"}';" +
            "return AuraAPI." + fn + "(" + args + ");}catch(e){return '{\"ok\":false,\"msg\":\"Erreur : '+String(e.message).replace(/[\"\\\\]/g,' ')+'\"}';}})()";
        return evalRaw(script).then(function (res) {
            try { return JSON.parse(res); }
            catch (e) { return { ok: false, msg: "Réponse inattendue d'After Effects : " + res }; }
        });
    }

    // Recharge la logique After Effects depuis le dossier de l'extension (utile après une mise à jour)
    function loadHost() {
        var p = extensionPath();
        if (!p) return Promise.resolve();
        return evalRaw("$.evalFile(" + S(p + "/host/host.jsx") + ")");
    }

    // =====================================================================
    // Messages, fenêtres
    // =====================================================================

    function status(msg) { $("status").textContent = msg || ""; $("status").title = msg || ""; }

    function showResult(r, silentOk) {
        if (!r) return;
        if (r.ok) { if (r.msg || !silentOk) status(r.msg || ""); }
        else if (r.msg) { status(r.msg); modal(r.msg, { cancel: false }); }
        return r;
    }

    // Petite fenêtre : modal(texte, { input: "valeur par défaut", cancel: true }) -> Promise(valeur | true | null)
    function modal(text, opts) {
        opts = opts || {};
        return new Promise(function (resolve) {
            $("modalText").textContent = text;
            var inp = $("modalInput");
            if (opts.input !== undefined) { inp.classList.remove("hidden"); inp.value = opts.input || ""; }
            else inp.classList.add("hidden");
            $("modalCancel").classList.toggle("hidden", opts.cancel === false);
            $("modal").classList.remove("hidden");
            if (opts.input !== undefined) setTimeout(function () { inp.focus(); inp.select(); }, 30);
            function done(v) {
                $("modal").classList.add("hidden");
                $("modalOk").onclick = $("modalCancel").onclick = null;
                inp.onkeydown = null;
                resolve(v);
            }
            $("modalOk").onclick = function () { done(opts.input !== undefined ? inp.value : true); };
            $("modalCancel").onclick = function () { done(null); };
            inp.onkeydown = function (e) { if (e.key === "Enter") done(inp.value); if (e.key === "Escape") done(null); };
        });
    }

    // =====================================================================
    // Onglets
    // =====================================================================

    var tabs = document.querySelectorAll(".tab");
    function showPage(p) {
        for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle("active", tabs[i].getAttribute("data-page") === p);
        ["tools", "intro", "curve"].forEach(function (name) { $("page-" + name).classList.toggle("hidden", name !== p); });
        $("scroller").scrollTop = 0;
        try { localStorage.setItem("aura.page", p); } catch (e) {}
        if (p === "curve") requestAnimationFrame(function () { drawEditor(); drawThumbs(); });
    }
    for (var ti = 0; ti < tabs.length; ti++) tabs[ti].addEventListener("click", function () { showPage(this.getAttribute("data-page")); });

    // =====================================================================
    // OUTILS
    // =====================================================================

    var ALIGN_TIPS = [["Haut gauche", "Haut centre", "Haut droite"], ["Milieu gauche", "Centre", "Milieu droite"], ["Bas gauche", "Bas centre", "Bas droite"]];
    (function buildAlign() {
        var g = $("alignGrid");
        for (var v = 0; v < 3; v++) for (var h = 0; h < 3; h++) {
            var b = document.createElement("button");
            b.className = "btn" + (h === 1 && v === 1 ? " center" : "");
            b.textContent = "+";
            b.title = ALIGN_TIPS[v][h];
            (function (hh, vv) { b.addEventListener("click", function () { host("align", hh, vv).then(function (r) { showResult(r); }); }); })(h, v);
            g.appendChild(b);
        }
    })();

    Array.prototype.forEach.call(document.querySelectorAll("[data-span]"), function (b) {
        b.addEventListener("click", function () { host("span", S(b.getAttribute("data-span"))).then(function (r) { showResult(r); }); });
    });
    $("btnPrecomp").onclick = function () { host("precomp").then(function (r) { showResult(r, true); }); };
    $("btnUncomp").onclick = function () { host("uncomp").then(function (r) { showResult(r, true); }); };
    $("btnAnchor").onclick = function () { host("anchor").then(function (r) { showResult(r); }); };

    // =====================================================================
    // INTRO : paroles, presets, casse
    // =====================================================================

    var lyricsBox = $("lyrics");
    try { lyricsBox.value = localStorage.getItem("aura.lyrics") || ""; } catch (e) {}
    lyricsBox.addEventListener("input", function () { try { localStorage.setItem("aura.lyrics", lyricsBox.value); } catch (e) {} });

    function refreshPresets(selectIndex) {
        return host("presetsList").then(function (r) {
            var sel = $("preset");
            sel.innerHTML = "";
            var o = document.createElement("option"); o.value = "-1"; o.textContent = "Aucun preset"; sel.appendChild(o);
            var names = (r && r.ok && r.data) ? r.data : [];
            names.forEach(function (n, i) { var op = document.createElement("option"); op.value = String(i); op.textContent = n; sel.appendChild(op); });
            sel.value = (selectIndex !== undefined && selectIndex >= 0 && selectIndex < names.length) ? String(selectIndex) : "-1";
        });
    }
    function presetIndex() { return parseInt($("preset").value, 10); }

    $("btnPresetAdd").onclick = function () {
        host("presetsAdd").then(function (r) { showResult(r, true); if (r.ok) refreshPresets(r.data); });
    };
    $("btnPresetDel").onclick = function () {
        var idx = presetIndex();
        if (idx < 0) { modal("Choisis d'abord un preset dans la liste.", { cancel: false }); return; }
        var name = $("preset").options[$("preset").selectedIndex].textContent;
        modal("Retirer « " + name + " » de la liste ?\n(le fichier .ffx n'est pas supprimé)").then(function (yes) {
            if (!yes) return;
            host("presetsRemove", idx).then(function (r) { showResult(r); refreshPresets(idx - 1); });
        });
    };
    $("btnLyrics").onclick = function () {
        var size = parseFloat($("size").value);
        if (isNaN(size) || size <= 0) size = 150;
        host("createLyrics", J(lyricsBox.value), size, presetIndex()).then(function (r) { showResult(r); });
    };
    $("btnPresetApply").onclick = function () { host("presetApply", presetIndex()).then(function (r) { showResult(r); }); };
    $("btnUpper").onclick = function () { host("textCase", true).then(function (r) { showResult(r); }); };
    $("btnLower").onclick = function () { host("textCase", false).then(function (r) { showResult(r); }); };

    // =====================================================================
    // COURBE : bibliothèque + éditeur
    // =====================================================================

    var MY_LIB = "Mes courbes";
    var lib = [];
    var cur = defaultCurve();
    var drag = null;

    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
    function round4(v) { return Math.round(v * 10000) / 10000; }
    function newId() { return "c" + Date.now() + "_" + Math.floor(Math.random() * 1000000); }
    function defaultCurve() { return { id: null, name: "", lib: MY_LIB, keys: 2, segs: [[0.33, 0, 0.2, 1]], mid: [0.5, 1], end: 0 }; }
    function clone(c) { return JSON.parse(JSON.stringify(c)); }
    function mirrorBez(b) { return [round4(1 - b[2]), round4(1 - b[3]), round4(1 - b[0]), round4(1 - b[1])]; }
    function fixThree(c) {
        if (Math.abs(c.mid[1]) < 0.05) c.mid[1] = (c.mid[1] < 0) ? -0.05 : 0.05;
        if (Math.abs(c.end - c.mid[1]) < 0.05) c.end = (c.end < c.mid[1]) ? c.mid[1] - 0.05 : c.mid[1] + 0.05;
    }
    function bezToText(b) { return [round4(b[0]), round4(b[1]), round4(b[2]), round4(b[3])].join(", "); }
    function bezFromString(s) {
        var m = String(s).match(/(-?[\d.]+(?:e-?\d+)?)\s*,\s*(-?[\d.]+(?:e-?\d+)?)\s*,\s*(-?[\d.]+(?:e-?\d+)?)\s*,\s*(-?[\d.]+(?:e-?\d+)?)/i);
        return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] : null;
    }
    function anchors(c) { return c.keys === 3 ? [[0, 0], [c.mid[0], c.mid[1]], [1, c.end]] : [[0, 0], [1, 1]]; }
    function segHandles(c, s) {
        var a = anchors(c), A = a[s], B = a[s + 1], b = c.segs[s];
        return [[A[0] + b[0] * (B[0] - A[0]), A[1] + b[1] * (B[1] - A[1])], [A[0] + b[2] * (B[0] - A[0]), A[1] + b[3] * (B[1] - A[1])]];
    }
    function cubic(p0, p1, p2, p3, t) {
        var u = 1 - t, a = u * u * u, b = 3 * u * u * t, cc = 3 * u * t * t, d = t * t * t;
        return [a * p0[0] + b * p1[0] + cc * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + cc * p2[1] + d * p3[1]];
    }

    // ---------- dessin ----------
    var YMIN = -0.25, YMAX = 1.25;
    function mapper(w, h, pad) {
        return {
            x: function (v) { return pad + v * (w - 2 * pad); },
            y: function (v) { return h - pad - (v - YMIN) / (YMAX - YMIN) * (h - 2 * pad); },
            ux: function (px) { return (px - pad) / (w - 2 * pad); },
            uy: function (py) { return YMIN + (h - pad - py) / (h - 2 * pad) * (YMAX - YMIN); }
        };
    }

    function fitCanvas(cv) {
        var r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
        var w = Math.max(10, Math.round(r.width)), h = Math.max(10, Math.round(r.height));
        if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
        var g = cv.getContext("2d");
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { g: g, w: w, h: h };
    }

    function drawCurve(g, c, m, color, width, withHandles, handleColor) {
        var a = anchors(c);
        if (withHandles) {
            g.strokeStyle = handleColor; g.lineWidth = 1;
            for (var s = 0; s < c.segs.length; s++) {
                var h = segHandles(c, s);
                g.beginPath(); g.moveTo(m.x(a[s][0]), m.y(a[s][1])); g.lineTo(m.x(h[0][0]), m.y(h[0][1])); g.stroke();
                g.beginPath(); g.moveTo(m.x(a[s + 1][0]), m.y(a[s + 1][1])); g.lineTo(m.x(h[1][0]), m.y(h[1][1])); g.stroke();
            }
        }
        g.strokeStyle = color; g.lineWidth = width; g.lineJoin = "round";
        g.beginPath();
        for (var s2 = 0; s2 < c.segs.length; s2++) {
            var hh = segHandles(c, s2);
            for (var i = 0; i <= 40; i++) {
                var p = cubic(a[s2], hh[0], hh[1], a[s2 + 1], i / 40);
                if (s2 === 0 && i === 0) g.moveTo(m.x(p[0]), m.y(p[1])); else g.lineTo(m.x(p[0]), m.y(p[1]));
            }
        }
        g.stroke();
    }

    function sq(g, x, y, r, color) { g.fillStyle = color; g.fillRect(Math.round(x - r), Math.round(y - r), 2 * r, 2 * r); }

    function drawEditor() {
        var cv = $("editor");
        if (!cv.offsetParent) return;
        var f = fitCanvas(cv), g = f.g, m = mapper(f.w, f.h, 14);
        g.clearRect(0, 0, f.w, f.h);
        g.strokeStyle = "#1e1e1e"; g.lineWidth = 1;
        for (var q = 0; q <= 4; q++) { g.beginPath(); g.moveTo(Math.round(m.x(q / 4)) + 0.5, m.y(YMIN)); g.lineTo(Math.round(m.x(q / 4)) + 0.5, m.y(YMAX)); g.stroke(); }
        g.strokeStyle = "#383838";
        [0, 1].forEach(function (v) { g.beginPath(); g.moveTo(m.x(0), Math.round(m.y(v)) + 0.5); g.lineTo(m.x(1), Math.round(m.y(v)) + 0.5); g.stroke(); });
        drawCurve(g, cur, m, "#f2f2f2", 2, true, "#727272");
        for (var s = 0; s < cur.segs.length; s++) {
            var h = segHandles(cur, s);
            sq(g, m.x(h[0][0]), m.y(h[0][1]), 4, "#cfcfcf");
            sq(g, m.x(h[1][0]), m.y(h[1][1]), 4, "#cfcfcf");
        }
        var a = anchors(cur);
        for (var k = 0; k < a.length; k++) {
            var movable = cur.keys === 3 && k > 0;
            sq(g, m.x(a[k][0]), m.y(a[k][1]), movable ? 5 : 4, movable ? "#ffffff" : "#9a9a9a");
        }
    }

    function targets(m) {
        var t = [];
        for (var s = 0; s < cur.segs.length; s++) {
            var h = segHandles(cur, s);
            t.push({ kind: "h1", seg: s, x: m.x(h[0][0]), y: m.y(h[0][1]) });
            t.push({ kind: "h2", seg: s, x: m.x(h[1][0]), y: m.y(h[1][1]) });
        }
        if (cur.keys === 3) {
            t.push({ kind: "mid", seg: 0, x: m.x(cur.mid[0]), y: m.y(cur.mid[1]) });
            t.push({ kind: "end", seg: 1, x: m.x(1), y: m.y(cur.end) });
        }
        return t;
    }

    function dragTo(target, px, py, m) {
        var X = m.ux(px), Y = clamp(m.uy(py), YMIN - 0.5, YMAX + 0.5);
        if (target.kind === "mid") { cur.mid[0] = clamp(X, 0.05, 0.95); cur.mid[1] = clamp(Y, -1, 2); fixThree(cur); return; }
        if (target.kind === "end") { cur.end = clamp(Y, -1, 2); fixThree(cur); return; }
        var a = anchors(cur), A = a[target.seg], B = a[target.seg + 1];
        var nx = clamp((X - A[0]) / (B[0] - A[0]), 0, 1);
        var dy = B[1] - A[1];
        var ny = clamp(Math.abs(dy) > 0.0001 ? (Y - A[1]) / dy : 0, -3, 4);
        var b = cur.segs[target.seg];
        if (target.kind === "h1") { b[0] = round4(nx); b[1] = round4(ny); } else { b[2] = round4(nx); b[3] = round4(ny); }
    }

    // glisser les poignées : le pointeur est « capturé », la poignée se lâche toujours au relâchement
    (function editorEvents() {
        var cv = $("editor"), raf = 0;
        function local(e) { var r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top, r.width, r.height]; }
        cv.addEventListener("pointerdown", function (e) {
            var l = local(e), m = mapper(l[2], l[3], 14), best = null, bd = 12;
            targets(m).forEach(function (t) { var d = Math.hypot(t.x - l[0], t.y - l[1]); if (d < bd) { bd = d; best = t; } });
            if (!best) return;
            drag = best;
            cv.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        cv.addEventListener("pointermove", function (e) {
            if (!drag) return;
            var l = local(e);
            dragTo(drag, l[0], l[1], mapper(l[2], l[3], 14));
            if (!raf) raf = requestAnimationFrame(function () { raf = 0; drawEditor(); refreshFields(); });
        });
        function end(e) { if (!drag) return; drag = null; try { cv.releasePointerCapture(e.pointerId); } catch (x) {} drawEditor(); refreshFields(); }
        cv.addEventListener("pointerup", end);
        cv.addEventListener("pointercancel", end);
        var rzT = 0;
        window.addEventListener("resize", function () {
            requestAnimationFrame(drawEditor);
            clearTimeout(rzT); rzT = setTimeout(drawThumbs, 120);
        });
    })();

    function refreshFields() {
        $("seg1").value = bezToText(cur.segs[0]);
        $("seg2").value = cur.keys === 3 ? bezToText(cur.segs[1]) : "";
        $("seg2").disabled = cur.keys !== 3;
        $("keys2").classList.toggle("on", cur.keys === 2);
        $("keys3").classList.toggle("on", cur.keys === 3);
    }
    function readFields() {
        var b1 = bezFromString($("seg1").value);
        if (b1) cur.segs[0] = [clamp(b1[0], 0, 1), clamp(b1[1], -3, 4), clamp(b1[2], 0, 1), clamp(b1[3], -3, 4)];
        if (cur.keys === 3) {
            var b2 = bezFromString($("seg2").value);
            if (b2) cur.segs[1] = [clamp(b2[0], 0, 1), clamp(b2[1], -3, 4), clamp(b2[2], 0, 1), clamp(b2[3], -3, 4)];
        }
    }
    $("seg1").addEventListener("change", function () { readFields(); drawEditor(); refreshFields(); });
    $("seg2").addEventListener("change", function () { readFields(); drawEditor(); refreshFields(); });

    function setKeys(n) {
        if (cur.keys === n) return;
        if (n === 3) { cur.keys = 3; cur.mid = [0.5, 1]; cur.end = 0; cur.segs = [cur.segs[0], mirrorBez(cur.segs[0])]; }
        else { cur.keys = 2; cur.segs = [cur.segs[0]]; }
        drawEditor(); refreshFields();
    }
    $("keys2").onclick = function () { setKeys(2); };
    $("keys3").onclick = function () { setKeys(3); };

    // ---------- vignettes ----------
    function renderThumbs() {
        var box = $("thumbs");
        box.innerHTML = "";
        lib.forEach(function (c) {
            var d = document.createElement("div");
            d.className = "thumb" + (cur.id && c.id === cur.id ? " sel" : "");
            d.title = c.name + (c.keys === 3 ? " (3 clés)" : "") + (c.lib && c.lib !== MY_LIB ? " · " + c.lib : "");
            var cv = document.createElement("canvas");
            var nm = document.createElement("div"); nm.className = "name"; nm.textContent = c.name;
            d.appendChild(cv); d.appendChild(nm);
            d.addEventListener("click", function () {
                cur = clone(c);
                renderThumbs(); drawEditor(); refreshFields();
                status("Courbe « " + c.name + " » chargée.");
            });
            d._curve = c;
            box.appendChild(d);
        });
        requestAnimationFrame(drawThumbs);
        $("libCount").textContent = lib.length + " courbe(s)";
    }

    // dessine les mini-courbes (seulement si l'onglet est visible : sinon leur taille est nulle)
    function drawThumbs() {
        var box = $("thumbs");
        if (!box.offsetParent) return;
        Array.prototype.forEach.call(box.children, function (d) {
            var cv = d.querySelector("canvas");
            if (!cv || !d._curve) return;
            var f = fitCanvas(cv), sel = d.classList.contains("sel");
            f.g.clearRect(0, 0, f.w, f.h);
            drawCurve(f.g, d._curve, mapper(f.w, f.h, 5), sel ? "#111" : "#e8e8e8", 1.4, true, sel ? "#777" : "#555");
        });
    }

    function loadLib(selectId) {
        return host("curvesList").then(function (r) {
            lib = (r && r.ok && r.data) ? r.data : [];
            if (selectId) { for (var i = 0; i < lib.length; i++) if (lib[i].id === selectId) { cur = clone(lib[i]); break; } }
            renderThumbs(); drawEditor(); refreshFields();
        });
    }

    $("btnNew").onclick = function () { cur = defaultCurve(); renderThumbs(); drawEditor(); refreshFields(); status("Nouvelle courbe : dessine-la puis clique sur Enregistrer."); };
    $("btnDelete").onclick = function () {
        if (!cur.id) { modal("Clique d'abord sur une vignette de courbe.", { cancel: false }); return; }
        modal("Supprimer la courbe « " + cur.name + " » ?").then(function (yes) {
            if (!yes) return;
            host("curveDelete", J(cur.id)).then(function (r) { showResult(r); cur = defaultCurve(); loadLib(); });
        });
    };
    $("btnImport").onclick = function () { host("curveImportFlow").then(function (r) { showResult(r, true); if (r.ok) loadLib(cur.id); }); };
    $("btnRead").onclick = function () {
        host("curveRead").then(function (r) {
            showResult(r);
            if (r.ok && r.data) { cur = r.data; cur.id = null; renderThumbs(); drawEditor(); refreshFields(); }
        });
    };
    $("btnApplyCurve").onclick = function () { readFields(); host("curveApply", J(cur)).then(function (r) { showResult(r); }); };
    $("btnReset").onclick = function () {
        var keep = cur;
        cur = defaultCurve(); cur.id = keep.id; cur.name = keep.name; cur.lib = keep.lib;
        if (keep.keys === 3) { cur.keys = 3; cur.segs = [[0.33, 0, 0.2, 1], [0.8, 0, 0.67, 1]]; }
        drawEditor(); refreshFields();
    };
    $("btnSave").onclick = function () {
        readFields();
        modal("Nom de la courbe :", { input: cur.name || "" }).then(function (name) {
            if (name === null) return;
            name = String(name).trim();
            if (!name) { modal("Donne un nom à ta courbe.", { cancel: false }); return; }
            cur.name = name;
            if (!cur.id) cur.id = newId();
            if (!cur.lib) cur.lib = MY_LIB;
            host("curveSave", J(cur)).then(function (r) { showResult(r); if (r.ok) loadLib(r.data ? r.data.id : cur.id); });
        });
    };

    // =====================================================================
    // Détection des paroles (Whisper + ffmpeg, en arrière-plan via Node)
    // =====================================================================

    var Detect = (function () {
        var L = window.LyricsCore;
        var BIN_URL = "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip";
        var FF_URLS = ["https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-win64-lgpl-shared-9.0.zip",
                       "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl-shared.zip"];
        var MODEL = { name: "ggml-small-q5_1.bin", url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin", size: 190085487, min: 180000000, dtw: "small" };
        var running = null; // { procs: [], cancelled }

        function whDir() { return path.join(process.env.APPDATA || os.homedir(), "AuraScript", "whisper"); }
        function exists(p) { try { fs.accessSync(p); return true; } catch (e) { return false; } }
        function findFile(dir, re, depth) {
            if (!exists(dir) || depth > 4) return null;
            var items = fs.readdirSync(dir, { withFileTypes: true }), i;
            for (i = 0; i < items.length; i++) if (items[i].isFile() && re.test(items[i].name)) return path.join(dir, items[i].name);
            for (i = 0; i < items.length; i++) if (items[i].isDirectory()) { var r = findFile(path.join(dir, items[i].name), re, depth + 1); if (r) return r; }
            return null;
        }
        function whisperExe() { return findFile(path.join(whDir(), "bin"), /^whisper-cli\.exe$/i, 0); }
        function ffmpegExe() { return findFile(path.join(whDir(), "ffmpeg"), /^ffmpeg\.exe$/i, 0); }
        function modelOk() { try { return fs.statSync(path.join(whDir(), MODEL.name)).size > MODEL.min; } catch (e) { return false; } }

        function lowPriority(pid) {
            try { os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (e) {}
        }

        function run(exe, args, opts, onErr) {
            return new Promise(function (resolve) {
                var p;
                try { p = cp.spawn(exe, args, { cwd: opts.cwd, windowsHide: true }); }
                catch (e) { resolve({ code: -1, err: String(e) }); return; }
                if (running) running.procs.push(p);
                lowPriority(p.pid);
                var errTxt = "";
                p.stderr && p.stderr.on("data", function (d) { var s = d.toString(); errTxt += s; if (errTxt.length > 20000) errTxt = errTxt.slice(-10000); if (onErr) onErr(s); });
                p.stdout && p.stdout.on("data", function () {});
                p.on("error", function (e) { resolve({ code: -1, err: String(e) }); });
                p.on("close", function (code) { resolve({ code: code, err: errTxt }); });
            });
        }

        function download(urls, dest, label, expected) {
            if (typeof urls === "string") urls = [urls];
            var i = 0;
            function tryNext() {
                if (i >= urls.length) return Promise.resolve(false);
                var url = urls[i++];
                try { if (exists(dest)) fs.unlinkSync(dest); } catch (e) {}
                var timer = setInterval(function () {
                    try {
                        var sz = fs.statSync(dest).size;
                        status(label + (expected ? " : " + Math.min(99, Math.floor(sz / expected * 100)) + " %" : " : " + Math.round(sz / 1e6) + " Mo") + " (une seule fois)");
                    } catch (e) {}
                }, 500);
                return run("curl.exe", ["-s", "-L", "--fail", "-o", dest, url], { cwd: whDir() }).then(function (r) {
                    clearInterval(timer);
                    if (running && running.cancelled) return false;
                    return r.code === 0 ? true : tryNext();
                });
            }
            return tryNext();
        }

        function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { try { fs.rmdirSync(p, { recursive: true }); } catch (e2) {} } }

        // on ne garde que le nécessaire (whisper-cli + DLL, ffmpeg + DLL)
        function cleanup() {
            var exe = whisperExe();
            if (exe) fs.readdirSync(path.dirname(exe)).forEach(function (n) { if (!/^(whisper-cli\.exe|whisper\.dll|ggml[\w\-]*\.dll)$/i.test(n)) rmrf(path.join(path.dirname(exe), n)); });
            var ff = ffmpegExe();
            if (ff) {
                ["ffplay.exe", "ffprobe.exe"].forEach(function (n) { rmrf(path.join(path.dirname(ff), n)); });
                ["doc", "include", "lib", "presets"].forEach(function (n) { rmrf(path.join(path.dirname(path.dirname(ff)), n)); });
            }
            rmrf(path.join(whDir(), "ggml-large-v3-turbo-q5_0.bin"));
        }

        function install() {
            var dir = whDir();
            fs.mkdirSync(dir, { recursive: true });
            var chain = Promise.resolve(true);
            if (!whisperExe()) {
                chain = chain.then(function (ok) {
                    if (!ok) return false;
                    var zip = path.join(dir, "whisper-bin.zip");
                    return download(BIN_URL, zip, "Téléchargement du moteur").then(function (ok2) {
                        if (!ok2) return false;
                        fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
                        return run("tar", ["-xf", zip, "-C", path.join(dir, "bin")], { cwd: dir }).then(function (r) { rmrf(zip); return r.code === 0; });
                    });
                });
            }
            if (!ffmpegExe()) {
                chain = chain.then(function (ok) {
                    if (!ok) return false;
                    var zip = path.join(dir, "ffmpeg.zip");
                    return download(FF_URLS, zip, "Téléchargement de l'outil d'analyse du son").then(function (ok2) {
                        if (!ok2) return false;
                        fs.mkdirSync(path.join(dir, "ffmpeg"), { recursive: true });
                        return run("tar", ["-xf", zip, "-C", path.join(dir, "ffmpeg")], { cwd: dir }).then(function (r) { rmrf(zip); return r.code === 0; });
                    });
                });
            }
            if (!modelOk()) {
                chain = chain.then(function (ok) {
                    if (!ok) return false;
                    var part = path.join(dir, "model.part");
                    return download(MODEL.url, part, "Téléchargement du modèle IA", MODEL.size).then(function (ok2) {
                        if (!ok2) return false;
                        fs.renameSync(part, path.join(dir, MODEL.name));
                        return true;
                    });
                });
            }
            return chain.then(function (ok) { if (ok) cleanup(); return ok; });
        }

        function setButton(on) { $("btnDetect").textContent = on ? "Annuler l'analyse" : "Détecter les paroles de la musique"; }

        function stop(msg) {
            if (running) {
                running.cancelled = true;
                running.procs.forEach(function (p) { try { p.kill(); } catch (e) {} });
            }
            running = null;
            setButton(false);
            if (msg) status(msg);
        }

        function start() {
            if (running) { stop("Analyse annulée."); return; }
            if (!fs || !cp) { modal("Cette fonction a besoin de Node.js, qui n'est pas disponible dans ce panneau.", { cancel: false }); return; }
            if (process.platform !== "win32") { modal("La détection des paroles fonctionne pour l'instant sur Windows.", { cancel: false }); return; }
            var hint = lyricsBox.value;
            host("audioLayer").then(function (r) {
                if (!r.ok) { showResult(r); return; }
                var info = r.data;
                if (!/\.(mp3|wav|flac|ogg)$/i.test(info.fileName)) {
                    modal("Format non pris en charge : " + info.fileName + "\n\nUtilise un fichier MP3, WAV, FLAC ou OGG.", { cancel: false });
                    return;
                }
                var need = !whisperExe() || !ffmpegExe() || !modelOk();
                var ask = need ? modal("Première utilisation : AuraScript va télécharger le moteur de reconnaissance des paroles et l'outil d'analyse du son (environ 300 Mo, une seule fois).\n\nContinuer ?") : Promise.resolve(true);
                ask.then(function (yes) {
                    if (!yes) return;
                    running = { procs: [], cancelled: false };
                    setButton(true);
                    var p = need ? install() : Promise.resolve(true);
                    p.then(function (ok) {
                        if (!running || running.cancelled) return;
                        if (!ok) { stop(); modal("Le téléchargement a échoué. Vérifie ta connexion internet puis réessaie.", { cancel: false }); return; }
                        analyse(info, hint);
                    });
                });
            });
        }

        function analyse(info, hint) {
            var dir = whDir(), job = path.join(dir, "job");
            rmrf(job);
            fs.mkdirSync(job, { recursive: true });
            var ext = (info.fileName.match(/\.(\w+)$/) || [, "mp3"])[1].toLowerCase();
            var audio = path.join(job, "audio." + ext);
            try { fs.copyFileSync(info.path, audio); } catch (e) { audio = info.path; }

            var a0 = Math.max(0, info.srcIn - 3), dur = info.srcOut + 1 - a0;
            var threads = Math.max(2, Math.min(8, Math.floor((os.cpus() || []).length / 2) || 4));
            var args = ["-m", path.join(dir, MODEL.name), "-f", audio, "-l", "auto", "-t", String(threads),
                "-ml", "1", "-sow", "-ojf", "-pp", "-sns", "-dtw", MODEL.dtw, "-nfa", "-of", path.join(job, "out")];
            if (a0 > 0) args.push("-ot", String(Math.round(a0 * 1000)));
            args.push("-d", String(Math.round(dur * 1000)));
            var prompt = L.promptFromLyrics(hint);
            if (prompt) args.push("--prompt", prompt);

            var t0 = Date.now(), pct = 0;
            var tick = setInterval(function () {
                status("Analyse de la musique en cours... " + Math.round((Date.now() - t0) / 1000) + " s" + (pct > 0 && pct < 100 ? " (" + pct + " %)" : "") + " — After Effects reste utilisable");
            }, 500);
            var exe = whisperExe();
            run(exe, args, { cwd: path.dirname(exe) }, function (s) {
                var m, re = /progress\s*=\s*(\d+)\s*%/g;
                while ((m = re.exec(s)) !== null) pct = parseInt(m[1], 10);
            }).then(function (r) {
                if (!running || running.cancelled) { clearInterval(tick); return null; }
                if (!exists(path.join(job, "out.json"))) {
                    clearInterval(tick); stop();
                    modal("L'analyse a échoué.\n\n" + String(r.err || "").slice(-400), { cancel: false });
                    return null;
                }
                var ff = ffmpegExe();
                if (!ff) return r;
                return run(ff, ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(a0), "-t", String(dur), "-i", audio, "-af", L.VOICE_FILTER, "-f", "null", "-"], { cwd: job }).then(function () { return r; });
            }).then(function (r) {
                clearInterval(tick);
                if (!r || !running || running.cancelled) return;
                finish(info, hint, job, a0);
            });
        }

        function finish(info, hint, job, a0) {
            var heard = L.readWhisperWords(fs.readFileSync(path.join(job, "out.json"), "utf8"));
            var userWords = String(hint || "").split(/\s+/).map(L.trim).filter(Boolean);
            var words, aligned = false, matched = 0;
            if (userWords.length) {
                var al = L.alignLyrics(userWords, heard, info.srcIn, info.srcOut);
                if (!al.words) { stop(); modal("L'IA n'a reconnu aucun de tes mots dans la partie gardée de la musique.\n\nVérifie que les paroles collées correspondent bien à ce passage (même langue, même ordre).", { cancel: false }); return; }
                words = al.words; aligned = true; matched = al.matched;
            } else {
                words = heard.filter(function (w) { return w.t >= info.srcIn - 0.05 && w.t < info.srcOut; });
                if (!words.length) { stop(); modal("Aucune parole reconnue dans la partie gardée de la musique.\n\nAstuce : colle les paroles dans la zone Lyrics, l'IA s'en servira pour caler chaque mot.", { cancel: false }); return; }
            }
            var snapped = 0;
            try {
                var envFile = path.join(job, "env.txt");
                if (exists(envFile)) snapped = L.snapWordsToOnsets(words, L.readVoiceOnsets(fs.readFileSync(envFile, "utf8"), a0));
            } catch (e) {}
            if (aligned) words.forEach(function (w) { w.t = clamp(w.t, info.srcIn, info.srcOut - 0.04); });
            var plain = words.map(function (w) { return { t: w.t, w: w.w }; });

            var ask = info.markers > 0 ? modal("La musique a déjà " + info.markers + " marqueur(s).\nLes remplacer par les mots détectés ?") : Promise.resolve(false);
            ask.then(function (replace) {
                host("placeMarkers", info.compId, info.layerIndex, J(plain), !!replace).then(function (r) {
                    if (!r.ok) { stop(); showResult(r); return; }
                    if (!aligned) { lyricsBox.value = plain.map(function (w) { return w.w; }).join(" "); try { localStorage.setItem("aura.lyrics", lyricsBox.value); } catch (e) {} }
                    var sig = snapped ? " " + snapped + " calé(s) sur le signal audio." : "";
                    stop(aligned
                        ? r.data + " marqueur(s) posé(s) avec tes paroles (" + matched + " mot(s) reconnus)." + sig + " Clique sur « Créer les paroles »."
                        : r.data + " mot(s) détecté(s) et marqués." + sig + " Corrige les mots si besoin puis clique sur « Créer les paroles ».");
                });
            });
        }

        return { start: start };
    })();

    $("btnDetect").onclick = function () { Detect.start(); };

    // =====================================================================
    // Mises à jour automatiques (depuis GitHub)
    // =====================================================================

    var REMOTE = "https://raw.githubusercontent.com/auragpro/AuraScript/main/cep/";

    function versionNewer(a, b) {
        var x = String(a).split("."), y = String(b).split(".");
        for (var i = 0; i < 3; i++) { var d = (parseInt(x[i], 10) || 0) - (parseInt(y[i], 10) || 0); if (d) return d > 0; }
        return false;
    }

    function checkUpdate() {
        if (!fs) { $("update").textContent = ""; return; }
        fetch(REMOTE + "version.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (info) {
            if (!info || !versionNewer(info.version, VERSION)) { $("update").textContent = "À jour"; return; }
            $("update").textContent = "Mise à jour " + info.version + "...";
            var base = extensionPath();
            return Promise.all(info.files.map(function (f) {
                return fetch(REMOTE + f + "?t=" + Date.now(), { cache: "no-store" }).then(function (r) {
                    if (!r.ok) throw new Error(f);
                    return r.text().then(function (t) { return { f: f, t: t }; });
                });
            })).then(function (all) {
                all.forEach(function (x) {
                    var dest = path.join(base, x.f);
                    fs.mkdirSync(path.dirname(dest), { recursive: true });
                    fs.writeFileSync(dest + ".new", x.t, "utf8");
                });
                all.forEach(function (x) { var dest = path.join(base, x.f); fs.renameSync(dest + ".new", dest); });
                try { localStorage.setItem("aura.notes", JSON.stringify(info.notes || [])); } catch (e) {}
                return loadHost().then(function () { location.reload(); });
            });
        }).catch(function () { $("update").textContent = ""; });
    }

    function showNotes() {
        var notes = null;
        try { notes = JSON.parse(localStorage.getItem("aura.notes") || "null"); localStorage.removeItem("aura.notes"); } catch (e) {}
        if (!notes || !notes.length) return;
        var ul = $("bannerList");
        notes.forEach(function (n) { var li = document.createElement("li"); li.textContent = n; ul.appendChild(li); });
        $("banner").classList.remove("hidden");
        $("bannerOk").onclick = function () { $("banner").classList.add("hidden"); };
    }

    // =====================================================================
    // Démarrage
    // =====================================================================

    loadHost().then(function () {
        refreshPresets();
        loadLib();
    });
    refreshFields();
    var startPage = "tools";
    try { startPage = localStorage.getItem("aura.page") || "tools"; } catch (e) {}
    showPage(startPage);
    showNotes();
    setTimeout(checkUpdate, 1500);
})();
