// AuraScript — panneau HTML (CEP)
(function () {
    "use strict";

    var VERSION = "3.1.4";
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
        ["tools", "intro", "curve", "presets"].forEach(function (name) { $("page-" + name).classList.toggle("hidden", name !== p); });
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
    $("btnReverse").onclick = function () { host("reverse").then(function (r) { showResult(r); }); };
    $("btnDuplicate").onclick = function () { host("duplicate").then(function (r) { showResult(r); }); };
    $("btnSolid").onclick = function () { Picker.close(); host("solid", J(Picker.value())).then(function (r) { showResult(r); }); };

    // ---------- coller une image depuis le presse-papiers ----------
    var PasteImage = (function () {
        var IMG_OK = /\.(png|jpe?g|gif|bmp|tiff?|psd|tga|exr|ai|eps|pdf|svg|mp4|mov|m4v)$/i;
        var TIKTOK = /^https?:\/\/([a-z0-9-]+\.)*tiktok\.com\//i;
        var IMG_ANY = /\.(png|jpe?g|gif|bmp|tiff?|psd|tga|exr|webp|avif|heic|ico|jfif)$/i;
        function stamp() { var d = new Date(); function p(n) { return ("0" + n).slice(-2); } return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); }
        function imgDir() { var d = path.join(process.env.APPDATA || os.homedir(), "AuraScript", "images"); fs.mkdirSync(d, { recursive: true }); return d; }
        function spawnText(exe, args) {
            return new Promise(function (resolve) {
                var out = "", err = "", p;
                try { p = cp.spawn(exe, args, { windowsHide: true }); } catch (e) { resolve({ code: -1, out: "", err: String(e) }); return; }
                p.stdout.on("data", function (d) { out += d.toString(); });
                p.stderr.on("data", function (d) { err += d.toString(); });
                p.on("error", function (e) { resolve({ code: -1, out: out, err: String(e) }); });
                p.on("close", function (c) { resolve({ code: c, out: out, err: err }); });
            });
        }
        // lit le presse-papiers Windows : image PNG (garde la transparence), fichier copié, image, ou texte (lien)
        function readClipboard(outPng) {
            var ps = [
                "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing",
                "$o = '" + outPng.replace(/'/g, "''") + "'",
                "$d = [Windows.Forms.Clipboard]::GetDataObject()",
                "if ($d -eq $null) { 'EMPTY'; exit }",
                "if ($d.GetDataPresent('PNG')) { $s = $d.GetData('PNG'); $f = [IO.File]::Create($o); $s.Position = 0; $s.CopyTo($f); $f.Close(); 'PNG'; exit }",
                "if ($d.GetDataPresent([Windows.Forms.DataFormats]::FileDrop)) { $l = $d.GetData([Windows.Forms.DataFormats]::FileDrop); [Console]::OutputEncoding = [Text.Encoding]::UTF8; 'FILE:' + $l[0]; exit }",
                "$img = [Windows.Forms.Clipboard]::GetImage(); if ($img -ne $null) { $img.Save($o, [Drawing.Imaging.ImageFormat]::Png); 'DIB'; exit }",
                "$t = [Windows.Forms.Clipboard]::GetText(); if ($t) { [Console]::OutputEncoding = [Text.Encoding]::UTF8; 'TEXT:' + $t.Trim(); exit }",
                "'EMPTY'"
            ].join("\n");
            var enc = Buffer.from(ps, "utf16le").toString("base64");
            return spawnText("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-EncodedCommand", enc]).then(function (r) {
                return String(r.out || "").trim().split(/\r?\n/).pop() || ("ERR:" + r.err);
            });
        }
        function ffmpegPath() {
            var base = path.join(process.env.APPDATA || os.homedir(), "AuraScript", "whisper", "ffmpeg");
            function find(dir, depth) {
                try {
                    var items = fs.readdirSync(dir, { withFileTypes: true }), i;
                    for (i = 0; i < items.length; i++) if (items[i].isFile() && /^ffmpeg\.exe$/i.test(items[i].name)) return path.join(dir, items[i].name);
                    if (depth < 4) for (i = 0; i < items.length; i++) if (items[i].isDirectory()) { var r = find(path.join(dir, items[i].name), depth + 1); if (r) return r; }
                } catch (e) {}
                return null;
            }
            return find(base, 0);
        }
        // convertit en PNG les formats qu'After Effects n'ouvre pas (webp, avif...)
        function ensureImportable(file) {
            if (IMG_OK.test(file)) return Promise.resolve(file);
            var ff = ffmpegPath();
            if (!ff) return Promise.reject(new Error("Ce format d'image n'est pas lu par After Effects. Copie plutôt l'image elle-même (clic droit > Copier l'image)."));
            var out = file.replace(/\.[^.\\\/]+$/, "") + ".png";
            return spawnText(ff, ["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-frames:v", "1", out]).then(function (r) {
                if (r.code !== 0 || !fs.existsSync(out)) throw new Error("Conversion de l'image impossible.");
                return out;
            });
        }
        // ---- vidéo TikTok (yt-dlp, téléchargé une seule fois) ----
        function toolsDir() { var d = path.join(process.env.APPDATA || os.homedir(), "AuraScript", "tools"); fs.mkdirSync(d, { recursive: true }); return d; }
        function ytdlp() { return path.join(toolsDir(), "yt-dlp.exe"); }
        function ensureYtdlp() {
            var exe = ytdlp();
            try { if (fs.statSync(exe).size > 1000000) return Promise.resolve(exe); } catch (e) {}
            return modal("Première vidéo TikTok : AuraScript va télécharger l'outil yt-dlp (environ 18 Mo, une seule fois).\n\nContinuer ?").then(function (yes) {
                if (!yes) throw new Error("");
                status("Téléchargement de yt-dlp (une seule fois)...");
                var part = exe + ".part";
                return spawnText("curl.exe", ["-s", "-L", "--fail", "-o", part, "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"]).then(function (r) {
                    if (r.code !== 0) throw new Error("Le téléchargement de yt-dlp a échoué. Vérifie ta connexion internet.");
                    fs.renameSync(part, exe);
                    return exe;
                });
            });
        }
        function runYtdlp(exe, args) {
            return new Promise(function (resolve) {
                var out = "", p;
                try { p = cp.spawn(exe, args, { windowsHide: true }); } catch (e) { resolve({ code: -1, out: String(e) }); return; }
                try { os.setPriority(p.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (e) {}
                function onData(d) {
                    var t = d.toString(); out += t; if (out.length > 20000) out = out.slice(-10000);
                    var m = /\[download\]\s+([\d.]+)%/.exec(t);
                    if (m) status("Téléchargement de la vidéo TikTok... " + Math.floor(parseFloat(m[1])) + " %");
                }
                p.stdout.on("data", onData); p.stderr.on("data", onData);
                p.on("error", function (e) { resolve({ code: -1, out: out + String(e) }); });
                p.on("close", function (c) { resolve({ code: c, out: out }); });
            });
        }
        function downloadTikTok(url) {
            return ensureYtdlp().then(function (exe) {
                var dir = path.join(process.env.APPDATA || os.homedir(), "AuraScript", "videos");
                fs.mkdirSync(dir, { recursive: true });
                var name = "tiktok_" + stamp();
                var args = ["--no-playlist", "--newline", "--no-part", "--restrict-filenames",
                    "-f", "b[vcodec^=h264]/b[vcodec^=avc1]/bv*[vcodec^=avc1]+ba/b",
                    "--merge-output-format", "mp4", "-o", path.join(dir, name + ".%(ext)s")];
                var ff = ffmpegPath();
                if (ff) args.push("--ffmpeg-location", path.dirname(ff));
                args.push(url);
                function find() {
                    var f = fs.readdirSync(dir).filter(function (n) { return n.indexOf(name + ".") === 0 && /\.(mp4|mov|m4v)$/i.test(n); })[0];
                    return f ? path.join(dir, f) : null;
                }
                status("Téléchargement de la vidéo TikTok...");
                return runYtdlp(exe, args).then(function (r) {
                    var f = find();
                    if (r.code === 0 && f) return f;
                    // TikTok change souvent : on met yt-dlp à jour puis on réessaie une fois
                    status("Mise à jour de yt-dlp...");
                    return runYtdlp(exe, ["-U"]).then(function () { return runYtdlp(exe, args); }).then(function (r2) {
                        var f2 = find();
                        if (r2.code === 0 && f2) return f2;
                        var why = (r2.out.match(/ERROR:.*$/m) || [""])[0];
                        throw new Error("Impossible de récupérer cette vidéo TikTok." + (why ? "\n\n" + why.slice(0, 300) : "") + "\n\nVérifie que le lien est public et réessaie.");
                    });
                });
            });
        }

        function download(url, base) {
            var tmp = base + ".dl";
            return spawnText("curl.exe", ["-s", "-L", "--fail", "-A", "Mozilla/5.0", "-o", tmp, "-w", "%{content_type}", url]).then(function (r) {
                if (r.code !== 0 || !fs.existsSync(tmp)) throw new Error("Impossible de télécharger l'image depuis ce lien.");
                var ct = String(r.out || "").toLowerCase(), ext = null;
                var m = /image\/([a-z0-9.+-]+)/.exec(ct);
                if (m) ext = { jpeg: "jpg", "svg+xml": "svg", "x-icon": "ico", "vnd.microsoft.icon": "ico" }[m[1]] || m[1];
                if (!ext) { var u = /\.(png|jpe?g|gif|webp|avif|bmp|tiff?|svg)(\?|#|$)/i.exec(url); if (u) ext = u[1].toLowerCase(); }
                if (!ext) { try { fs.unlinkSync(tmp); } catch (e) {} throw new Error("Ce lien ne mène pas à une image. Fais clic droit sur l'image > Copier l'image."); }
                var dest = base + "." + ext;
                fs.renameSync(tmp, dest);
                return dest;
            });
        }
        function run() {
            if (!fs || !cp) { modal("Cette fonction a besoin de Node.js, qui n'est pas disponible dans ce panneau.", { cancel: false }); return; }
            if (process.platform !== "win32") { modal("Coller une image fonctionne pour l'instant sur Windows.", { cancel: false }); return; }
            var base = path.join(imgDir(), "image_" + stamp()), png = base + ".png";
            status("Lecture du presse-papiers...");
            readClipboard(png).then(function (res) {
                if (res === "PNG" || res === "DIB") return png;
                if (res.indexOf("FILE:") === 0) {
                    var f = res.slice(5).trim();
                    if (!IMG_ANY.test(f) && !IMG_OK.test(f)) throw new Error("Le fichier copié n'est pas une image.");
                    return f;
                }
                if (res.indexOf("TEXT:") === 0) {
                    var t = res.slice(5).trim();
                    if (/^https?:\/\/\S+$/i.test(t)) { status("Téléchargement de l'image..."); return download(t, base); }
                    if (/^[a-z]:\\.+/i.test(t) && fs.existsSync(t)) return t;
                    throw new Error("Le presse-papiers contient du texte, pas une image.\n\nSur Google ou Pinterest : clic droit sur l'image > Copier l'image.\nPour un lien TikTok, colle-le dans la case juste en dessous.");
                }
                if (res.indexOf("ERR:") === 0) throw new Error("Lecture du presse-papiers impossible.\n" + res.slice(4).slice(-300));
                throw new Error("Aucune image dans le presse-papiers.\n\nSur Google ou Pinterest : clic droit sur l'image > Copier l'image, puis reclique ici.");
            }).then(ensureImportable).then(function (file) {
                return host("importImage", J(file)).then(function (r) { showResult(r); });
            }).catch(function (e) {
                status("");
                var m = e && e.message !== undefined ? e.message : String(e);
                if (m) modal(m, { cancel: false });
            });
        }
        // case « lien TikTok » + bouton Entrée
        var ttBusy = false;
        function tiktok() {
            if (ttBusy) return;
            if (!fs || !cp) { modal("Cette fonction a besoin de Node.js, qui n'est pas disponible dans ce panneau.", { cancel: false }); return; }
            var box = $("ttUrl"), btn = $("btnTikTok");
            var link = (/https?:\/\/\S+/i.exec(box.value) || [])[0];
            if (!link || !TIKTOK.test(link)) { modal("Colle un lien TikTok valide.\n\nSur TikTok : Partager > Copier le lien.", { cancel: false }); return; }
            ttBusy = true; box.disabled = true; btn.disabled = true;
            downloadTikTok(link).then(function (file) {
                return host("importImage", J(file)).then(function (r) { showResult(r); if (r.ok) box.value = ""; });
            }).catch(function (e) {
                status("");
                var m = e && e.message !== undefined ? e.message : String(e);
                if (m) modal(m, { cancel: false });
            }).then(function () { ttBusy = false; box.disabled = false; btn.disabled = false; });
        }
        // extraire l'audio : copie du calque en audio seul, directement dans la timeline (aucun fichier créé)
        function extractAudio() { host("splitAudio").then(function (r) { showResult(r); }); }
        return { run: run, tiktok: tiktok, extractAudio: extractAudio };
    })();
    $("btnPasteImg").onclick = function () { PasteImage.run(); };
    $("btnTikTok").onclick = function () { PasteImage.tiktok(); };
    $("btnExtractAudio").onclick = function () { PasteImage.extractAudio(); };
    $("btnFaster").onclick = function () { host("speed", 2).then(function (r) { showResult(r); }); };
    $("btnSlower").onclick = function () { host("speed", 0.5).then(function (r) { showResult(r); }); };
    $("ttUrl").addEventListener("keydown", function (e) { if (e.key === "Enter") PasteImage.tiktok(); });

    // ---------- onglet PRESETS ----------
    var Fx = (function () {
        var lib = { items: [], folders: [] }, closed = {};
        function file() { return path.join(process.env.APPDATA || os.homedir(), "AuraScript", "fx-presets.json"); }
        function load() {
            try { var d = JSON.parse(fs.readFileSync(file(), "utf8")); lib.items = d.items || []; lib.folders = d.folders || []; } catch (e) { lib = { items: [], folders: [] }; }
            try { closed = JSON.parse(localStorage.getItem("aura.fxClosed") || "{}"); } catch (e) { closed = {}; }
        }
        function save() {
            try { fs.mkdirSync(path.dirname(file()), { recursive: true }); fs.writeFileSync(file(), JSON.stringify(lib, null, 1), "utf8"); } catch (e) { status("Impossible d'enregistrer la liste des presets : " + e.message); }
        }
        function nameOf(p) { return path.basename(p).replace(/\.ffx$/i, ""); }
        function scan(dir, depth, out) {
            var items; try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
            items.forEach(function (it) {
                var full = path.join(dir, it.name);
                if (it.isDirectory() && depth < 6) scan(full, depth + 1, out);
                else if (it.isFile() && /\.ffx$/i.test(it.name)) out.push(full);
            });
            return out;
        }
        // un dossier ajouté : chaque sous-dossier devient une catégorie
        function addFolder(dir, quiet) {
            var found = scan(dir, 0, []), added = 0, base = path.basename(dir);
            found.forEach(function (f) {
                if (lib.items.some(function (x) { return x.path.toLowerCase() === f.toLowerCase(); })) return;
                var rel = path.relative(dir, path.dirname(f));
                var cat = rel ? rel.split(/[\\\/]/)[0] : base;
                lib.items.push({ name: nameOf(f), path: f, cat: cat });
                added++;
            });
            if (lib.folders.indexOf(dir) < 0) lib.folders.push(dir);
            if (!quiet) status(added + " preset(s) ajouté(s) depuis « " + base + " ».");
            return added;
        }
        function render() {
            var box = $("fxList"), q = $("fxSearch").value.trim().toLowerCase();
            box.innerHTML = "";
            if (!lib.items.length) {
                box.innerHTML = '<div class="fx-empty">Aucun preset pour l\'instant.<br>Clique sur « + Dossier » pour ajouter un dossier de presets .ffx (chaque sous-dossier devient une catégorie), ou sur « + Presets » pour choisir des fichiers.</div>';
                return;
            }
            var cats = {}, order = [];
            lib.items.forEach(function (it, i) {
                if (q && it.name.toLowerCase().indexOf(q) < 0 && String(it.cat).toLowerCase().indexOf(q) < 0) return;
                var c = it.cat || "Mes presets";
                if (!cats[c]) { cats[c] = []; order.push(c); }
                cats[c].push(i);
            });
            order.sort(function (a, b) { return a.localeCompare(b); });
            if (!order.length) { box.innerHTML = '<div class="fx-empty">Aucun preset ne correspond.</div>'; return; }
            order.forEach(function (c) {
                var isClosed = !q && closed[c];
                var head = document.createElement("div"); head.className = "fx-cat-head";
                head.innerHTML = '<span class="arrow"></span><span class="t"></span><span class="count"></span><span class="del" title="Retirer cette catégorie de la liste">×</span>';
                head.querySelector(".arrow").textContent = isClosed ? "▸" : "▾";
                head.querySelector(".t").textContent = c;
                head.querySelector(".count").textContent = cats[c].length;
                var grid = document.createElement("div"); grid.className = "fx-grid" + (isClosed ? " closed" : "");
                head.addEventListener("click", function (e) {
                    if (e.target.classList.contains("del")) {
                        modal("Retirer la catégorie « " + c + " » de la liste ?\n(les fichiers .ffx ne sont pas supprimés)").then(function (yes) {
                            if (!yes) return;
                            lib.items = lib.items.filter(function (x) { return (x.cat || "Mes presets") !== c; });
                            save(); render();
                        });
                        return;
                    }
                    closed[c] = !closed[c];
                    try { localStorage.setItem("aura.fxClosed", JSON.stringify(closed)); } catch (x) {}
                    render();
                });
                cats[c].sort(function (a, b) { return lib.items[a].name.localeCompare(lib.items[b].name); }).forEach(function (i) {
                    var it = lib.items[i];
                    var b = document.createElement("button"); b.className = "btn fx-item"; b.title = it.name + "\n" + it.path;
                    b.textContent = it.name;
                    var x = document.createElement("span"); x.className = "x"; x.textContent = "×"; x.title = "Retirer de la liste";
                    b.appendChild(x);
                    b.addEventListener("click", function (e) {
                        if (e.target === x) {
                            e.stopPropagation();
                            lib.items = lib.items.filter(function (y) { return y.path !== it.path; });
                            save(); render(); status("« " + it.name + " » retiré de la liste.");
                            return;
                        }
                        status("Application de « " + it.name + " »...");
                        host("fxApply", J(it.path)).then(function (r) { showResult(r); });
                    });
                    grid.appendChild(b);
                });
                box.appendChild(head); box.appendChild(grid);
            });
        }
        function init() {
            if (!fs) { $("fxList").innerHTML = '<div class="fx-empty">Cet onglet a besoin de Node.js.</div>'; return; }
            load(); render();
            $("fxSearch").addEventListener("input", render);
            $("btnFxFiles").onclick = function () {
                host("fxPickFiles").then(function (r) {
                    var files = (r && r.ok && r.data) || [], added = 0;
                    files.forEach(function (f) {
                        if (lib.items.some(function (x) { return x.path.toLowerCase() === f.toLowerCase(); })) return;
                        lib.items.push({ name: nameOf(f), path: f, cat: "Mes presets" }); added++;
                    });
                    if (files.length) { save(); render(); status(added + " preset(s) ajouté(s)."); }
                });
            };
            $("btnFxFolder").onclick = function () {
                host("fxPickFolder").then(function (r) {
                    if (!r || !r.ok || !r.data) return;
                    addFolder(r.data); save(); render();
                });
            };
            $("btnFxRefresh").onclick = function () {
                var n = 0;
                lib.items = lib.items.filter(function (x) { return fs.existsSync(x.path); });
                lib.folders.forEach(function (d) { if (fs.existsSync(d)) n += addFolder(d, true); });
                save(); render(); status("Liste mise à jour (" + n + " nouveau(x) preset(s)).");
            };
        }
        return { init: init };
    })();
    Fx.init();

    // ---------- sélecteur de couleur (thème sombre) ----------
    var Picker = (function () {
        var hsv = [0, 0, 0], pop = $("picker"), sv = $("pkSV"), hue = $("pkHue"), hexIn = $("pkHex"), sw = $("solidSwatch");
        var PRESETS = ["#000000", "#FFFFFF", "#FF0000", "#FF7A00", "#FFD400", "#00C853", "#00B0FF", "#2962FF", "#AA00FF", "#FF4081"];
        function hsv2rgb(h, s, v) {
            function f(n) { var k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }
            return [f(5), f(3), f(1)].map(function (x) { return Math.round(x * 255); });
        }
        function rgb2hsv(r, g, b) {
            r /= 255; g /= 255; b /= 255;
            var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
            if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
            return [h, mx ? d / mx : 0, mx];
        }
        function toHex(c) { return "#" + c.map(function (x) { return ("0" + x.toString(16)).slice(-2); }).join("").toUpperCase(); }
        function value() { return toHex(hsv2rgb(hsv[0], hsv[1], hsv[2])); }
        function setHex(h) {
            var m = /^#?([0-9a-f]{6})$/i.exec(String(h).trim());
            if (!m) return false;
            var n = parseInt(m[1], 16);
            var nh = rgb2hsv((n >> 16) & 255, (n >> 8) & 255, n & 255);
            if (nh[1] === 0 || nh[2] === 0) nh[0] = hsv[0];
            hsv = nh; save(); draw(); return true;
        }
        function save() { try { localStorage.setItem("aura.solid", value()); } catch (e) {} }
        function draw() {
            sw.style.background = value();
            if (document.activeElement !== hexIn) hexIn.value = value().slice(1);
            if (pop.classList.contains("hidden")) return;
            var f = fitCanvas(sv), g = f.g;
            var base = hsv2rgb(hsv[0], 1, 1);
            g.fillStyle = "rgb(" + base.join(",") + ")"; g.fillRect(0, 0, f.w, f.h);
            var gw = g.createLinearGradient(0, 0, f.w, 0); gw.addColorStop(0, "#fff"); gw.addColorStop(1, "rgba(255,255,255,0)");
            g.fillStyle = gw; g.fillRect(0, 0, f.w, f.h);
            var gb = g.createLinearGradient(0, 0, 0, f.h); gb.addColorStop(0, "rgba(0,0,0,0)"); gb.addColorStop(1, "#000");
            g.fillStyle = gb; g.fillRect(0, 0, f.w, f.h);
            var x = hsv[1] * f.w, y = (1 - hsv[2]) * f.h;
            g.lineWidth = 2; g.strokeStyle = hsv[2] > 0.6 ? "#000" : "#fff";
            g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.stroke();
            var h2 = fitCanvas(hue), gh = h2.g, gr = gh.createLinearGradient(0, 0, h2.w, 0);
            [0, 60, 120, 180, 240, 300, 360].forEach(function (d) { gr.addColorStop(d / 360, "hsl(" + d + ",100%,50%)"); });
            gh.clearRect(0, 0, h2.w, h2.h); gh.fillStyle = gr; gh.fillRect(0, 0, h2.w, h2.h);
            var hx = hsv[0] / 360 * h2.w;
            gh.lineWidth = 2; gh.strokeStyle = "#fff"; gh.beginPath(); gh.arc(Math.min(Math.max(hx, 6), h2.w - 6), h2.h / 2, 5, 0, Math.PI * 2); gh.stroke();
        }
        function dragOn(el, fn) {
            var on = false;
            function at(e) { var r = el.getBoundingClientRect(); fn(clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)); save(); draw(); }
            el.addEventListener("pointerdown", function (e) { on = true; el.setPointerCapture(e.pointerId); at(e); e.preventDefault(); });
            el.addEventListener("pointermove", function (e) { if (on) at(e); });
            el.addEventListener("pointerup", function (e) { on = false; try { el.releasePointerCapture(e.pointerId); } catch (x) {} });
        }
        dragOn(sv, function (x, y) { hsv[1] = x; hsv[2] = 1 - y; });
        dragOn(hue, function (x) { hsv[0] = x * 360; });
        PRESETS.forEach(function (c) {
            var b = document.createElement("button"); b.style.background = c; b.title = c;
            b.onclick = function () { setHex(c); };
            $("pkPresets").appendChild(b);
        });
        hexIn.addEventListener("input", function () { setHex(hexIn.value); });
        hexIn.addEventListener("keydown", function (e) { if (e.key === "Enter") close(); });
        function open() { pop.classList.remove("hidden"); requestAnimationFrame(draw); }
        function close() { pop.classList.add("hidden"); draw(); }
        sw.onclick = function (e) { e.stopPropagation(); if (pop.classList.contains("hidden")) open(); else close(); };
        $("pkOk").onclick = close;
        document.addEventListener("pointerdown", function (e) { if (!pop.classList.contains("hidden") && !pop.contains(e.target) && e.target !== sw) close(); });
        var saved = "#000000";
        try { saved = localStorage.getItem("aura.solid") || "#000000"; } catch (e) {}
        if (!setHex(saved)) setHex("#000000");
        return { value: value, close: close };
    })();

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

    // shift : la poignée reste droite, sur la ligne horizontale de sa clé (comme Flow)
    function dragTo(target, px, py, m, straight) {
        var X = m.ux(px), Y = clamp(m.uy(py), YMIN - 0.5, YMAX + 0.5);
        if (target.kind === "mid") { cur.mid[0] = clamp(X, 0.05, 0.95); cur.mid[1] = clamp(Y, -1, 2); fixThree(cur); return; }
        if (target.kind === "end") { cur.end = clamp(Y, -1, 2); fixThree(cur); return; }
        var a = anchors(cur), A = a[target.seg], B = a[target.seg + 1];
        var nx = clamp((X - A[0]) / (B[0] - A[0]), 0, 1);
        var dy = B[1] - A[1];
        var ny = clamp(Math.abs(dy) > 0.0001 ? (Y - A[1]) / dy : 0, -3, 4);
        var b = cur.segs[target.seg];
        if (target.kind === "h1") { b[0] = round4(nx); b[1] = straight ? 0 : round4(ny); }
        else { b[2] = round4(nx); b[3] = straight ? 1 : round4(ny); }
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
            dragTo(drag, l[0], l[1], mapper(l[2], l[3], 14), e.shiftKey);
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
    var API = "https://api.github.com/repos/auragpro/AuraScript/contents/cep/";
    var pending = null;

    function versionNewer(a, b) {
        var x = String(a).split("."), y = String(b).split(".");
        for (var i = 0; i < 3; i++) { var d = (parseInt(x[i], 10) || 0) - (parseInt(y[i], 10) || 0); if (d) return d > 0; }
        return false;
    }

    // lit un fichier en ligne : d'abord l'API GitHub (jamais en retard), sinon le lien direct
    function getRemote(f) {
        var t = "t=" + Date.now();
        return fetch(API + f + "?ref=main&" + t, { cache: "no-store", headers: { Accept: "application/vnd.github.raw" } })
            .then(function (r) { if (!r.ok) throw new Error("api " + r.status); return r.text(); })
            .catch(function () {
                return fetch(REMOTE + f + "?" + t, { cache: "no-store" }).then(function (r) {
                    if (!r.ok) throw new Error(f + " (" + r.status + ")");
                    return r.text();
                });
            });
    }

    function checkUpdate() {
        $("update").textContent = "Vérification...";
        $("btnUpdate").classList.add("hidden");
        getRemote("version.json").then(function (txt) {
            var info = JSON.parse(txt);
            if (!versionNewer(info.version, VERSION)) { $("update").textContent = "À jour"; return; }
            pending = info;
            $("update").textContent = "v" + info.version + " dispo";
            $("btnUpdate").classList.remove("hidden");
        }).catch(function (e) {
            $("update").textContent = "";
            status("Impossible de vérifier les mises à jour : " + (e && e.message ? e.message : e));
        });
    }

    function applyUpdate() {
        if (!pending) return;
        if (!fs) { modal("La mise à jour automatique a besoin de Node.js, qui n'est pas disponible dans ce panneau.", { cancel: false }); return; }
        var info = pending, base = extensionPath(), btn = $("btnUpdate");
        btn.disabled = true; btn.textContent = "Mise à jour...";
        Promise.all(info.files.map(function (f) {
            return getRemote(f).then(function (t) { return { f: f, t: t }; });
        })).then(function (all) {
            all.forEach(function (x) {
                var dest = path.join(base, x.f);
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                fs.writeFileSync(dest + ".new", x.t, "utf8");
            });
            all.forEach(function (x) { var dest = path.join(base, x.f); fs.renameSync(dest + ".new", dest); });
            try { localStorage.setItem("aura.notes", JSON.stringify(info.notes || [])); } catch (e) {}
            return loadHost().then(function () { location.reload(); });
        }).catch(function (e) {
            btn.disabled = false; btn.textContent = "Mettre à jour";
            modal("La mise à jour a échoué :\n" + (e && e.message ? e.message : e) + "\n\nVérifie ta connexion internet puis réessaie.", { cancel: false });
        });
    }
    $("btnUpdate").onclick = applyUpdate;
    $("update").onclick = checkUpdate;
    $("update").title = "Cliquer pour vérifier les mises à jour";

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
    setTimeout(checkUpdate, 800);
})();
