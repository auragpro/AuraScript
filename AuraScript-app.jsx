// AURASCRIPT-APP  (ne pas supprimer : permet au lanceur de reconnaître ce fichier)
// version: 1.6.6
// nouveautes: Déprecomp : les calques ressortent exactement au même endroit dans la timeline, sans être coupés ni déplacés
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
    // ---------- Precomp / Déprecomp ----------

    function uniqueCompName(base) {
        var name = base, n = 1;
        for (;;) {
            var used = false;
            for (var i = 1; i <= app.project.numItems; i++) {
                if (app.project.item(i).name === name) { used = true; break; }
            }
            if (!used) return name;
            n++;
            name = base + " " + n;
        }
    }

    // Pré-compose les calques sélectionnés (comme Calque > Pré-composer, sans la fenêtre)
    function precomposeSelected(comp) {
        var sel = comp.selectedLayers;
        if (!sel.length) return null;
        var idx = [], minIn = null, maxOut = null;
        for (var i = 0; i < sel.length; i++) {
            idx.push(sel[i].index);
            if (minIn === null || sel[i].inPoint < minIn) minIn = sel[i].inPoint;
            if (maxOut === null || sel[i].outPoint > maxOut) maxOut = sel[i].outPoint;
        }
        idx.sort(function (a, b) { return a - b; });
        var base = "Precomp";
        if (sel.length === 1) base = sel[0].name + " precomp";
        var newComp = comp.layers.precompose(idx, uniqueCompName(base), true);
        var layer = comp.layer(idx[0]);
        try {
            if (layer.source === newComp) {
                layer.inPoint = minIn;
                layer.outPoint = maxOut;
            }
        } catch (e) {}
        return newComp;
    }

    function hasLayerExtras(layer) {
        try {
            var fx = layer.property("ADBE Effect Parade");
            if (fx && fx.numProperties > 0) return true;
            if (layer.timeRemapEnabled) return true;
            var tr = layer.property("ADBE Transform Group");
            for (var i = 1; i <= tr.numProperties; i++) {
                if (tr.property(i).numKeys > 0) return true;
            }
        } catch (e) {}
        return false;
    }

    function setLayerSpan(l, tIn, tOut) {
        try { l.outPoint = tOut; } catch (e) {}
        try { l.inPoint = tIn; } catch (e2) {}
        try { l.outPoint = tOut; } catch (e3) {}
    }

    // Remet le contenu d'un precomp dans la composition, à sa place
    function uncompose(comp, layer) {
        var src = layer.source;
        var off = layer.startTime;
        var k = 1;
        try { k = layer.stretch / 100; } catch (eS) {}
        var map = {};
        var created = [];
        for (var i = 1; i <= src.numLayers; i++) {
            var L = src.layer(i);
            L.copyToComp(comp);
            var nl = comp.layer(1);
            // on recalcule les temps depuis le calque d'origine (copyToComp ne les garde pas toujours)
            try { if (k !== 1) nl.stretch = L.stretch * k; } catch (eS2) {}
            nl.startTime = off + L.startTime * k;
            var a = off + L.inPoint * k, b = off + L.outPoint * k;
            if (k < 0) { var tmp = a; a = b; b = tmp; }
            setLayerSpan(nl, a, b);
            nl.moveBefore(layer);
            map[L.index] = nl;
            created.push({ src: L, dst: nl });
        }
        // parentés internes au precomp
        for (var j = 0; j < created.length; j++) {
            try {
                var par = created[j].src.parent;
                if (par && map[par.index]) created[j].dst.setParentWithJump(map[par.index]);
            } catch (e) {}
        }
        // le contenu ressort tel quel (aucune coupe)
        layer.remove();
        return created.length;
    }

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
    // Thème : noir et blanc minimaliste
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
        // Rendu fixe : aucun effet au survol ou au clic
        // (if/else plutôt que « ? : » imbriqués, qu'After Effects lit mal)
        var fillV, borderV, inkV;
        if (kind === "primary") {
            fillV = 0.88;
            borderV = fillV;
            inkV = 0.06;
        } else {
            fillV = THEME.btn;
            borderV = THEME.border;
            inkV = THEME.text;
            if (isCenter) borderV = 0.45;
        }

        g.newPath();
        g.rectPath(0, 0, w, h);
        g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, grey(fillV)));

        g.newPath();
        g.rectPath(0.5, 0.5, w - 1, h - 1);
        g.strokePath(g.newPen(g.PenType.SOLID_COLOR, grey(borderV), 1));

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
    // COURBES : moteur, bibliothèque, import Flow, éditeur
    // =====================================================================

    var CURVE_FILE = new File(Folder.userData.fsName + "/AuraScript/curves.json");
    var MY_LIB = "Mes courbes";
    var curveLib = []; // [{ id, name, lib, keys: 2|3, segs: [[x1,y1,x2,y2], ...], mid: [t, v], end: v }]

    // ---------- Petits outils ----------

    function clampNum(v, a, b) {
        if (v < a) return a;
        if (v > b) return b;
        return v;
    }

    function round4(v) { return Math.round(v * 10000) / 10000; }

    function newCurveId() {
        return "c" + new Date().getTime() + "_" + Math.floor(Math.random() * 1000000);
    }

    function isNum(v) { return typeof v === "number" && !isNaN(v) && isFinite(v); }

    function isNum4(a) {
        if (!(a instanceof Array) || a.length !== 4) return false;
        for (var i = 0; i < 4; i++) if (!isNum(Number(a[i])) || a[i] === null || a[i] === "") return false;
        return true;
    }

    // Courbe « miroir » dans le temps (ease-out <-> ease-in) : c'est le reverse
    function mirrorBez(b) {
        return [1 - b[2], 1 - b[3], 1 - b[0], 1 - b[1]];
    }

    function cloneCurve(c) {
        var segs = [];
        for (var i = 0; i < c.segs.length; i++) segs.push([c.segs[i][0], c.segs[i][1], c.segs[i][2], c.segs[i][3]]);
        return {
            id: c.id, name: c.name, lib: c.lib, keys: c.keys, segs: segs,
            mid: c.mid ? [c.mid[0], c.mid[1]] : [0.5, 1],
            end: (c.end === undefined) ? 0 : c.end
        };
    }

    function defaultCurve() {
        return { id: null, name: "", lib: MY_LIB, keys: 2, segs: [[0.33, 0, 0.2, 1]], mid: [0.5, 1], end: 0 };
    }

    // Normalise une courbe venant d'un fichier (valeurs sûres)
    function sanitizeCurve(c) {
        var out = defaultCurve();
        out.id = c.id ? String(c.id) : newCurveId();
        out.name = c.name ? String(c.name) : "Courbe";
        out.lib = c.lib ? String(c.lib) : MY_LIB;
        out.keys = (Number(c.keys) === 3) ? 3 : 2;
        out.segs = [];
        var n = out.keys - 1;
        for (var i = 0; i < n; i++) {
            var s = (c.segs && isNum4(c.segs[i])) ? c.segs[i] : [0.33, 0, 0.2, 1];
            out.segs.push([clampNum(Number(s[0]), 0, 1), clampNum(Number(s[1]), -3, 4),
                clampNum(Number(s[2]), 0, 1), clampNum(Number(s[3]), -3, 4)]);
        }
        if (c.mid instanceof Array && c.mid.length === 2) {
            out.mid = [clampNum(Number(c.mid[0]), 0.05, 0.95), clampNum(Number(c.mid[1]), -1, 2)];
        }
        if (isNum(Number(c.end))) out.end = clampNum(Number(c.end), -1, 2);
        if (out.keys === 3) fixThreeKeyValues(out);
        return out;
    }

    // Évite deux clés à la même valeur (la transition serait plate et impossible à éditer)
    function fixThreeKeyValues(c) {
        if (Math.abs(c.mid[1]) < 0.05) c.mid[1] = (c.mid[1] < 0) ? -0.05 : 0.05;
        if (Math.abs(c.end - c.mid[1]) < 0.05) c.end = (c.end < c.mid[1]) ? c.mid[1] - 0.05 : c.mid[1] + 0.05;
    }

    // ---------- JSON (sans dépendance) ----------

    function toJSON(v, ind) {
        ind = ind || "";
        var i, out, k;
        if (v === null || v === undefined) return "null";
        if (typeof v === "number") return isFinite(v) ? String(round4(v)) : "0";
        if (typeof v === "boolean") return v ? "true" : "false";
        if (typeof v === "string") {
            return "\"" + v.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + "\"";
        }
        if (v instanceof Array) {
            out = [];
            for (i = 0; i < v.length; i++) out.push(toJSON(v[i], ind));
            return "[" + out.join(", ") + "]";
        }
        out = [];
        for (k in v) {
            if (v.hasOwnProperty(k)) out.push(ind + "  " + toJSON(String(k)) + ": " + toJSON(v[k], ind + "  "));
        }
        return "{\n" + out.join(",\n") + "\n" + ind + "}";
    }

    // Lecture JSON sûre (vérifie qu'il n'y a que des données avant d'évaluer)
    function parseJSONSafe(text) {
        text = String(text);
        if (text.charCodeAt(0) === 0xFEFF) text = text.substring(1);
        var t = text.replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, "@")
            .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, "]")
            .replace(/(?:^|:|,)(?:\s*\[)+/g, "");
        if (/^[\],:{}\s]*$/.test(t)) return eval("(" + text + ")");
        throw new Error("Ce fichier n'est pas un JSON valide.");
    }

    function readTextFile(f) {
        f.encoding = "UTF-8";
        if (!f.open("r")) return "";
        var s = f.read();
        f.close();
        if (s.charCodeAt(0) === 0xFEFF) s = s.substring(1);
        return s;
    }

    // ---------- Bibliothèque (fichier curves.json) ----------

    function starterCurves() {
        return [
            sanitizeCurve({ name: "Snap", lib: MY_LIB, keys: 2, segs: [[0.9, 0, 0.1, 1]] }),
            sanitizeCurve({ name: "Ease out fort", lib: MY_LIB, keys: 2, segs: [[0.16, 1, 0.3, 1]] }),
            sanitizeCurve({ name: "Ease in-out", lib: MY_LIB, keys: 2, segs: [[0.65, 0, 0.35, 1]] }),
            sanitizeCurve({ name: "Zoom aller-retour", lib: MY_LIB, keys: 3,
                segs: [[0.2, 0.8, 0.3, 1], [0.7, 0, 0.8, 0.2]], mid: [0.5, 1], end: 0 })
        ];
    }

    function loadCurveLib() {
        curveLib = [];
        try {
            if (CURVE_FILE.exists) {
                var data = parseJSONSafe(readTextFile(CURVE_FILE));
                var arr = (data && data.curves instanceof Array) ? data.curves : data;
                if (arr instanceof Array) {
                    for (var i = 0; i < arr.length; i++) {
                        if (arr[i]) curveLib.push(sanitizeCurve(arr[i]));
                    }
                }
                return;
            }
        } catch (e) {}
        curveLib = starterCurves();
        saveCurveLib();
    }

    function saveCurveLib() {
        try {
            if (!CURVE_FILE.parent.exists) CURVE_FILE.parent.create();
            CURVE_FILE.encoding = "UTF-8";
            if (!CURVE_FILE.open("w")) return false;
            CURVE_FILE.write(toJSON({ version: 1, curves: curveLib }));
            CURVE_FILE.close();
            return true;
        } catch (e) {
            return false;
        }
    }

    function libraryNames() {
        var names = [MY_LIB];
        for (var i = 0; i < curveLib.length; i++) {
            var found = false;
            for (var j = 0; j < names.length; j++) if (names[j] === curveLib[i].lib) { found = true; break; }
            if (!found) names.push(curveLib[i].lib);
        }
        return names;
    }

    function findCurveIndex(id) {
        for (var i = 0; i < curveLib.length; i++) if (curveLib[i].id === id) return i;
        return -1;
    }

    // ---------- Import Flow (et formats proches) ----------

    function bezFromString(s) {
        var m = String(s).match(/(-?[\d.]+(?:e-?\d+)?)\s*,\s*(-?[\d.]+(?:e-?\d+)?)\s*,\s*(-?[\d.]+(?:e-?\d+)?)\s*,\s*(-?[\d.]+(?:e-?\d+)?)/i);
        if (!m) return null;
        return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    }

    // Parcourt n'importe quelle structure et récupère les courbes cubic-bezier qu'elle contient
    function extractCurves(node, out, nameHint, depth) {
        if (depth > 8 || node === null || node === undefined) return;
        var i, k, v;
        if (node instanceof Array) {
            if (isNum4(node)) { out.push({ name: nameHint, v: node }); return; }
            for (i = 0; i < node.length; i++) extractCurves(node[i], out, null, depth + 1);
            return;
        }
        if (typeof node === "string") {
            if (/cubic-bezier/i.test(node)) {
                v = bezFromString(node);
                if (v) out.push({ name: nameHint, v: v });
            }
            return;
        }
        if (typeof node !== "object") return;

        var nm = node.name || node.title || node.label || nameHint;
        var cand = [node.value, node.curve, node.bezier, node.cubicBezier, node.cubic_bezier, node.points, node.values, node.ease, node.easing];
        for (i = 0; i < cand.length; i++) {
            v = cand[i];
            if (v === undefined || v === null) continue;
            if (typeof v === "string") v = bezFromString(v);
            if (v && isNum4(v)) { out.push({ name: nm, v: v }); return; }
        }
        if (isNum(Number(node.x1)) && isNum(Number(node.y1)) && isNum(Number(node.x2)) && isNum(Number(node.y2))) {
            out.push({ name: nm, v: [node.x1, node.y1, node.x2, node.y2] });
            return;
        }
        for (k in node) {
            if (!node.hasOwnProperty(k)) continue;
            var hint = null;
            if (isNum4(node[k])) hint = k; // format { "nom": [x1, y1, x2, y2] }
            extractCurves(node[k], out, hint, depth + 1);
        }
    }

    // Lit un texte (JSON Flow, ou texte avec des cubic-bezier) et renvoie [{name, v}]
    function curvesFromText(text) {
        var out = [];
        try {
            extractCurves(parseJSONSafe(text), out, null, 0);
        } catch (e) {
            out = [];
        }
        if (out.length) return out;
        // Conversion de secours : on cherche les cubic-bezier(...) ou [a, b, c, d] dans le texte
        var re = /(?:cubic-bezier\s*\(|\[)\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*[\)\]]/gi;
        var m;
        while ((m = re.exec(text)) !== null) out.push({ name: null, v: [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] });
        return out;
    }

    function fileBaseName(f) {
        return decodeURI(f.name).replace(/\.[^.]+$/, "");
    }

    // Ajoute les courbes trouvées dans la bibliothèque « Flow · <nom> » (sans doublons)
    function importCurvesInto(found, libName) {
        var added = 0;
        for (var i = 0; i < found.length; i++) {
            var v = found[i].v;
            var bez = [clampNum(Number(v[0]), 0, 1), clampNum(Number(v[1]), -3, 4), clampNum(Number(v[2]), 0, 1), clampNum(Number(v[3]), -3, 4)];
            var name = found[i].name ? String(found[i].name) : ("Courbe " + (i + 1));
            var dup = false;
            for (var j = 0; j < curveLib.length; j++) {
                var c = curveLib[j];
                if (c.lib === libName && c.name === name && c.keys === 2 &&
                    Math.abs(c.segs[0][0] - bez[0]) < 0.0005 && Math.abs(c.segs[0][1] - bez[1]) < 0.0005 &&
                    Math.abs(c.segs[0][2] - bez[2]) < 0.0005 && Math.abs(c.segs[0][3] - bez[3]) < 0.0005) { dup = true; break; }
            }
            if (dup) continue;
            curveLib.push(sanitizeCurve({ name: name, lib: libName, keys: 2, segs: [bez] }));
            added++;
        }
        return added;
    }

    function importFlowFile(f) {
        var found = curvesFromText(readTextFile(f));
        return { found: found.length, added: importCurvesInto(found, "Flow · " + fileBaseName(f)) };
    }

    function collectFlowFiles(folder, depth, list) {
        if (!folder.exists || depth > 3) return;
        var items = folder.getFiles();
        for (var i = 0; i < items.length; i++) {
            if (items[i] instanceof Folder) collectFlowFiles(items[i], depth + 1, list);
            else if (/\.(flow|json|txt)$/i.test(items[i].name)) list.push(items[i]);
        }
    }

    function importFlowFolder(folder) {
        var files = [];
        collectFlowFiles(folder, 0, files);
        var res = { files: 0, found: 0, added: 0 };
        for (var i = 0; i < files.length; i++) {
            var r = importFlowFile(files[i]);
            if (r.found) res.files++;
            res.found += r.found;
            res.added += r.added;
        }
        return res;
    }

    function flowLibraryFolder() {
        return new Folder(Folder.userData.fsName + "/aescripts/flow/libraries");
    }

    // ---------- Application sur les keyframes ----------

    // Courbe à utiliser pour la transition n° i (entre la clé i et la clé i+1)
    function bezForSegment(curve, mode, i) {
        var n = curve.segs.length; // 1 ou 2
        var reversed = false;
        var local = i % n;
        if (mode === "reverse") reversed = true;
        if (mode === "alternate") reversed = (Math.floor(i / n) % 2) === 1;
        if (!reversed) return curve.segs[local];
        // reverse : on parcourt la courbe à l'envers (ordre des transitions inversé + miroir)
        return mirrorBez(curve.segs[n - 1 - local]);
    }

    function midTimeFor(curve, mode, group) {
        var t = curve.mid[0];
        var reversed = false;
        if (mode === "reverse") reversed = true;
        if (mode === "alternate") reversed = (group % 2) === 1;
        if (reversed) t = 1 - t;
        return t;
    }

    function valueDelta(a, b) {
        if (a instanceof Array) {
            var d = [];
            for (var i = 0; i < a.length; i++) d.push(b[i] - a[i]);
            return d;
        }
        return [b - a];
    }

    function vecLength(d) {
        var s = 0;
        for (var i = 0; i < d.length; i++) s += d[i] * d[i];
        return Math.sqrt(s);
    }

    // Convertit une transition cubic-bezier en easing After Effects entre les clés k1 et k2
    function applyBezToSegment(p, k1, k2, bez) {
        var t1 = p.keyTime(k1), t2 = p.keyTime(k2);
        var dt = t2 - t1;
        if (dt <= 0) return false;

        var x1 = clampNum(bez[0], 0.001, 1), y1 = bez[1];
        var x2 = clampNum(bez[2], 0, 0.999), y2 = bez[3];
        var inflOut = clampNum(x1 * 100, 0.1, 100);
        var inflIn = clampNum((1 - x2) * 100, 0.1, 100);
        var slopeOut = y1 / x1;
        var slopeIn = (1 - y2) / (1 - x2);

        var d = valueDelta(p.keyValue(k1), p.keyValue(k2));
        var outArr = [], inArr = [];
        var nDims = p.keyOutTemporalEase(k1).length;

        if (p.isSpatial) {
            var dist = vecLength(d);
            outArr.push(new KeyframeEase(Math.max(0, slopeOut * dist / dt), inflOut));
            inArr.push(new KeyframeEase(Math.max(0, slopeIn * dist / dt), inflIn));
        } else {
            for (var i = 0; i < nDims; i++) {
                var di = (i < d.length) ? d[i] : 0;
                outArr.push(new KeyframeEase(slopeOut * di / dt, inflOut));
                inArr.push(new KeyframeEase(slopeIn * di / dt, inflIn));
            }
        }

        var BEZ = KeyframeInterpolationType.BEZIER;
        p.setInterpolationTypeAtKey(k1, p.keyInInterpolationType(k1), BEZ);
        p.setInterpolationTypeAtKey(k2, BEZ, p.keyOutInterpolationType(k2));
        try { p.setTemporalContinuousAtKey(k1, false); p.setTemporalAutoBezierAtKey(k1, false); } catch (e) {}
        try { p.setTemporalContinuousAtKey(k2, false); p.setTemporalAutoBezierAtKey(k2, false); } catch (e2) {}

        p.setTemporalEaseAtKey(k1, p.keyInTemporalEase(k1), outArr);
        p.setTemporalEaseAtKey(k2, inArr, p.keyOutTemporalEase(k2));
        return true;
    }

    // Déplace la clé du milieu d'un groupe de 3 clés au bon moment
    function moveMiddleKey(p, kA, kB, kC, tFrac) {
        var tA = p.keyTime(kA), tC = p.keyTime(kC);
        var newT = tA + tFrac * (tC - tA);
        var fd = 1 / 1000;
        try { fd = p.propertyGroup(p.propertyDepth).containingComp.frameDuration; } catch (e) {}
        if (newT <= tA + fd || newT >= tC - fd) return;
        if (Math.abs(newT - p.keyTime(kB)) < fd / 2) return;
        var data = readKey(p, kB);
        p.removeKey(kB);
        writeKey(p, data, newT, 1);
    }

    function isEasable(p) {
        try {
            var t = p.propertyValueType;
            if (t === PropertyValueType.NO_VALUE || t === PropertyValueType.MARKER ||
                t === PropertyValueType.TEXT_DOCUMENT || t === PropertyValueType.SHAPE ||
                t === PropertyValueType.CUSTOM_VALUE || t === PropertyValueType.LAYER_INDEX ||
                t === PropertyValueType.MASK_INDEX) return false;
            return true;
        } catch (e) {
            return false;
        }
    }

    // Applique la courbe à toutes les keyframes sélectionnées de la composition
    function applyCurveToSelection(comp, curve, mode, placeMid) {
        var props = comp.selectedProperties;
        var res = { props: 0, segs: 0, skipped: 0 };
        for (var i = 0; i < props.length; i++) {
            var p = props[i];
            if (p.propertyType !== PropertyType.PROPERTY) continue;
            var sel = p.selectedKeys;
            if (!sel || sel.length < 2) continue;
            if (!isEasable(p)) { res.skipped++; continue; }
            var keys = [];
            for (var j = 0; j < sel.length; j++) keys.push(sel[j]);
            keys.sort(function (a, b) { return a - b; });

            if (curve.keys === 3 && placeMid) {
                for (var g = 0; g + 2 < keys.length; g += 2) {
                    moveMiddleKey(p, keys[g], keys[g + 1], keys[g + 2], midTimeFor(curve, mode, g / 2));
                }
            }
            for (var s = 0; s + 1 < keys.length; s++) {
                if (applyBezToSegment(p, keys[s], keys[s + 1], bezForSegment(curve, mode, s))) res.segs++;
            }
            res.props++;
        }
        return res;
    }

    // ---------- Éditeur visuel ----------

    var GRAPH = { w: 280, h: 150, pad: 12, ymin: -0.25, ymax: 1.25 };

    function gx(x) { return GRAPH.pad + x * (GRAPH.w - 2 * GRAPH.pad); }
    function gy(y) { return GRAPH.h - GRAPH.pad - (y - GRAPH.ymin) / (GRAPH.ymax - GRAPH.ymin) * (GRAPH.h - 2 * GRAPH.pad); }
    function ux(px) { return (px - GRAPH.pad) / (GRAPH.w - 2 * GRAPH.pad); }
    function uy(py) { return GRAPH.ymin + (GRAPH.h - GRAPH.pad - py) / (GRAPH.h - 2 * GRAPH.pad) * (GRAPH.ymax - GRAPH.ymin); }

    // Points clés de la courbe en coordonnées graphe [x, y]
    function curveAnchors(c) {
        if (c.keys === 3) return [[0, 0], [c.mid[0], c.mid[1]], [1, c.end]];
        return [[0, 0], [1, 1]];
    }

    // Poignées absolues de la transition s
    function segHandles(c, s) {
        var a = curveAnchors(c);
        var A = a[s], B = a[s + 1], b = c.segs[s];
        return [
            [A[0] + b[0] * (B[0] - A[0]), A[1] + b[1] * (B[1] - A[1])],
            [A[0] + b[2] * (B[0] - A[0]), A[1] + b[3] * (B[1] - A[1])]
        ];
    }

    function cubicPt(p0, p1, p2, p3, t) {
        var u = 1 - t;
        var a = u * u * u, b = 3 * u * u * t, cc = 3 * u * t * t, d = t * t * t;
        return [a * p0[0] + b * p1[0] + cc * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + cc * p2[1] + d * p3[1]];
    }

    function drawCurvePath(g, c, pen, transform) {
        var a = curveAnchors(c);
        for (var s = 0; s < c.segs.length; s++) {
            var h = segHandles(c, s);
            g.newPath();
            for (var i = 0; i <= 28; i++) {
                var pt = cubicPt(a[s], h[0], h[1], a[s + 1], i / 28);
                if (transform) pt = transform(pt);
                if (i === 0) g.moveTo(gx(pt[0]), gy(pt[1]));
                else g.lineTo(gx(pt[0]), gy(pt[1]));
            }
            g.strokePath(pen);
        }
    }

    function drawSquare(g, x, y, r, v) {
        g.newPath();
        g.rectPath(Math.round(x - r), Math.round(y - r), 2 * r, 2 * r);
        g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, grey(v)));
    }

    function drawEditor(btn, st) {
        var g = btn.graphics;
        var c = st.curve;
        var W = GRAPH.w, H = GRAPH.h;

        g.newPath(); g.rectPath(0, 0, W, H);
        g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, grey(0.05)));
        g.newPath(); g.rectPath(0.5, 0.5, W - 1, H - 1);
        g.strokePath(g.newPen(g.PenType.SOLID_COLOR, grey(0.2), 1));

        // grille
        var faint = g.newPen(g.PenType.SOLID_COLOR, grey(0.12), 1);
        var mid = g.newPen(g.PenType.SOLID_COLOR, grey(0.22), 1);
        for (var q = 0; q <= 4; q++) {
            g.newPath(); g.moveTo(gx(q / 4), gy(GRAPH.ymin)); g.lineTo(gx(q / 4), gy(GRAPH.ymax)); g.strokePath(faint);
        }
        g.newPath(); g.moveTo(gx(0), gy(0)); g.lineTo(gx(1), gy(0)); g.strokePath(mid);
        g.newPath(); g.moveTo(gx(0), gy(1)); g.lineTo(gx(1), gy(1)); g.strokePath(mid);

        // aperçu du reverse (fantôme gris)
        if (st.mode === "reverse" || st.mode === "alternate") {
            var ghost = g.newPen(g.PenType.SOLID_COLOR, grey(0.32), 1);
            if (c.keys === 3) drawCurvePath(g, c, ghost, function (p) { return [1 - p[0], p[1]]; });
            else drawCurvePath(g, c, ghost, function (p) { return [1 - p[0], 1 - p[1]]; });
        }

        // poignées
        var a = curveAnchors(c);
        var hp = g.newPen(g.PenType.SOLID_COLOR, grey(0.45), 1);
        for (var s = 0; s < c.segs.length; s++) {
            var h = segHandles(c, s);
            g.newPath(); g.moveTo(gx(a[s][0]), gy(a[s][1])); g.lineTo(gx(h[0][0]), gy(h[0][1])); g.strokePath(hp);
            g.newPath(); g.moveTo(gx(a[s + 1][0]), gy(a[s + 1][1])); g.lineTo(gx(h[1][0]), gy(h[1][1])); g.strokePath(hp);
        }

        // courbe
        drawCurvePath(g, c, g.newPen(g.PenType.SOLID_COLOR, grey(0.95), 2), null);

        // points
        for (var s2 = 0; s2 < c.segs.length; s2++) {
            var h2 = segHandles(c, s2);
            drawSquare(g, gx(h2[0][0]), gy(h2[0][1]), 3, 0.8);
            drawSquare(g, gx(h2[1][0]), gy(h2[1][1]), 3, 0.8);
        }
        for (var k = 0; k < a.length; k++) {
            var movable = (c.keys === 3 && k > 0);
            drawSquare(g, gx(a[k][0]), gy(a[k][1]), movable ? 5 : 4, movable ? 1 : 0.6);
        }
    }

    // Liste des éléments déplaçables : { kind: "h1"|"h2"|"mid"|"end", seg, x, y }
    function editorTargets(c) {
        var t = [];
        for (var s = 0; s < c.segs.length; s++) {
            var h = segHandles(c, s);
            t.push({ kind: "h1", seg: s, x: gx(h[0][0]), y: gy(h[0][1]) });
            t.push({ kind: "h2", seg: s, x: gx(h[1][0]), y: gy(h[1][1]) });
        }
        if (c.keys === 3) {
            t.push({ kind: "mid", seg: 0, x: gx(c.mid[0]), y: gy(c.mid[1]) });
            t.push({ kind: "end", seg: 1, x: gx(1), y: gy(c.end) });
        }
        return t;
    }

    function dragTo(c, target, px, py) {
        var X = ux(px), Y = clampNum(uy(py), GRAPH.ymin - 0.5, GRAPH.ymax + 0.5);
        if (target.kind === "mid") {
            c.mid[0] = clampNum(X, 0.05, 0.95);
            c.mid[1] = clampNum(Y, -1, 2);
            fixThreeKeyValues(c);
            return;
        }
        if (target.kind === "end") {
            c.end = clampNum(Y, -1, 2);
            fixThreeKeyValues(c);
            return;
        }
        var a = curveAnchors(c);
        var A = a[target.seg], B = a[target.seg + 1];
        var nx = clampNum((X - A[0]) / (B[0] - A[0]), 0, 1);
        var dy = B[1] - A[1];
        var ny = (Math.abs(dy) > 0.0001) ? (Y - A[1]) / dy : 0;
        ny = clampNum(ny, -3, 4);
        var b = c.segs[target.seg];
        if (target.kind === "h1") { b[0] = round4(nx); b[1] = round4(ny); }
        else { b[2] = round4(nx); b[3] = round4(ny); }
    }

    function bezToText(b) {
        return [round4(b[0]), round4(b[1]), round4(b[2]), round4(b[3])].join(", ");
    }

    // ---------- Vignettes de la bibliothèque ----------
    var THUMB = { w: 52, h: 50, cols: 5, rows: 2, nameH: 12 };

    function fitName(g, name, font, maxW) {
        var m = font ? g.measureString(name, font) : g.measureString(name);
        if (m[0] <= maxW) return name;
        var t = name;
        while (t.length > 1) {
            t = t.substring(0, t.length - 1);
            var m2 = font ? g.measureString(t + "..", font) : g.measureString(t + "..");
            if (m2[0] <= maxW) return t + "..";
        }
        return t;
    }

    // Dessine une vignette : fond, mini-courbe avec ses poignées, nom en dessous
    function drawThumb(el, c, selected) {
        var g = el.graphics;
        var W = THUMB.w, H = THUMB.h;
        var bgV = 0.12, borderV = 0.2, inkV = 0.9, handleV = 0.4, nameV = 0.55;
        if (selected) { bgV = 0.88; borderV = 0.88; inkV = 0.08; handleV = 0.5; nameV = 0.1; }
        g.newPath(); g.rectPath(0, 0, W, H);
        g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, grey(c ? bgV : THEME.bg)));
        if (!c) return;
        g.newPath(); g.rectPath(0.5, 0.5, W - 1, H - 1);
        g.strokePath(g.newPen(g.PenType.SOLID_COLOR, grey(borderV), 1));

        var bx = 7, by = 4, bw = W - 14, bh = H - THUMB.nameH - 8;
        var y0 = -0.25, y1 = 1.25;
        function tx(x) { return bx + x * bw; }
        function ty(y) { return by + bh - (y - y0) / (y1 - y0) * bh; }

        var a = curveAnchors(c);
        var hp = g.newPen(g.PenType.SOLID_COLOR, grey(handleV), 1);
        var s, h;
        for (s = 0; s < c.segs.length; s++) {
            h = segHandles(c, s);
            g.newPath(); g.moveTo(tx(a[s][0]), ty(a[s][1])); g.lineTo(tx(h[0][0]), ty(h[0][1])); g.strokePath(hp);
            g.newPath(); g.moveTo(tx(a[s + 1][0]), ty(a[s + 1][1])); g.lineTo(tx(h[1][0]), ty(h[1][1])); g.strokePath(hp);
        }
        var pen = g.newPen(g.PenType.SOLID_COLOR, grey(inkV), 1.5);
        for (s = 0; s < c.segs.length; s++) {
            h = segHandles(c, s);
            g.newPath();
            for (var i = 0; i <= 20; i++) {
                var pt = cubicPt(a[s], h[0], h[1], a[s + 1], i / 20);
                if (i === 0) g.moveTo(tx(pt[0]), ty(pt[1]));
                else g.lineTo(tx(pt[0]), ty(pt[1]));
            }
            g.strokePath(pen);
        }
        for (s = 0; s < c.segs.length; s++) {
            h = segHandles(c, s);
            drawSquare(g, tx(h[0][0]), ty(h[0][1]), 1, handleV + 0.2);
            drawSquare(g, tx(h[1][0]), ty(h[1][1]), 1, handleV + 0.2);
        }

        var font = safeFont(selected ? "BOLD" : "REGULAR", 9);
        var label = fitName(g, c.name || "", font, W - 4);
        var m = font ? g.measureString(label, font) : g.measureString(label);
        var ink = g.newPen(g.PenType.SOLID_COLOR, grey(nameV), 1);
        var lx = Math.round((W - m[0]) / 2), ly = H - THUMB.nameH - 2;
        if (font) g.drawString(label, ink, lx, ly, font);
        else g.drawString(label, ink, lx, ly);
    }

    // Force un groupe dessiné à se redessiner (alterne deux fonds presque identiques)
    var flipState = [];
    function flipRepaint(el, idx) {
        try {
            flipState[idx] = !flipState[idx];
            var v = THEME.bg;
            if (flipState[idx]) v = THEME.bg + 0.001;
            el.graphics.backgroundColor = el.graphics.newBrush(el.graphics.BrushType.SOLID_COLOR, grey(v));
        } catch (e) { repaint(el); }
    }

    // ---------- Boutons à bascule (onglets, 2/3 clés, modes) ----------

    // Dessine un bouton actif (blanc) ou inactif (noir) selon isActive()
    function makeToggleDraw(isActive) {
        return function () { drawToggle(this, isActive()); };
    }

    function drawToggle(btn, active) {
        var g = btn.graphics;
        var w = btn.size[0], h = btn.size[1];
        var fillV = THEME.btn, borderV = THEME.border, inkV = THEME.label;
        if (active) { fillV = 0.9; borderV = 0.9; inkV = 0.06; }
        g.newPath(); g.rectPath(0, 0, w, h);
        g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, grey(fillV)));
        g.newPath(); g.rectPath(0.5, 0.5, w - 1, h - 1);
        g.strokePath(g.newPen(g.PenType.SOLID_COLOR, grey(borderV), 1));
        var ink = g.newPen(g.PenType.SOLID_COLOR, grey(inkV), 1);
        var font = safeFont(active ? "BOLD" : "REGULAR", 11);
        var label = btn.text;
        var m = font ? g.measureString(label, font) : g.measureString(label);
        var x = Math.round((w - m[0]) / 2), y = Math.round((h - m[1]) / 2);
        if (font) g.drawString(label, ink, x, y, font);
        else g.drawString(label, ink, x, y);
    }

    function addToggle(parent, label, isActive, w, h) {
        var b = parent.add("button", undefined, label);
        b.preferredSize = [w, h || 24];
        try { b.onDraw = makeToggleDraw(isActive); } catch (e) {}
        return b;
    }

    // Force un élément à se redessiner
    function repaint(el) {
        try { el.hide(); el.show(); } catch (e) {}
    }

    // =====================================================================
    // Page « Courbe »
    // =====================================================================

    function buildCurvePage(page, setStatus) {
        loadCurveLib();

        var st = {
            curve: defaultCurve(),  // courbe en cours d'édition (copie)
            mode: "normal",         // normal | reverse | alternate
            page: 0,                // page de vignettes affichée
            drag: null
        };

        // ---------- Bibliothèque : vignettes + actions ----------
        var gName = page.add("group");
        gName.orientation = "row";
        gName.alignChildren = ["left", "center"];
        gName.spacing = 4;
        var btnPrev = themeButton(gName.add("button", undefined, "<"));
        btnPrev.preferredSize = [26, 22];
        btnPrev.helpTip = "Page précédente";
        var tPage = gName.add("statictext", undefined, "1 / 1");
        tPage.preferredSize.width = 44;
        tPage.justify = "center";
        paintText(tPage, THEME.label);
        var btnNext = themeButton(gName.add("button", undefined, ">"));
        btnNext.preferredSize = [26, 22];
        btnNext.helpTip = "Page suivante";
        var gSpacer = gName.add("group");
        gSpacer.alignment = ["fill", "center"];
        gSpacer.preferredSize.width = 60;
        var tKeys = gName.add("statictext", undefined, "Clés");
        tKeys.alignment = ["right", "center"];
        paintText(tKeys, THEME.label);
        var btnK2 = addToggle(gName, "2", function () { return st.curve.keys === 2; }, 26);
        btnK2.alignment = ["right", "center"];
        var btnK3 = addToggle(gName, "3", function () { return st.curve.keys === 3; }, 26);
        btnK3.alignment = ["right", "center"];

        // Grille de vignettes (des groupes dessinés, cliquables)
        var gGrid = page.add("group");
        gGrid.orientation = "column";
        gGrid.alignChildren = ["left", "top"];
        gGrid.alignment = ["left", "top"];
        gGrid.spacing = 4;
        var cells = [];
        var cellIds = [];
        for (var gr = 0; gr < THUMB.rows; gr++) {
            var gRow = gGrid.add("group");
            gRow.orientation = "row";
            gRow.spacing = 4;
            for (var gc = 0; gc < THUMB.cols; gc++) {
                var cell = gRow.add("group");
                cell.preferredSize = [THUMB.w, THUMB.h];
                cell.minimumSize = [THUMB.w, THUMB.h];
                (function (k) {
                    try {
                        cell.onDraw = function () {
                            var idx = cellIds[k] ? findCurveIndex(cellIds[k]) : -1;
                            var c = null;
                            if (idx >= 0) c = curveLib[idx];
                            drawThumb(this, c, !!(c && st.curve.id === c.id));
                        };
                    } catch (e) {}
                    cell.addEventListener("mousedown", function () { pickCell(k); });
                })(cells.length);
                cells.push(cell);
                cellIds.push(null);
            }
        }

        var gLib = page.add("group");
        gLib.orientation = "row";
        gLib.spacing = 4;
        var btnNew = themeButton(gLib.add("button", undefined, "Nouvelle"));
        btnNew.preferredSize = [70, 24];
        btnNew.helpTip = "Repartir d'une courbe vierge";
        var btnDel = themeButton(gLib.add("button", undefined, "Supprimer"));
        btnDel.preferredSize = [76, 24];
        btnDel.helpTip = "Supprimer la courbe choisie de la bibliothèque";
        var btnImpFile = themeButton(gLib.add("button", undefined, "Import flow curves"));
        btnImpFile.preferredSize = [126, 24];
        btnImpFile.helpTip = "Importe tes courbes Flow depuis un fichier .flow ou .json";

        // ---------- Éditeur ----------
        // Zone de dessin (un groupe, pas un bouton : un bouton garde la souris pendant l'appui
        // et l'éditeur ne voyait plus le glisser ni le relâchement)
        var canvas = page.add("group");
        canvas.preferredSize = [GRAPH.w, GRAPH.h];
        canvas.minimumSize = [GRAPH.w, GRAPH.h];
        canvas.alignment = ["left", "top"];
        canvas.helpTip = "Fais glisser les poignées (petits carrés) et, en mode 3 clés, les clés blanches";
        try { canvas.onDraw = function () { drawEditor(this, st); }; } catch (e) {}

        var gSeg1 = page.add("group");
        gSeg1.orientation = "row";
        gSeg1.alignChildren = ["left", "center"];
        gSeg1.spacing = 4;
        var tSeg1 = gSeg1.add("statictext", undefined, "1");
        paintText(tSeg1, THEME.label);
        var etSeg1 = gSeg1.add("edittext", undefined, "");
        etSeg1.preferredSize.width = 122;
        etSeg1.helpTip = "Transition 1 : x1, y1, x2, y2 (format cubic-bezier, comme Flow)";
        var tSeg2 = gSeg1.add("statictext", undefined, "2");
        paintText(tSeg2, THEME.label);
        var etSeg2 = gSeg1.add("edittext", undefined, "");
        etSeg2.preferredSize.width = 122;
        etSeg2.helpTip = "Transition 2 (courbes à 3 clés) : x1, y1, x2, y2";

        var gEdBtns = page.add("group");
        gEdBtns.orientation = "row";
        gEdBtns.spacing = 4;
        var btnReset = themeButton(gEdBtns.add("button", undefined, "Réinitialiser"));
        btnReset.preferredSize = [136, 24];
        var btnSave = themeButton(gEdBtns.add("button", undefined, "Enregistrer"), "primary");
        btnSave.preferredSize = [136, 24];
        btnSave.helpTip = "Enregistre la courbe dans ta bibliothèque";

        // ---------- Appliquer ----------
        var sApp = addSection(page, "APPLIQUER");
        sApp.spacing = 4;
        var gMode = sApp.add("group");
        gMode.orientation = "row";
        gMode.spacing = 4;
        var btnMNormal = addToggle(gMode, "Normal", function () { return st.mode === "normal"; }, 86);
        btnMNormal.helpTip = "La courbe telle que tu l'as dessinée";
        var btnMReverse = addToggle(gMode, "Reverse", function () { return st.mode === "reverse"; }, 86);
        btnMReverse.helpTip = "La même courbe jouée à l'envers (ease-out devient ease-in)";
        var btnMAlt = addToggle(gMode, "Aller-retour", function () { return st.mode === "alternate"; }, 86);
        btnMAlt.helpTip = "Alterne Normal / Reverse à chaque transition : pratique avec plusieurs reverses";
        var chkMid = sApp.add("checkbox", undefined, "Caler la clé du milieu (3 clés)");
        chkMid.value = false;
        chkMid.helpTip = "Déplace la keyframe du milieu au même endroit que sur la courbe";
        paintText(chkMid, THEME.label);
        var btnApplyCurve = themeButton(sApp.add("button", undefined, "Appliquer aux keyframes sélectionnées"), "primary");
        btnApplyCurve.preferredSize.height = 28;

        // ---------- Logique ----------

        function refreshEditorFields() {
            etSeg1.text = bezToText(st.curve.segs[0]);
            if (st.curve.keys === 3) {
                etSeg2.text = bezToText(st.curve.segs[1]);
                etSeg2.enabled = true;
                tSeg2.enabled = true;
            } else {
                etSeg2.text = "";
                etSeg2.enabled = false;
                tSeg2.enabled = false;
            }
        }

        function refreshAll() {
            refreshEditorFields();
            softRepaint();
            repaint(btnK2); repaint(btnK3);
            repaint(btnMNormal); repaint(btnMReverse); repaint(btnMAlt);
        }

        // Remplit la grille de vignettes (= la bibliothèque)
        function pageCount() {
            var per = THUMB.cols * THUMB.rows;
            return Math.max(1, Math.ceil(curveLib.length / per));
        }

        function repaintCells() {
            for (var i = 0; i < cells.length; i++) flipRepaint(cells[i], i);
        }

        function refreshQuick(selectId) {
            var per = THUMB.cols * THUMB.rows;
            if (selectId) {
                var si = findCurveIndex(selectId);
                if (si >= 0) st.page = Math.floor(si / per);
            }
            var n = pageCount();
            if (st.page > n - 1) st.page = n - 1;
            if (st.page < 0) st.page = 0;
            for (var i = 0; i < cells.length; i++) {
                var li = st.page * per + i;
                cellIds[i] = (li < curveLib.length) ? curveLib[li].id : null;
                var tip = "";
                if (cellIds[i]) {
                    var c = curveLib[li];
                    tip = c.name;
                    if (c.keys === 3) tip += " (3 clés)";
                    if (c.lib !== MY_LIB) tip += " · " + c.lib;
                }
                try { cells[i].helpTip = tip; } catch (e) {}
            }
            tPage.text = (st.page + 1) + " / " + n;
            btnPrev.enabled = st.page > 0;
            btnNext.enabled = st.page < n - 1;
            repaintCells();
        }

        function pickCell(k) {
            var id = cellIds[k];
            if (!id) return;
            loadIntoEditor(id);
            repaintCells();
            setStatus("Courbe « " + st.curve.name + " » chargée.");
        }

        function loadIntoEditor(id) {
            var idx = findCurveIndex(id);
            if (idx < 0) return;
            st.curve = cloneCurve(curveLib[idx]);
            refreshAll();
        }

        function readFields() {
            var b1 = bezFromString(etSeg1.text);
            if (b1) st.curve.segs[0] = [clampNum(b1[0], 0, 1), clampNum(b1[1], -3, 4), clampNum(b1[2], 0, 1), clampNum(b1[3], -3, 4)];
            if (st.curve.keys === 3) {
                var b2 = bezFromString(etSeg2.text);
                if (b2) st.curve.segs[1] = [clampNum(b2[0], 0, 1), clampNum(b2[1], -3, 4), clampNum(b2[2], 0, 1), clampNum(b2[3], -3, 4)];
            }
        }

        function setKeys(n) {
            if (st.curve.keys === n) return;
            if (n === 3) {
                st.curve.keys = 3;
                st.curve.mid = [0.5, 1];
                st.curve.end = 0;
                st.curve.segs = [st.curve.segs[0], mirrorBez(st.curve.segs[0])];
            } else {
                st.curve.keys = 2;
                st.curve.segs = [st.curve.segs[0]];
            }
            refreshAll();
        }

        function setMode(m) {
            st.mode = m;
            refreshAll();
        }

        btnPrev.onClick = function () { st.page--; refreshQuick(null); };
        btnNext.onClick = function () { st.page++; refreshQuick(null); };

        etSeg1.onChange = function () { readFields(); refreshAll(); };
        etSeg2.onChange = function () { readFields(); refreshAll(); };

        btnK2.onClick = function () { setKeys(2); };
        btnK3.onClick = function () { setKeys(3); };
        btnMNormal.onClick = function () { setMode("normal"); };
        btnMReverse.onClick = function () { setMode("reverse"); };
        btnMAlt.onClick = function () { setMode("alternate"); };

        btnNew.onClick = function () {
            st.curve = defaultCurve();
            refreshQuick(null);
            refreshAll();
            setStatus("Nouvelle courbe : dessine-la puis clique sur Enregistrer.");
        };

        btnDel.onClick = function () {
            if (!st.curve.id || findCurveIndex(st.curve.id) < 0) { alert("Clique d'abord sur une vignette de courbe."); return; }
            if (!confirm("Supprimer la courbe « " + st.curve.name + " » ?")) return;
            curveLib.splice(findCurveIndex(st.curve.id), 1);
            saveCurveLib();
            st.curve = defaultCurve();
            refreshQuick(null);
            refreshAll();
            setStatus("Courbe supprimée.");
        };

        btnReset.onClick = function () {
            var keep = st.curve;
            st.curve = defaultCurve();
            st.curve.id = keep.id;
            st.curve.name = keep.name;
            st.curve.lib = keep.lib;
            if (keep.keys === 3) {
                st.curve.keys = 3;
                st.curve.segs = [[0.33, 0, 0.2, 1], [0.8, 0, 0.67, 1]];
            }
            refreshAll();
        };

        btnSave.onClick = function () {
            readFields();
            var nm = prompt("Nom de la courbe :", st.curve.name || "", "Enregistrer la courbe");
            if (nm === null) return;
            nm = trim(nm);
            if (!nm) { alert("Donne un nom à ta courbe."); return; }
            st.curve.name = nm;
            var idx = st.curve.id ? findCurveIndex(st.curve.id) : -1;
            var saved = cloneCurve(st.curve);
            if (idx >= 0) {
                curveLib[idx] = saved;
            } else {
                saved.id = newCurveId();
                if (!saved.lib) saved.lib = MY_LIB;
                curveLib.push(saved);
                st.curve.id = saved.id;
            }
            if (!saveCurveLib()) {
                alert("Impossible d'enregistrer la bibliothèque.\n\nVérifie l'option :\nPréférences > Scripts et expressions >\n« Autoriser les scripts à écrire des fichiers et à accéder au réseau »");
                return;
            }
            refreshQuick(saved.id);
            setStatus("Courbe « " + saved.name + " » enregistrée.");
        };

        btnApplyCurve.onClick = function () {
            readFields();
            var comp = getActiveComp();
            if (!comp) { alert("Ouvre d'abord une composition."); return; }
            app.beginUndoGroup("Courbe : " + (st.curve.name || "sans nom"));
            try {
                var res = applyCurveToSelection(comp, st.curve, st.mode, chkMid.value);
                if (!res.segs) {
                    alert("Sélectionne au moins 2 keyframes sur une propriété (dans la timeline).");
                } else {
                    var modeName = "Normal";
                    if (st.mode === "reverse") modeName = "Reverse";
                    if (st.mode === "alternate") modeName = "Aller-retour";
                    setStatus("Courbe appliquée (" + modeName + ") : " + res.segs + " transition(s) sur " + res.props + " propriété(s).");
                }
            } catch (e) {
                alert("Erreur : " + e.message);
            } finally {
                app.endUndoGroup();
            }
        };

        btnImpFile.onClick = function () {
            var filter = isWindows()
                ? "Courbes Flow:*.flow;*.json;*.txt,Tous les fichiers:*.*"
                : function (f) { return (f instanceof Folder) || /\.(flow|json|txt)$/i.test(f.name); };
            var start = flowLibraryFolder();
            var f = null;
            if (start.exists) {
                try { f = new File(start.fsName + "/x.flow").openDlg("Choisis tes courbes Flow (.flow / .json)", filter, false); }
                catch (e) { f = File.openDialog("Choisis tes courbes Flow (.flow / .json)", filter, false); }
            } else {
                f = File.openDialog("Choisis tes courbes Flow (.flow / .json)", filter, false);
            }
            if (!f) return;
            var r = importFlowFile(f);
            if (!r.found) { alert("Aucune courbe trouvée dans ce fichier."); return; }
            saveCurveLib();
            refreshQuick(st.curve.id);
            var msg = r.added + " courbe(s) importée(s)";
            if (r.found > r.added) msg += " (" + (r.found - r.added) + " déjà présente(s))";
            setStatus(msg + " : clique sur une vignette pour la charger.");
        };

        // ---------- Glisser les poignées ----------
        function hit(ev) {
            var targets = editorTargets(st.curve);
            var best = null, bestD = 10;
            for (var i = 0; i < targets.length; i++) {
                var dx = targets[i].x - ev.clientX, dy = targets[i].y - ev.clientY;
                var d = Math.sqrt(dx * dx + dy * dy);
                if (d < bestD) { bestD = d; best = targets[i]; }
            }
            return best;
        }

        // Redessine l'éditeur sans le masquer : on alterne entre deux fonds presque identiques,
        // ce qui force After Effects à appeler onDraw
        var bgFlip = false;
        function softRepaint() {
            try {
                bgFlip = !bgFlip;
                var v = 0.05;
                if (bgFlip) v = 0.051;
                canvas.graphics.backgroundColor = canvas.graphics.newBrush(canvas.graphics.BrushType.SOLID_COLOR, grey(v));
            } catch (e) {
                repaint(canvas);
            }
        }

        function endDrag() {
            if (!st.drag) return;
            st.drag = null;
            refreshEditorFields();
            softRepaint();
        }

        try {
            canvas.addEventListener("mousedown", function (ev) {
                if (st.drag) { endDrag(); return; } // sécurité : un clic lâche toujours la poignée
                st.drag = hit(ev);
            });
            canvas.addEventListener("mousemove", function (ev) {
                if (!st.drag) return;
                dragTo(st.curve, st.drag, ev.clientX, ev.clientY);
                refreshEditorFields();
                softRepaint();
            });
            canvas.addEventListener("mouseup", function (ev) {
                if (!st.drag) return;
                dragTo(st.curve, st.drag, ev.clientX, ev.clientY);
                endDrag();
            });
            canvas.addEventListener("mouseout", function () { endDrag(); });
        } catch (e) {}

        refreshQuick(null);
        refreshEditorFields();
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

        // ---------- Onglets : OUTILS / COURBE ----------
        var ui = { page: "tools" };
        var gTabs = win.add("group");
        gTabs.orientation = "row";
        gTabs.alignChildren = ["fill", "center"];
        gTabs.spacing = 4;
        var tabTools = addToggle(gTabs, "OUTILS", function () { return ui.page === "tools"; }, 90, 26);
        var tabIntro = addToggle(gTabs, "INTRO", function () { return ui.page === "intro"; }, 90, 26);
        var tabCurve = addToggle(gTabs, "COURBE", function () { return ui.page === "curve"; }, 90, 26);

        var status = win.add("statictext", undefined, "", { truncate: "end" });
        status.alignment = ["fill", "top"];
        paintText(status, THEME.label);

        var pages = win.add("group");
        pages.orientation = "stack";
        pages.alignChildren = ["fill", "top"];
        var pageTools = pages.add("group");
        pageTools.orientation = "column";
        pageTools.alignChildren = ["fill", "top"];
        pageTools.spacing = 10;
        var pageIntro = pages.add("group");
        pageIntro.orientation = "column";
        pageIntro.alignChildren = ["fill", "top"];
        pageIntro.spacing = 10;
        pageIntro.visible = false;
        var pageCurve = pages.add("group");
        pageCurve.orientation = "column";
        pageCurve.alignChildren = ["fill", "top"];
        pageCurve.spacing = 6;
        pageCurve.visible = false;

        // ---------- Alignement ----------
        var sAli = addSection(pageTools, "ALIGNEMENT");
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

        var gComp = sAli.add("group");
        gComp.orientation = "row";
        gComp.alignChildren = ["fill", "center"];
        gComp.spacing = 4;
        var btnPrecomp = themeButton(gComp.add("button", undefined, "Precomp"));
        btnPrecomp.preferredSize = [112, 26];
        btnPrecomp.helpTip = "Pré-compose les calques sélectionnés (même durée qu'eux)";
        var btnUncomp = themeButton(gComp.add("button", undefined, "Déprecomp"));
        btnUncomp.preferredSize = [112, 26];
        btnUncomp.helpTip = "Ressort le contenu du precomp sélectionné dans la composition";

        // ---------- Lyrics ----------
        var pLyr = addSection(pageIntro, "LYRICS");
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
        var etSize = gOpt.add("edittext", undefined, "150");
        etSize.characters = 4;
        var chkLyrPreset = gOpt.add("checkbox", undefined, "Avec le preset");
        chkLyrPreset.value = false;
        chkLyrPreset.helpTip = "Applique le preset choisi dans la section Presets aux textes créés";
        paintText(chkLyrPreset, THEME.label);

        var btnLyrics = themeButton(pLyr.add("button", undefined, "Créer les paroles"), "primary");
        btnLyrics.preferredSize.height = 28;

        // ---------- Presets ----------
        var pPre = addSection(pageIntro, "PRESETS  .FFX");
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

        // ---------- Page Courbe ----------
        function setStatus(t) { status.text = t; }
        try {
            buildCurvePage(pageCurve, setStatus);
        } catch (eCurve) {
            pageCurve.add("statictext", undefined, "Erreur page Courbe : " + eCurve.message + " (ligne " + eCurve.line + ")");
        }

        function relayoutAll() {
            try {
                var w = win.window ? win.window : win;
                w.layout.layout(true);
                w.layout.resize();
            } catch (e) {}
        }

        function showPage(p) {
            ui.page = p;
            pageTools.visible = (p === "tools");
            pageIntro.visible = (p === "intro");
            pageCurve.visible = (p === "curve");
            repaint(tabTools);
            repaint(tabIntro);
            repaint(tabCurve);
            relayoutAll();
        }
        tabTools.onClick = function () { showPage("tools"); };
        tabIntro.onClick = function () { showPage("intro"); };
        tabCurve.onClick = function () { showPage("curve"); };

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

        btnPrecomp.onClick = function () {
            var comp = getActiveComp();
            if (!comp) { alert("Ouvre d'abord une composition."); return; }
            if (!comp.selectedLayers.length) { alert("Sélectionne d'abord un ou plusieurs calques."); return; }
            app.beginUndoGroup("Precomp");
            try {
                var nc = precomposeSelected(comp);
                if (nc) status.text = "Precomp « " + nc.name + " » créé.";
            } catch (e) {
                alert("Erreur : " + e.message);
            } finally {
                app.endUndoGroup();
            }
        };

        btnUncomp.onClick = function () {
            var comp = getActiveComp();
            if (!comp) { alert("Ouvre d'abord une composition."); return; }
            var sel = comp.selectedLayers;
            var targets = [];
            for (var i = 0; i < sel.length; i++) {
                if (sel[i].source && sel[i].source instanceof CompItem) targets.push(sel[i]);
            }
            if (!targets.length) { alert("Sélectionne un calque precomp dans la timeline."); return; }
            var extras = false;
            for (var j = 0; j < targets.length; j++) if (hasLayerExtras(targets[j])) extras = true;
            if (extras && !confirm("Les effets, animations ou le time remap posés sur le precomp lui-même seront perdus. Continuer ?")) return;
            app.beginUndoGroup("Déprecomp");
            try {
                var total = 0;
                for (var k = 0; k < targets.length; k++) total += uncompose(comp, targets[k]);
                status.text = "Déprecomp : " + total + " calque(s) remis dans la composition.";
            } catch (e) {
                alert("Erreur : " + e.message);
            } finally {
                app.endUndoGroup();
            }
        };

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
            if (isNaN(size) || size <= 0) size = 150;
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
