// AURASCRIPT-APP  (ne pas supprimer : permet au lanceur de reconnaître ce fichier)
// version: 1.2.0
// nouveautes: Nouvelle grille d'alignement (9 carrés) : place les calques sélectionnés au centre, sur un côté ou dans un coin
// nouveautes: Marge réglable pour l'alignement sur les bords
// nouveautes: Le calque d'effet se place toujours juste au-dessus du calque sélectionné
// nouveautes: Les paroles sont toujours centrées au milieu de l'image
// nouveautes: Presets de texte : « + Preset » ajoute directement tes fichiers .ffx
// nouveautes: Le preset s'applique sur toute la durée du texte sélectionné (animation étirée du début à la fin)
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

    function createAdjustmentFor(comp, srcLayer) {
        var inP = srcLayer.inPoint;
        var outP = srcLayer.outPoint;
        var duration = outP - inP;
        if (duration <= 0) throw new Error("Le calque « " + srcLayer.name + " » a une durée nulle.");

        var adj = comp.layers.addSolid([1, 1, 1], "Effets - " + srcLayer.name,
            comp.width, comp.height, comp.pixelAspect, duration);
        adj.adjustmentLayer = true;
        adj.label = 5;
        adj.startTime = inP;
        adj.inPoint = inP;
        adj.outPoint = outP;
        adj.moveBefore(srcLayer);
        return adj;
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

    // Rectangle du calque dans la composition (hors rotation et parentage)
    function layerRect(layer, t) {
        var r;
        if (layer instanceof TextLayer || layer instanceof ShapeLayer) {
            r = layer.sourceRectAtTime(t, false);
        } else if (layer.source && layer.source.width) {
            r = { left: 0, top: 0, width: layer.source.width, height: layer.source.height };
        } else {
            return null; // caméra, lumière…
        }
        var tr = layer.property("ADBE Transform Group");
        var a = tr.property("ADBE Anchor Point").valueAtTime(t, false);
        var s = tr.property("ADBE Scale").valueAtTime(t, false);
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
    function alignLayers(comp, h, v, margin) {
        var sel = comp.selectedLayers;
        var t = comp.time;
        var moved = 0, skipped = 0;
        for (var i = 0; i < sel.length; i++) {
            var layer = sel[i];
            if (layer.parent) { skipped++; continue; }
            var r = layerRect(layer, t);
            if (!r) { skipped++; continue; }
            var tx = (h === 0) ? margin : (h === 1) ? (comp.width - r.width) / 2 : comp.width - margin - r.width;
            var ty = (v === 0) ? margin : (v === 1) ? (comp.height - r.height) / 2 : comp.height - margin - r.height;
            moveLayerBy(layer, tx - r.left, ty - r.top);
            moved++;
        }
        return { moved: moved, skipped: skipped };
    }

    // Dessine un carré avec un « + » au milieu
    function drawPlusCell() {
        var g = this.graphics;
        var w = this.size[0], h = this.size[1];
        var bg = g.newBrush(g.BrushType.SOLID_COLOR, this.isCenter ? [0.24, 0.24, 0.24, 1] : [0.17, 0.17, 0.17, 1]);
        var border = g.newPen(g.PenType.SOLID_COLOR, [0.55, 0.55, 0.55, 1], 1);
        var plus = g.newPen(g.PenType.SOLID_COLOR, [0.9, 0.9, 0.9, 1], 2);
        g.newPath();
        g.rectPath(0, 0, w, h);
        g.fillPath(bg);
        g.newPath();
        g.rectPath(0.5, 0.5, w - 1, h - 1);
        g.strokePath(border);
        var cx = Math.round(w / 2), cy = Math.round(h / 2);
        var s = Math.round(Math.min(w, h) * 0.25);
        g.newPath();
        g.moveTo(cx - s, cy);
        g.lineTo(cx + s, cy);
        g.strokePath(plus);
        g.newPath();
        g.moveTo(cx, cy - s);
        g.lineTo(cx, cy + s);
        g.strokePath(plus);
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
        var rawLines = String(rawText).split(/\r\n|\r|\n/);
        var lines = [];
        for (var i = 0; i < rawLines.length; i++) {
            var l = trim(rawLines[i]);
            if (l !== "") lines.push(l);
        }
        if (!lines.length) throw new Error("Colle d'abord les paroles (une ligne = un texte).");

        var mk = getMarkers(comp);
        if (!mk) {
            throw new Error("Aucun marqueur trouvé.\n\nAjoute des marqueurs sur la composition " +
                "(touche * du pavé numérique, aucun calque sélectionné) ou sur ton calque audio " +
                "(sélectionne-le puis touche *), un marqueur au début de chaque ligne.");
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
            msg += "\n" + (lines.length - mk.times.length) + " ligne(s) sans marqueur ignorée(s).";
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
        win.spacing = 8;
        if (!host) win.margins = 10;

        // ---------- Calque d'effet ----------
        var pAdj = win.add("panel", undefined, "Calque d'effet");
        pAdj.alignChildren = ["fill", "top"];
        pAdj.margins = [10, 15, 10, 10];
        var btnAdj = pAdj.add("button", undefined, "Créer sur le(s) calque(s) sélectionné(s)");
        btnAdj.helpTip = "Clique sur une vidéo (ou n'importe quel calque) dans la timeline, puis sur ce bouton";

        // ---------- Alignement ----------
        var pAli = win.add("panel", undefined, "Alignement");
        pAli.orientation = "row";
        pAli.alignChildren = ["left", "center"];
        pAli.margins = [10, 15, 10, 10];
        pAli.spacing = 14;

        var grid = pAli.add("group");
        grid.orientation = "column";
        grid.spacing = 3;
        var alignCells = [];
        for (var gv = 0; gv < 3; gv++) {
            var gRow = grid.add("group");
            gRow.orientation = "row";
            gRow.spacing = 3;
            for (var gh = 0; gh < 3; gh++) {
                var cell = gRow.add("button", undefined, "+");
                cell.preferredSize = [26, 26];
                cell.helpTip = ALIGN_LABELS[gv][gh];
                cell.alignH = gh;
                cell.alignV = gv;
                cell.isCenter = (gh === 1 && gv === 1);
                try { cell.onDraw = drawPlusCell; } catch (e) {}
                alignCells.push(cell);
            }
        }

        var gMargin = pAli.add("group");
        gMargin.orientation = "column";
        gMargin.alignChildren = ["left", "top"];
        var gMarginRow = gMargin.add("group");
        gMarginRow.add("statictext", undefined, "Marge :");
        var etMargin = gMarginRow.add("edittext", undefined, "0");
        etMargin.characters = 4;
        gMarginRow.add("statictext", undefined, "px");
        gMargin.add("statictext", undefined, "Sélectionne des calques,\npuis clique un carré.", { multiline: true });

        // ---------- Paroles ----------
        var pLyr = win.add("panel", undefined, "Paroles");
        pLyr.alignChildren = ["fill", "top"];
        pLyr.margins = [10, 15, 10, 10];
        pLyr.add("statictext", undefined, "Une ligne = un texte, calé sur un marqueur :");
        var etLyrics = pLyr.add("edittext", undefined, "", { multiline: true, scrolling: true, wantReturn: true });
        etLyrics.preferredSize = [260, 120];

        var gOpt = pLyr.add("group");
        gOpt.add("statictext", undefined, "Taille :");
        var etSize = gOpt.add("edittext", undefined, "70");
        etSize.characters = 4;

        var chkLyrPreset = pLyr.add("checkbox", undefined, "Appliquer le preset choisi ci-dessous");
        chkLyrPreset.value = false;

        var btnLyrics = pLyr.add("button", undefined, "Créer les paroles");

        // ---------- Presets ----------
        var pPre = win.add("panel", undefined, "Presets de texte (.ffx)");
        pPre.alignChildren = ["fill", "top"];
        pPre.margins = [10, 15, 10, 10];
        var gPre = pPre.add("group");
        gPre.alignChildren = ["fill", "center"];
        var ddPreset = gPre.add("dropdownlist", undefined, []);
        ddPreset.alignment = ["fill", "center"];
        ddPreset.preferredSize.width = 150;
        var btnAddPreset = gPre.add("button", undefined, "+ Preset");
        btnAddPreset.alignment = ["right", "center"];
        btnAddPreset.helpTip = "Ajouter un ou plusieurs fichiers .ffx à la liste";
        var btnDelPreset = gPre.add("button", undefined, "–");
        btnDelPreset.alignment = ["right", "center"];
        btnDelPreset.preferredSize.width = 28;
        btnDelPreset.helpTip = "Retirer le preset choisi de la liste";
        var btnApply = pPre.add("button", undefined, "Appliquer aux textes sélectionnés");
        btnApply.helpTip = "Le preset démarre au début du texte et son animation est étirée jusqu'à la fin";

        var status = win.add("statictext", undefined, "", { multiline: true });
        status.preferredSize.height = 34;

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

        btnAdj.onClick = function () {
            var comp = getActiveComp();
            if (!comp) { alert("Ouvre d'abord une composition."); return; }
            var sel = comp.selectedLayers;
            var targets = [];
            for (var i = 0; i < sel.length; i++) {
                if (!sel[i].adjustmentLayer) targets.push(sel[i]);
            }
            if (!targets.length) { alert("Clique d'abord sur une vidéo (ou un calque) dans la timeline."); return; }

            app.beginUndoGroup("Calque d'effet");
            var count = 0;
            try {
                for (var j = 0; j < targets.length; j++) {
                    createAdjustmentFor(comp, targets[j]);
                    count++;
                }
            } catch (e) {
                alert("Erreur : " + e.message);
            } finally {
                app.endUndoGroup();
            }
            status.text = count + " calque(s) d'effet créé(s).";
        };

        function onAlignClick() {
            var comp = getActiveComp();
            if (!comp) { alert("Ouvre d'abord une composition."); return; }
            if (!comp.selectedLayers.length) { alert("Sélectionne d'abord un ou plusieurs calques."); return; }
            var margin = parseFloat(etMargin.text);
            if (isNaN(margin)) margin = 0;

            app.beginUndoGroup("Aligner : " + ALIGN_LABELS[this.alignV][this.alignH]);
            try {
                var res = alignLayers(comp, this.alignH, this.alignV, margin);
                status.text = res.moved + " calque(s) placé(s) : " + ALIGN_LABELS[this.alignV][this.alignH] + ".";
                if (res.skipped) status.text += "\n" + res.skipped + " ignoré(s) (parenté, caméra ou lumière).";
            } catch (e) {
                alert("Erreur : " + e.message);
            } finally {
                app.endUndoGroup();
            }
        }
        for (var ac = 0; ac < alignCells.length; ac++) alignCells[ac].onClick = onAlignClick;

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
