// AURASCRIPT-APP  (ne pas supprimer : permet au lanceur de reconnaître ce fichier)
// version: 1.5.0
// nouveautes: Nouvelle interface minimaliste noir et blanc
// nouveautes: Boutons qui s'éclairent au survol et au clic
// nouveautes: Sections Alignement, Lyrics et Presets plus lisibles
//
// AuraScript — code principal de l'outil, chargé par le lanceur AuraScript.jsx.

(function (thisObj) {
    var SCRIPT_NAME = "AuraScript";
    var SETTINGS_SECTION = "AuraScript";
    var SETTINGS_KEY = "presets";
    var presets = []; // [{ name, path }]

    // =====================================================================
    // Utilitaires
    // =====================================================================

    function getActiveComp() {
        var item = app.project ? app.project.activeItem : null;
        return (item && item instanceof CompItem) ? item : null;
    }

    function trim(s) {
        return String(s).replace(/^\s+|\s+$/g, "");
    }

    function isWindows() {
        return $.os.indexOf("Windows") !== -1;
    }

    function getTextDocProp(layer) {
        return layer.property("ADBE Text Properties").property("ADBE Text Document");
    }

    function deselectAll(comp) {
        for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
    }

    // =====================================================================
    // Presets .ffx (liste enregistrée dans les préférences d'After Effects)
    // =====================================================================

    function loadPresets() {
        presets = [];
        var arr = null;
        try {
            if (app.settings.haveSetting(SETTINGS_SECTION, SETTINGS_KEY)) {
                arr = eval(app.settings.getSetting(SETTINGS_SECTION, SETTINGS_KEY));
            }
        } catch (e) {
            arr = null;
        }
        if (!(arr instanceof Array)) return;
        // On ne garde que les presets .ffx (les anciens presets « style » sont ignorés)
        for (var i = 0; i < arr.length; i++) {
            var p = arr[i];
            if (p && p.path && /\.ffx$/i.test(p.path)) {
                presets.push({ name: p.name || decodeURI(new File(p.path).name), path: p.path });
            }
        }
    }

    function savePresets() {
        app.settings.saveSetting(SETTINGS_SECTION, SETTINGS_KEY, presets.toSource());
    }

    // ---------- Étirement des images clés du preset sur la durée du calque ----------

    function propPath(prop) {
        var parts = [];
        var p = prop;
        while (p && p.parentProperty) {
            parts.unshift(p.propertyIndex);
            p = p.parentProperty;
        }
        return parts.join("/");
    }

    // Appelle cb(prop) pour chaque propriété animable (avec valeur) du calque
    function walkProps(group, cb) {
        for (var i = 1; i <= group.numProperties; i++) {
            var p = null;
            try { p = group.property(i); } catch (e) { p = null; }
            if (!p || p.matchName === "ADBE Marker") continue;
            try {
                if (p.propertyType === PropertyType.PROPERTY) {
                    if (p.propertyValueType !== PropertyValueType.NO_VALUE && p.canVaryOverTime) cb(p);
                } else {
                    walkProps(p, cb);
                }
            } catch (e) {}
        }
    }

    // Mémorise les images clés existantes : "chemin|temps"
    function snapshotKeys(layer) {
        var set = {};
        walkProps(layer, function (p) {
            var path = propPath(p);
            for (var k = 1; k <= p.numKeys; k++) set[path + "|" + p.keyTime(k).toFixed(4)] = true;
        });
        return set;
    }

    function readKey(p, k) {
        var d = {
            time: p.keyTime(k),
            value: p.keyValue(k),
            inInterp: p.keyInInterpolationType(k),
            outInterp: p.keyOutInterpolationType(k)
        };
        try { d.inEase = p.keyInTemporalEase(k); d.outEase = p.keyOutTemporalEase(k); } catch (e) {}
        try { d.tContinuous = p.keyTemporalContinuous(k); d.tAuto = p.keyTemporalAutoBezier(k); } catch (e) {}
        if (p.isSpatial) {
            try {
                d.inTan = p.keyInSpatialTangent(k);
                d.outTan = p.keyOutSpatialTangent(k);
                d.sContinuous = p.keySpatialContinuous(k);
                d.sAuto = p.keySpatialAutoBezier(k);
            } catch (e) {}
        }
        return d;
    }

    function scaleEase(arr, factor) {
        var out = [];
        for (var i = 0; i < arr.length; i++) {
            var sp = factor > 0 ? arr[i].speed / factor : arr[i].speed;
            out.push(new KeyframeEase(sp, arr[i].influence));
        }
        return out;
    }

    function writeKey(p, d, newTime, factor) {
        var idx = p.addKey(newTime);
        p.setValueAtKey(idx, d.value);
        try { p.setInterpolationTypeAtKey(idx, d.inInterp, d.outInterp); } catch (e) {}
        try {
            if (d.tContinuous !== undefined) p.setTemporalContinuousAtKey(idx, d.tContinuous);
            if (d.tAuto !== undefined) p.setTemporalAutoBezierAtKey(idx, d.tAuto);
        } catch (e) {}
        try {
            if (d.inEase && d.outEase && !d.tAuto) {
                p.setTemporalEaseAtKey(idx, scaleEase(d.inEase, factor), scaleEase(d.outEase, factor));
            }
        } catch (e) {}
        if (p.isSpatial && d.inTan) {
            try {
                p.setSpatialTangentsAtKey(idx, d.inTan, d.outTan);
                p.setSpatialContinuousAtKey(idx, d.sContinuous);
                p.setSpatialAutoBezierAtKey(idx, d.sAuto);
            } catch (e) {}
        }
    }

    // Étire les images clés ajoutées par le preset pour couvrir [inPoint, outPoint]
    function stretchNewKeys(layer, before) {
        var targets = []; // { prop, keys: [indices] }
        var minT = null, maxT = null;

        walkProps(layer, function (p) {
            if (p.numKeys === 0) return;
            var path = propPath(p);
            var idxs = [];
            for (var k = 1; k <= p.numKeys; k++) {
                if (!before[path + "|" + p.keyTime(k).toFixed(4)]) {
                    idxs.push(k);
                    var t = p.keyTime(k);
                    if (minT === null || t < minT) minT = t;
                    if (maxT === null || t > maxT) maxT = t;
                }
            }
            if (idxs.length) targets.push({ prop: p, keys: idxs });
        });

        if (!targets.length || maxT - minT <= 0.0001) return 0;

        var start = layer.inPoint, end = layer.outPoint;
        var factor = (end - start) / (maxT - minT);

        for (var i = 0; i < targets.length; i++) {
            var p = targets[i].prop;
            var data = [];
            var j;
            for (j = 0; j < targets[i].keys.length; j++) data.push(readKey(p, targets[i].keys[j]));
            for (j = targets[i].keys.length - 1; j >= 0; j--) p.removeKey(targets[i].keys[j]);
            for (j = 0; j < data.length; j++) {
                writeKey(p, data[j], start + (data[j].time - minT) * factor, factor);
            }
        }
        return targets.length;
    }

    // Applique un preset .ffx à un calque, calé et étiré sur la durée du calque
    function applyPresetToLayer(comp, preset, layer) {
        var f = new File(preset.path);
        if (!f.exists) throw new Error("Fichier de preset introuvable :\n" + preset.path);

        var before = snapshotKeys(layer);
        deselectAll(comp);
        layer.selected = true;
        comp.time = layer.inPoint;   // les images clés du preset démarrent au début du texte
        layer.applyPreset(f);
        stretchNewKeys(layer, before);
    }

    function applyPresetToLayers(comp, preset, layers) {
        var savedTime = comp.time;
        for (var i = 0; i < layers.length; i++) applyPresetToLayer(comp, preset, layers[i]);
        comp.time = savedTime;
        deselectAll(comp);
        for (var j = 0; j < layers.length; j++) layers[j].selected = true;
    }

    // =====================================================================
    // Calque d'effet
    // =====================================================================

    // Lance une commande du menu Calque > Nouveau d'After Effects (le calque garde son nom par défaut)
    // et renvoie le nouveau calque s'il correspond à ce qu'on attend
    function newLayerByCommand(comp, names, fallbackId, isWanted) {
        var ids = [];
        for (var i = 0; i < names.length; i++) {
            try {
                var id = app.findMenuCommandId(names[i]);
                if (id) ids.push(id);
            } catch (e) {}
        }
        ids.push(fallbackId);
        for (var j = 0; j < ids.length; j++) {
            var before = comp.numLayers;
            try { app.executeCommand(ids[j]); } catch (e2) { continue; }
            if (comp.numLayers > before) {
                var sel = comp.selectedLayers;
                var lay = sel.length ? sel[0] : comp.layer(1);
                if (isWanted(lay)) return lay;
                try { lay.remove(); } catch (e3) {} // mauvaise commande : on annule
            }
        }
        return null;
    }

    function isAdjustment(l) { return l.adjustmentLayer === true; }
    function isNull(l) { return l.nullLayer === true; }

    // Nom par défaut de secours (si la commande d'After Effects n'est pas disponible)
    function nextDefaultName(comp, base) {
        var max = 0;
        var re = new RegExp("^" + base + " (\\d+)$");
        for (var i = 1; i <= comp.numLayers; i++) {
            var m = String(comp.layer(i).name).match(re);
            if (m && parseInt(m[1], 10) > max) max = parseInt(m[1], 10);
        }
        return base + " " + (max + 1);
    }

    // kind : "adjust" (calque d'effets), "null" (objet nul) ou "text" (texte)
    // Le nouveau calque a la même durée que srcLayer et se place juste au-dessus
    function createSpanLayerFor(comp, srcLayer, kind) {
        var inP = srcLayer.inPoint;
        var outP = srcLayer.outPoint;
        if (outP - inP <= 0) throw new Error("Le calque « " + srcLayer.name + " » a une durée nulle.");

        deselectAll(comp);
        srcLayer.selected = true;
        var lay = null;

        if (kind === "adjust") {
            lay = newLayerByCommand(comp, ["Adjustment Layer", "Calque d'effets", "Calque d’effets"], 2279, isAdjustment);
            if (!lay) {
                lay = comp.layers.addSolid([1, 1, 1], nextDefaultName(comp, "Adjustment Layer"),
                    comp.width, comp.height, comp.pixelAspect, comp.duration);
                lay.adjustmentLayer = true;
            }
        } else if (kind === "null") {
            lay = newLayerByCommand(comp, ["Null Object", "Objet nul"], 2767, isNull);
            if (!lay) lay = comp.layers.addNull(comp.duration);
        } else {
            lay = comp.layers.addText("Texte");
            var prop = getTextDocProp(lay);
            var td = prop.value;
            td.justification = ParagraphJustification.CENTER_JUSTIFY;
            prop.setValue(td);
            centerTextLayer(lay, comp);
        }

        lay.inPoint = inP;
        lay.outPoint = outP;
        lay.moveBefore(srcLayer);
        return lay;
    }

    // =====================================================================
    // Alignement (grille 3 x 3)
    // =====================================================================

    var ALIGN_LABELS = [
        ["Haut gauche", "Haut centre", "Haut droite"],
        ["Milieu gauche", "Centre", "Milieu droite"],
        ["Bas gauche", "Bas centre", "Bas droite"]
    ];

    function getPosProps(layer) {
        var tr = layer.property("ADBE Transform Group");
        var pos = tr.property("ADBE Position");
        if (pos.dimensionsSeparated) {
            return { sep: true, x: tr.property("ADBE Position_0"), y: tr.property("ADBE Position_1") };
        }
        return { sep: false, p: pos };
    }

    // Rectangle du calque dans la composition (hors rotation)
    function layerRect(layer, t) {
        var r;
        if (layer instanceof TextLayer || layer instanceof ShapeLayer) {
            r = layer.sourceRectAtTime(t, false);
        } else if (layer.source && layer.source.width) {
            r = { left: 0, top: 0, width: layer.source.width, height: layer.source.height };
        } else {
            r = null; // caméra, lumière : on aligne leur point de position
        }
        var tr = layer.property("ADBE Transform Group");
        var a = r ? tr.property("ADBE Anchor Point").valueAtTime(t, false) : [0, 0];
        var s = r ? tr.property("ADBE Scale").valueAtTime(t, false) : [100, 100];
        if (!r) r = { left: 0, top: 0, width: 0, height: 0 };
        var pp = getPosProps(layer);
        var px, py;
        if (pp.sep) {
            px = pp.x.valueAtTime(t, false);
            py = pp.y.valueAtTime(t, false);
        } else {
            var v = pp.p.valueAtTime(t, false);
            px = v[0];
            py = v[1];
        }
        var sx = s[0] / 100, sy = s[1] / 100;
        var x1 = px + (r.left - a[0]) * sx, x2 = px + (r.left + r.width - a[0]) * sx;
        var y1 = py + (r.top - a[1]) * sy, y2 = py + (r.top + r.height - a[1]) * sy;
        return {
            left: Math.min(x1, x2), top: Math.min(y1, y2),
            width: Math.abs(x2 - x1), height: Math.abs(y2 - y1)
        };
    }

    // Décale la position (toute l'animation si la position a des images clés)
    function shiftProp(prop, delta) {
        var k, v;
        if (prop.numKeys > 0) {
            for (k = 1; k <= prop.numKeys; k++) {
                v = prop.keyValue(k);
                prop.setValueAtKey(k, (v instanceof Array) ? addVec(v, delta) : v + delta[0]);
            }
        } else {
            v = prop.value;
            prop.setValue((v instanceof Array) ? addVec(v, delta) : v + delta[0]);
        }
    }

    function addVec(v, d) {
        var out = [];
        for (var i = 0; i < v.length; i++) out.push(v[i] + (i < d.length ? d[i] : 0));
        return out;
    }

    function moveLayerBy(layer, dx, dy) {
        var pp = getPosProps(layer);
        if (pp.sep) {
            shiftProp(pp.x, [dx]);
            shiftProp(pp.y, [dy]);
        } else {
            shiftProp(pp.p, [dx, dy]);
        }
    }

    // h : 0 gauche, 1 centre, 2 droite — v : 0 haut, 1 milieu, 2 bas
    function alignLayers(comp, h, v) {
        h = Number(h);
        v = Number(v);
        var sel = comp.selectedLayers;
        var t = comp.time;
        var moved = 0, skipped = 0;
        for (var i = 0; i < sel.length; i++) {
            var layer = sel[i];
            var wasLocked = layer.locked;
            var parent = layer.parent;
            try {
                if (wasLocked) layer.locked = false;
                // Calque parenté : on le détache le temps du calcul, puis on le rattache sans le faire bouger
                if (parent) layer.setParentWithJump();
                var r = layerRect(layer, t);
                // (pas de conditions « ? : » imbriquées : After Effects les lit mal)
                var tx = comp.width - r.width;                     // droite
                if (h === 0) tx = 0;                               // gauche
                else if (h === 1) tx = (comp.width - r.width) / 2; // centre
                var ty = comp.height - r.height;                     // bas
                if (v === 0) ty = 0;                                 // haut
                else if (v === 1) ty = (comp.height - r.height) / 2; // milieu
                moveLayerBy(layer, tx - r.left, ty - r.top);
                moved++;
            } catch (e) {
                skipped++;
            }
            try { if (parent && !layer.parent) layer.setParentWithJump(parent); } catch (e2) {}
            try { if (wasLocked) layer.locked = true; } catch (e3) {}
        }
        return { moved: moved, skipped: skipped };
    }

    // =====================================================================
    // Thème : noir et blanc minimaliste, touches de lumière au survol
    // =====================================================================

    var THEME = {
        bg: 0.07,          // fond du panneau
        btn: 0.11,         // fond des boutons
        btnOver: 0.16,     // fond au survol
        btnDown: 0.24,     // fond au clic
        border: 0.26,      // contour normal
        borderOver: 0.9,   // contour éclairé
        text: 0.86,        // texte des boutons
        label: 0.62,       // textes secondaires
        title: 0.95,       // titres de section
        line: 0.18         // traits de séparation
    };

    function grey(v, a) { return [v, v, v, (a === undefined) ? 1 : a]; }

    function safeFont(style, size) {
        try { return ScriptUI.newFont("dialog", style, size); } catch (e) { return null; }
    }

    // Couleur de fond d'un élément (groupe, panneau…)
    function paintBg(el, v) {
        try { el.graphics.backgroundColor = el.graphics.newBrush(el.graphics.BrushType.SOLID_COLOR, grey(v)); } catch (e) {}
    }

    // Couleur et police d'un texte (statictext, checkbox…)
    function paintText(el, v, style, size) {
        try { el.graphics.foregroundColor = el.graphics.newPen(el.graphics.PenType.SOLID_COLOR, grey(v), 1); } catch (e) {}
        if (style) {
            var f = safeFont(style, size || 11);
            if (f) { try { el.graphics.font = f; } catch (e2) {} }
        }
    }

    // Recolore récursivement les textes d'un conteneur (ex. l'en-tête du lanceur)
    function paintTree(el, skip) {
        if (!el || el === skip) return;
        try {
            if (el.type === "statictext") paintText(el, THEME.label);
            if (el.children) for (var i = 0; i < el.children.length; i++) paintTree(el.children[i], skip);
        } catch (e) {}
    }

    // Titre de section : texte clair + fine ligne
    function addSection(parent, title) {
        var g = parent.add("group");
        g.orientation = "column";
        g.alignChildren = ["fill", "top"];
        g.spacing = 5;
        g.margins = [0, 6, 0, 0];
        var t = g.add("statictext", undefined, title);
        paintText(t, THEME.title, "BOLD", 11);
        var line = g.add("group");
        line.preferredSize.height = 1;
        line.alignment = ["fill", "top"];
        paintBg(line, THEME.line);
        return g;
    }

    // Bouton dessiné : kind = "default", "primary" (blanc) ou "plus" (case d'alignement)
    function makeButtonDraw(kind, isCenter) {
        return function (ds) { drawThemedButton(this, kind, isCenter, ds); };
    }

    function drawThemedButton(btn, kind, isCenter, ds) {
        var g = btn.graphics;
        var w = btn.size[0], h = btn.size[1];
        var over = false, down = false;
        try { over = ds.mouseOver; down = ds.leftButtonPressed; } catch (e) {}

        // (if/else plutôt que « ? : » imbriqués, qu'After Effects lit mal)
        var fillV, borderV, inkV;
        if (kind === "primary") {
            fillV = 0.88;
            if (over) fillV = 1;
            if (down) fillV = 0.72;
            borderV = fillV;
            inkV = 0.06;
        } else {
            fillV = THEME.btn;
            borderV = THEME.border;
            inkV = THEME.text;
            if (isCenter) borderV = 0.45;
            if (over) { fillV = THEME.btnOver; borderV = THEME.borderOver; inkV = 1; }
            if (down) { fillV = THEME.btnDown; borderV = THEME.borderOver; inkV = 1; }
        }

        g.newPath();
        g.rectPath(0, 0, w, h);
        g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, grey(fillV)));

        g.newPath();
        g.rectPath(0.5, 0.5, w - 1, h - 1);
        g.strokePath(g.newPen(g.PenType.SOLID_COLOR, grey(borderV), 1));

        // halo lumineux discret au survol
        if ((over || down) && kind !== "primary") {
            g.newPath();
            g.rectPath(1.5, 1.5, w - 3, h - 3);
            g.strokePath(g.newPen(g.PenType.SOLID_COLOR, grey(1, 0.18), 1));
        }

        var ink = g.newPen(g.PenType.SOLID_COLOR, grey(inkV), (kind === "plus") ? 2 : 1);
        if (kind === "plus") {
            var cx = Math.round(w / 2), cy = Math.round(h / 2);
            var s = Math.round(Math.min(w, h) * 0.22);
            g.newPath(); g.moveTo(cx - s, cy); g.lineTo(cx + s, cy); g.strokePath(ink);
            g.newPath(); g.moveTo(cx, cy - s); g.lineTo(cx, cy + s); g.strokePath(ink);
            return;
        }

        var label = btn.text;
        var font = safeFont(kind === "primary" ? "BOLD" : "REGULAR", 11);
        var m = font ? g.measureString(label, font) : g.measureString(label);
        var x = Math.round((w - m[0]) / 2), y = Math.round((h - m[1]) / 2);
        if (font) g.drawString(label, ink, x, y, font);
        else g.drawString(label, ink, x, y);
    }

    function themeButton(btn, kind, isCenter) {
        try { btn.onDraw = makeButtonDraw(kind || "default", isCenter === true); } catch (e) {}
        return btn;
    }

    // =====================================================================
    // Paroles
    // =====================================================================

    // Marqueurs : ceux du calque sélectionné (ex. la musique) s'il en a, sinon ceux de la composition
    function getMarkers(comp) {
        var sel = comp.selectedLayers;
        var i, k, m, times = [];
        for (i = 0; i < sel.length; i++) {
            m = sel[i].property("ADBE Marker");
            if (m && m.numKeys > 0) {
                for (k = 1; k <= m.numKeys; k++) times.push(m.keyTime(k));
                return { times: times, end: sel[i].outPoint, source: "le calque « " + sel[i].name + " »" };
            }
        }
        m = comp.markerProperty;
        if (m && m.numKeys > 0) {
            for (k = 1; k <= m.numKeys; k++) times.push(m.keyTime(k));
            return { times: times, end: comp.duration, source: "la composition" };
        }
        return null;
    }

    // Centre le texte au milieu de l'image
    function centerTextLayer(layer, comp) {
        var r = layer.sourceRectAtTime(layer.inPoint, false);
        var tr = layer.property("ADBE Transform Group");
        tr.property("ADBE Anchor Point").setValue([r.left + r.width / 2, r.top + r.height / 2]);
        tr.property("ADBE Position").setValue([comp.width / 2, comp.height / 2]);
    }

    function createLyrics(comp, rawText, fontSize, preset) {
        // Chaque mot (séparé par un espace ou un retour à la ligne) devient un texte
        var rawWords = String(rawText).split(/\s+/);
        var lines = [];
        for (var i = 0; i < rawWords.length; i++) {
            var l = trim(rawWords[i]);
            if (l !== "") lines.push(l);
        }
        if (!lines.length) throw new Error("Écris d'abord les paroles (un mot = un texte).");

        var mk = getMarkers(comp);
        if (!mk) {
            throw new Error("Aucun marqueur trouvé.\n\nAjoute des marqueurs sur la composition " +
                "(touche * du pavé numérique, aucun calque sélectionné) ou sur ton calque audio " +
                "(sélectionne-le puis touche *), un marqueur au début de chaque mot.");
        }

        var n = Math.min(lines.length, mk.times.length);
        var created = [];

        for (var j = 0; j < n; j++) {
            var start = mk.times[j];
            var end = (j + 1 < mk.times.length) ? mk.times[j + 1] : mk.end;
            if (end <= start) end = start + 2;

            var t = comp.layers.addText(lines[j]);
            var prop = getTextDocProp(t);
            var td = prop.value;
            td.fontSize = fontSize;
            td.applyFill = true;
            td.fillColor = [1, 1, 1];
            td.justification = ParagraphJustification.CENTER_JUSTIFY;
            prop.setValue(td);

            t.inPoint = start;
            t.outPoint = end;
            t.label = 9;
            centerTextLayer(t, comp);
            created.push(t);
        }

        if (preset && created.length) applyPresetToLayers(comp, preset, created);

        var msg = created.length + " texte(s) créé(s) depuis les marqueurs de " + mk.source + ".";
        if (lines.length > mk.times.length) {
            msg += "\n" + (lines.length - mk.times.length) + " mot(s) sans marqueur ignoré(s).";
        }
        return msg;
    }

    // =====================================================================
    // Interface
    // =====================================================================

    function buildUI(thisObj) {
        // Quand l'outil est chargé par le lanceur, il se construit dans le conteneur fourni
        var host = $.global.CEP_APP_CONTAINER;
        var win;
        if (host) win = host;
        else if (thisObj instanceof Panel) win = thisObj;
        else win = new Window("palette", SCRIPT_NAME, undefined, { resizeable: true });

        win.orientation = "column";
        win.alignChildren = ["fill", "top"];
        win.spacing = 10;
        if (!host) win.margins = 12;

        // Fond noir sur tout le panneau (y compris l'en-tête du lanceur)
        paintBg(win, THEME.bg);
        if (host && host.parent) {
            paintBg(host.parent, THEME.bg);
            paintTree(host.parent, host);
        }

        // ---------- Alignement ----------
        var sAli = addSection(win, "ALIGNEMENT");
        var gAli = sAli.add("group");
        gAli.orientation = "row";
        gAli.alignChildren = ["left", "top"];
        gAli.spacing = 12;

        var grid = gAli.add("group");
        grid.orientation = "column";
        grid.spacing = 4;
        var alignCells = []; // index = v * 3 + h
        for (var gv = 0; gv < 3; gv++) {
            var gRow = grid.add("group");
            gRow.orientation = "row";
            gRow.spacing = 4;
            for (var gh = 0; gh < 3; gh++) {
                var cell = gRow.add("button", undefined, "+");
                cell.preferredSize = [26, 26];
                cell.helpTip = ALIGN_LABELS[gv][gh];
                themeButton(cell, "plus", gh === 1 && gv === 1);
                cell.cellIndex = gv * 3 + gh;
                cell.onClick = onAlignClick;
                alignCells.push(cell);
            }
        }

        var gLayers = gAli.add("group");
        gLayers.orientation = "column";
        gLayers.alignChildren = ["fill", "top"];
        gLayers.alignment = ["fill", "top"];
        gLayers.spacing = 4;
        var btnNull = themeButton(gLayers.add("button", undefined, "Null"));
        btnNull.preferredSize = [130, 26];
        btnNull.helpTip = "Crée un objet nul au-dessus du/des calque(s) sélectionné(s), avec la même durée";
        var btnText = themeButton(gLayers.add("button", undefined, "Text"));
        btnText.preferredSize = [130, 26];
        btnText.helpTip = "Crée un texte au-dessus du/des calque(s) sélectionné(s), avec la même durée";
        var btnAdj = themeButton(gLayers.add("button", undefined, "Adjustment layer"));
        btnAdj.preferredSize = [130, 26];
        btnAdj.helpTip = "Crée un calque d'effet au-dessus du/des calque(s) sélectionné(s), avec la même durée";

        // ---------- Lyrics ----------
        var pLyr = addSection(win, "LYRICS");
        var tLyr = pLyr.add("statictext", undefined, "Un mot = un texte, calé sur un marqueur");
        paintText(tLyr, THEME.label);
        var etLyrics = pLyr.add("edittext", undefined, "", { multiline: true, scrolling: true, wantReturn: true });
        etLyrics.preferredSize = [260, 110];

        var gOpt = pLyr.add("group");
        gOpt.orientation = "row";
        gOpt.alignChildren = ["left", "center"];
        gOpt.spacing = 6;
        var tSize = gOpt.add("statictext", undefined, "Taille");
        paintText(tSize, THEME.label);
        var etSize = gOpt.add("edittext", undefined, "70");
        etSize.characters = 4;
        var chkLyrPreset = gOpt.add("checkbox", undefined, "Avec le preset");
        chkLyrPreset.value = false;
        chkLyrPreset.helpTip = "Applique le preset choisi dans la section Presets aux textes créés";
        paintText(chkLyrPreset, THEME.label);

        var btnLyrics = themeButton(pLyr.add("button", undefined, "Créer les paroles"), "primary");
        btnLyrics.preferredSize.height = 28;

        // ---------- Presets ----------
        var pPre = addSection(win, "PRESETS  .FFX");
        var gPre = pPre.add("group");
        gPre.orientation = "row";
        gPre.alignChildren = ["fill", "center"];
        gPre.spacing = 4;
        var ddPreset = gPre.add("dropdownlist", undefined, []);
        ddPreset.alignment = ["fill", "center"];
        ddPreset.preferredSize.width = 150;
        var btnAddPreset = themeButton(gPre.add("button", undefined, "+ Preset"));
        btnAddPreset.alignment = ["right", "center"];
        btnAddPreset.preferredSize = [70, 24];
        btnAddPreset.helpTip = "Ajouter un ou plusieurs fichiers .ffx à la liste";
        var btnDelPreset = themeButton(gPre.add("button", undefined, "–"));
        btnDelPreset.alignment = ["right", "center"];
        btnDelPreset.preferredSize = [26, 24];
        btnDelPreset.helpTip = "Retirer le preset choisi de la liste";
        var btnApply = themeButton(pPre.add("button", undefined, "Appliquer aux textes sélectionnés"));
        btnApply.preferredSize.height = 26;
        btnApply.helpTip = "Le preset démarre au début du texte et son animation est étirée jusqu'à la fin";

        var status = win.add("statictext", undefined, "", { multiline: true });
        status.preferredSize.height = 30;
        paintText(status, THEME.label);

        // ---------- Logique ----------

        function refreshPresetList(selectIndex) {
            ddPreset.removeAll();
            for (var i = 0; i < presets.length; i++) ddPreset.add("item", presets[i].name);
            if (presets.length) {
                if (selectIndex === undefined || selectIndex < 0 || selectIndex >= presets.length) selectIndex = 0;
                ddPreset.selection = selectIndex;
            }
        }

        function selectedPreset() {
            return ddPreset.selection ? presets[ddPreset.selection.index] : null;
        }

        var SPAN_LABELS = { adjust: "Adjustment layer", "null": "Null", text: "Text" };

        // Crée un calque (adjust / null / text) de la même durée que chaque calque sélectionné
        function onSpanClick(kind) {
            var comp = getActiveComp();
            if (!comp) { alert("Ouvre d'abord une composition."); return; }
            var sel = comp.selectedLayers;
            var targets = [];
            for (var i = 0; i < sel.length; i++) targets.push(sel[i]);
            if (!targets.length) { alert("Clique d'abord sur une vidéo (ou un calque) dans la timeline."); return; }

            app.beginUndoGroup(SPAN_LABELS[kind]);
            var count = 0;
            try {
                for (var j = 0; j < targets.length; j++) {
                    createSpanLayerFor(comp, targets[j], kind);
                    count++;
                }
            } catch (e) {
                alert("Erreur : " + e.message);
            } finally {
                app.endUndoGroup();
            }
            status.text = count + " calque(s) « " + SPAN_LABELS[kind] + " » créé(s).";
        }
        btnAdj.onClick = function () { onSpanClick("adjust"); };
        btnNull.onClick = function () { onSpanClick("null"); };
        btnText.onClick = function () { onSpanClick("text"); };

        // Retrouve quel carré a été cliqué grâce à sa place dans la liste (index = v * 3 + h)
        function onAlignClick() {
            var idx = -1;
            for (var c = 0; c < alignCells.length; c++) {
                if (alignCells[c] === this) { idx = c; break; }
            }
            if (idx < 0) idx = parseInt(this.cellIndex, 10);
            if (isNaN(idx) || idx < 0 || idx > 8) return;
            var h = idx % 3;
            var v = Math.floor(idx / 3);
            {
                var comp = getActiveComp();
                if (!comp) { alert("Ouvre d'abord une composition."); return; }
                if (!comp.selectedLayers.length) { alert("Sélectionne d'abord un ou plusieurs calques."); return; }

                app.beginUndoGroup("Aligner : " + ALIGN_LABELS[v][h]);
                try {
                    var res = alignLayers(comp, h, v);
                    status.text = res.moved + " calque(s) placé(s) : " + ALIGN_LABELS[v][h] + ".";
                    if (res.skipped) status.text += "\n" + res.skipped + " n'a (n'ont) pas pu être déplacé(s).";
                } catch (e) {
                    alert("Erreur : " + e.message);
                } finally {
                    app.endUndoGroup();
                }
            }
        }

        btnLyrics.onClick = function () {
            var comp = getActiveComp();
            if (!comp) { alert("Ouvre d'abord une composition."); return; }
            var size = parseFloat(etSize.text);
            if (isNaN(size) || size <= 0) size = 70;
            var preset = chkLyrPreset.value ? selectedPreset() : null;
            if (chkLyrPreset.value && !preset) { alert("Aucun preset : ajoute un fichier .ffx avec « + Preset »."); return; }

            app.beginUndoGroup("Créer les paroles");
            try {
                status.text = createLyrics(comp, etLyrics.text, size, preset);
            } catch (e) {
                alert(e.message);
            } finally {
                app.endUndoGroup();
            }
        };

        btnAddPreset.onClick = function () {
            var filter = isWindows()
                ? "Presets After Effects:*.ffx"
                : function (f) { return (f instanceof Folder) || /\.ffx$/i.test(f.name); };
            var files = File.openDialog("Choisis un ou plusieurs presets .ffx", filter, true);
            if (!files) return;
            if (!(files instanceof Array)) files = [files];

            var added = 0;
            for (var i = 0; i < files.length; i++) {
                var f = files[i];
                if (!/\.ffx$/i.test(f.name)) continue;
                var exists = false;
                for (var j = 0; j < presets.length; j++) {
                    if (presets[j].path === f.fsName) { exists = true; break; }
                }
                if (exists) continue;
                presets.push({ name: decodeURI(f.name).replace(/\.ffx$/i, ""), path: f.fsName });
                added++;
            }
            if (!added) { status.text = "Aucun nouveau preset ajouté."; return; }
            savePresets();
            refreshPresetList(presets.length - 1);
            status.text = added + " preset(s) ajouté(s).";
        };

        btnDelPreset.onClick = function () {
            if (!ddPreset.selection) return;
            var idx = ddPreset.selection.index;
            var p = presets[idx];
            if (!confirm("Retirer « " + p.name + " » de la liste ?\n(le fichier .ffx n'est pas supprimé)")) return;
            presets.splice(idx, 1);
            savePresets();
            refreshPresetList(idx - 1);
            status.text = "Preset retiré de la liste.";
        };

        btnApply.onClick = function () {
            var comp = getActiveComp();
            if (!comp) { alert("Ouvre d'abord une composition."); return; }
            var preset = selectedPreset();
            if (!preset) { alert("Ajoute d'abord un fichier .ffx avec « + Preset »."); return; }

            var sel = comp.selectedLayers;
            var texts = [];
            for (var i = 0; i < sel.length; i++) {
                if (sel[i] instanceof TextLayer) texts.push(sel[i]);
            }
            if (!texts.length) { alert("Sélectionne au moins un calque texte."); return; }

            app.beginUndoGroup("Appliquer preset texte");
            try {
                applyPresetToLayers(comp, preset, texts);
                status.text = "« " + preset.name + " » appliqué à " + texts.length + " texte(s).";
            } catch (e) {
                alert("Erreur : " + e.message);
            } finally {
                app.endUndoGroup();
            }
        };

        loadPresets();
        refreshPresetList(0);

        if (host) return win; // le lanceur s'occupe de la mise en page

        win.onResizing = win.onResize = function () { this.layout.resize(); };
        if (win instanceof Window) {
            win.center();
            win.show();
        } else {
            win.layout.layout(true);
        }
        return win;
    }

    buildUI(thisObj);
})(this);
