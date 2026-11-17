// AuraScript \u2014 logique After Effects appel\u00e9e par le panneau HTML (CEP)
// version: 3.2.1
(function () {
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

    // Met en MAJUSCULES ou en minuscules les calques texte s\u00e9lectionn\u00e9s (keyframes de texte comprises)
    function changeTextCase(comp, upper) {
        var sel = comp.selectedLayers, count = 0;
        function conv(td) {
            td.text = upper ? String(td.text).toUpperCase() : String(td.text).toLowerCase();
            return td;
        }
        for (var i = 0; i < sel.length; i++) {
            if (!(sel[i] instanceof TextLayer)) continue;
            var prop = getTextDocProp(sel[i]);
            if (prop.numKeys > 0) {
                for (var k = 1; k <= prop.numKeys; k++) prop.setValueAtKey(k, conv(prop.keyValue(k)));
            } else {
                prop.setValue(conv(prop.value));
            }
            count++;
        }
        return count;
    }

    function deselectAll(comp) {
        for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
    }

    // =====================================================================
    // Presets .ffx (liste enregistr\u00e9e dans les pr\u00e9f\u00e9rences d'After Effects)
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
        // On ne garde que les presets .ffx (les anciens presets \u00ab style \u00bb sont ignor\u00e9s)
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

    // ---------- \u00c9tirement des images cl\u00e9s du preset sur la dur\u00e9e du calque ----------

    function propPath(prop) {
        var parts = [];
        var p = prop;
        while (p && p.parentProperty) {
            parts.unshift(p.propertyIndex);
            p = p.parentProperty;
        }
        return parts.join("/");
    }

    // Appelle cb(prop) pour chaque propri\u00e9t\u00e9 animable (avec valeur) du calque
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

    // M\u00e9morise les images cl\u00e9s existantes : "chemin|temps"
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

    // \u00c9tire les images cl\u00e9s ajout\u00e9es par le preset pour couvrir [inPoint, outPoint]
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

    // Applique un preset .ffx \u00e0 un calque, cal\u00e9 et \u00e9tir\u00e9 sur la dur\u00e9e du calque
    function applyPresetToLayer(comp, preset, layer) {
        var f = new File(preset.path);
        if (!f.exists) throw new Error("Fichier de preset introuvable :\n" + preset.path);

        var before = snapshotKeys(layer);
        deselectAll(comp);
        layer.selected = true;
        comp.time = layer.inPoint;   // les images cl\u00e9s du preset d\u00e9marrent au d\u00e9but du texte
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

    // Lance une commande du menu Calque > Nouveau d'After Effects (le calque garde son nom par d\u00e9faut)
    // et renvoie le nouveau calque s'il correspond \u00e0 ce qu'on attend
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

    // Nom par d\u00e9faut de secours (si la commande d'After Effects n'est pas disponible)
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
    // Le nouveau calque a la m\u00eame dur\u00e9e que srcLayer et se place juste au-dessus
    function createSpanLayerFor(comp, srcLayer, kind) {
        var inP = srcLayer.inPoint;
        var outP = srcLayer.outPoint;
        if (outP - inP <= 0) throw new Error("Le calque \u00ab " + srcLayer.name + " \u00bb a une dur\u00e9e nulle.");

        deselectAll(comp);
        srcLayer.selected = true;
        var lay = null;

        if (kind === "adjust") {
            lay = newLayerByCommand(comp, ["Adjustment Layer", "Calque d'effets", "Calque d\u2019effets"], 2279, isAdjustment);
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
            r = null; // cam\u00e9ra, lumi\u00e8re : on aligne leur point de position
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

    // D\u00e9cale la position (toute l'animation si la position a des images cl\u00e9s)
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

    // h : 0 gauche, 1 centre, 2 droite \u2014 v : 0 haut, 1 milieu, 2 bas
    // ---------- Point d'ancrage au centre ----------

    // D\u00e9cale une propri\u00e9t\u00e9 (position) de [dx, dy] \u00e0 toutes ses keyframes, ou sur sa valeur fixe
    function shiftPosBy(p, dx, dy, dimIndex) {
        function add(v) {
            if (dimIndex === 0) return v + dx;
            if (dimIndex === 1) return v + dy;
            var o = [v[0] + dx, v[1] + dy];
            if (v.length > 2) o.push(v[2]);
            return o;
        }
        if (p.numKeys > 0) {
            for (var k = 1; k <= p.numKeys; k++) p.setValueAtKey(k, add(p.keyValue(k)));
        } else {
            p.setValue(add(p.value));
        }
    }

    // Met l'ancre au centre du contenu de chaque calque s\u00e9lectionn\u00e9, sans le d\u00e9placer \u00e0 l'\u00e9cran
    function centerAnchors(comp) {
        var sel = comp.selectedLayers, done = 0, skipped = 0;
        for (var i = 0; i < sel.length; i++) {
            var L = sel[i];
            if (L instanceof CameraLayer || L instanceof LightLayer) { skipped++; continue; }
            var tr = L.property("ADBE Transform Group");
            var ap = tr.property("ADBE Anchor Point");
            if (!ap || ap.numKeys > 0 || ap.expressionEnabled) { skipped++; continue; }
            var t = comp.time;
            var r;
            try { r = L.sourceRectAtTime(t, false); } catch (e) { r = null; }
            if (!r || (r.width === 0 && r.height === 0)) {
                try { r = { left: 0, top: 0, width: L.width, height: L.height }; } catch (e2) { skipped++; continue; }
            }
            var old = ap.value;
            var nx = r.left + r.width / 2, ny = r.top + r.height / 2;
            var dax = nx - old[0], day = ny - old[1];
            if (Math.abs(dax) < 0.001 && Math.abs(day) < 0.001) { done++; continue; }

            // compensation sur la position : d\u00e9calage d'ancre \u00d7 \u00e9chelle, tourn\u00e9 selon la rotation du calque
            var sc = tr.property("ADBE Scale").valueAtTime(t, false);
            var rotProp = tr.property("ADBE Rotate Z");
            var rot = rotProp ? rotProp.valueAtTime(t, false) : 0;
            var a = rot * Math.PI / 180;
            var sx = dax * sc[0] / 100, sy = day * sc[1] / 100;
            var px = sx * Math.cos(a) - sy * Math.sin(a);
            var py = sx * Math.sin(a) + sy * Math.cos(a);

            var nv = [nx, ny];
            if (old.length > 2) nv.push(old[2]);
            ap.setValue(nv);

            var pos = tr.property("ADBE Position");
            if (pos.dimensionsSeparated) {
                shiftPosBy(tr.property("ADBE Position_0"), px, py, 0);
                shiftPosBy(tr.property("ADBE Position_1"), px, py, 1);
            } else {
                shiftPosBy(pos, px, py, -1);
            }
            done++;
        }
        return { done: done, skipped: skipped };
    }

    // ---------- Precomp / D\u00e9precomp ----------

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

    // Pr\u00e9-compose les calques s\u00e9lectionn\u00e9s (comme Calque > Pr\u00e9-composer, sans la fen\u00eatre)
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

    function layerIdSet(comp) {
        var set = {};
        for (var i = 1; i <= comp.numLayers; i++) set[comp.layer(i).id] = true;
        return set;
    }

    // Retrouve le calque qui vient d'\u00eatre ajout\u00e9 (celui dont l'id n'existait pas avant)
    function findAddedLayer(comp, before) {
        for (var i = 1; i <= comp.numLayers; i++) {
            if (!before[comp.layer(i).id]) return comp.layer(i);
        }
        return null;
    }

    // Remet le contenu d'un precomp dans la composition, \u00e0 sa place
    function uncompose(comp, layer) {
        var src = layer.source;
        var off = layer.startTime;
        var k = 1;
        try { k = layer.stretch / 100; } catch (eS) {}
        var map = {};
        var created = [];
        for (var i = 1; i <= src.numLayers; i++) {
            var L = src.layer(i);
            var before = layerIdSet(comp);
            L.copyToComp(comp);
            var nl = findAddedLayer(comp, before);
            if (!nl) throw new Error("impossible de retrouver le calque copi\u00e9 \u00ab " + L.name + " \u00bb");
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
        // parent\u00e9s internes au precomp
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
                // Calque parent\u00e9 : on le d\u00e9tache le temps du calcul, puis on le rattache sans le faire bouger
                if (parent) layer.setParentWithJump();
                var r = layerRect(layer, t);
                // (pas de conditions \u00ab ? : \u00bb imbriqu\u00e9es : After Effects les lit mal)
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
    // Paroles
    // =====================================================================

    // Marqueurs : ceux du calque s\u00e9lectionn\u00e9 (ex. la musique) s'il en a, sinon ceux de la composition
    function getMarkers(comp) {
        var sel = comp.selectedLayers;
        var i, k, m, times = [];
        for (i = 0; i < sel.length; i++) {
            m = sel[i].property("ADBE Marker");
            if (m && m.numKeys > 0) {
                for (k = 1; k <= m.numKeys; k++) times.push(m.keyTime(k));
                return { times: times, end: sel[i].outPoint, source: "le calque \u00ab " + sel[i].name + " \u00bb" };
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

    // Pose un marqueur par mot sur le calque de la musique
    function placeWordMarkers(layer, words, replace) {
        var mk = layer.property("ADBE Marker");
        if (replace) { while (mk.numKeys > 0) mk.removeKey(1); }
        var k = 1;
        try { k = layer.stretch / 100; } catch (e) {}
        var times = [], values = [];
        var last = -1;
        for (var i = 0; i < words.length; i++) {
            var t = layer.startTime + words[i].t * k;
            if (t < layer.inPoint - 0.05 || t >= layer.outPoint) continue; // seulement la partie gard\u00e9e
            if (t <= last + 0.001) t = last + 0.01; // jamais deux marqueurs au m\u00eame moment
            last = t;
            times.push(t);
            values.push(new MarkerValue(words[i].w));
        }
        if (times.length) {
            try { mk.setValuesAtTimes(times, values); }
            catch (e2) { for (var j = 0; j < times.length; j++) mk.setValueAtTime(times[j], values[j]); }
        }
        return times.length;
    }

    function createLyrics(comp, rawText, fontSize, preset) {
        // Chaque mot (s\u00e9par\u00e9 par un espace ou un retour \u00e0 la ligne) devient un texte
        var rawWords = String(rawText).split(/\s+/);
        var lines = [];
        for (var i = 0; i < rawWords.length; i++) {
            var l = trim(rawWords[i]);
            if (l !== "") lines.push(l);
        }
        if (!lines.length) throw new Error("\u00c9cris d'abord les paroles (un mot = un texte).");

        var mk = getMarkers(comp);
        if (!mk) {
            throw new Error("Aucun marqueur trouv\u00e9.\n\nAjoute des marqueurs sur la composition " +
                "(touche * du pav\u00e9 num\u00e9rique, aucun calque s\u00e9lectionn\u00e9) ou sur ton calque audio " +
                "(s\u00e9lectionne-le puis touche *), un marqueur au d\u00e9but de chaque mot.");
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

        var msg = created.length + " texte(s) cr\u00e9\u00e9(s) depuis les marqueurs de " + mk.source + ".";
        if (lines.length > mk.times.length) {
            msg += "\n" + (lines.length - mk.times.length) + " mot(s) sans marqueur ignor\u00e9(s).";
        }
        return msg;
    }

    // =====================================================================
    // COURBES : moteur, biblioth\u00e8que, import Flow, \u00e9diteur
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

    // Courbe \u00ab miroir \u00bb dans le temps (ease-out <-> ease-in) : c'est le reverse
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

    // Normalise une courbe venant d'un fichier (valeurs s\u00fbres)
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

    // \u00c9vite deux cl\u00e9s \u00e0 la m\u00eame valeur (la transition serait plate et impossible \u00e0 \u00e9diter)
    function fixThreeKeyValues(c) {
        if (Math.abs(c.mid[1]) < 0.05) c.mid[1] = (c.mid[1] < 0) ? -0.05 : 0.05;
        if (Math.abs(c.end - c.mid[1]) < 0.05) c.end = (c.end < c.mid[1]) ? c.mid[1] - 0.05 : c.mid[1] + 0.05;
    }

    // ---------- JSON (sans d\u00e9pendance) ----------

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

    // Lecture JSON s\u00fbre (v\u00e9rifie qu'il n'y a que des donn\u00e9es avant d'\u00e9valuer)
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

    // ---------- Biblioth\u00e8que (fichier curves.json) ----------

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

    // Parcourt n'importe quelle structure et r\u00e9cup\u00e8re les courbes cubic-bezier qu'elle contient
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

    // Ajoute les courbes trouv\u00e9es dans la biblioth\u00e8que \u00ab Flow \u00b7 <nom> \u00bb (sans doublons)
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
        return { found: found.length, added: importCurvesInto(found, "Flow \u00b7 " + fileBaseName(f)) };
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

    // Courbe \u00e0 utiliser pour la transition n\u00b0 i (entre la cl\u00e9 i et la cl\u00e9 i+1)
    function bezForSegment(curve, mode, i) {
        var n = curve.segs.length; // 1 ou 2
        var reversed = false;
        var local = i % n;
        if (mode === "reverse") reversed = true;
        if (mode === "alternate") reversed = (Math.floor(i / n) % 2) === 1;
        if (!reversed) return curve.segs[local];
        // reverse : on parcourt la courbe \u00e0 l'envers (ordre des transitions invers\u00e9 + miroir)
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

    // Convertit une transition cubic-bezier en easing After Effects entre les cl\u00e9s k1 et k2
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

    // D\u00e9place la cl\u00e9 du milieu d'un groupe de 3 cl\u00e9s au bon moment
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

    // ---------- Lecture d'une courbe depuis les keyframes (compatible Flow) ----------

    // Valeur d'une cl\u00e9 sur la dimension choisie (dim = -1 : distance pour les propri\u00e9t\u00e9s spatiales)
    function keyDim(v, dim) {
        if (v instanceof Array) return v[dim < 0 ? 0 : dim];
        return v;
    }

    // Transition entre k1 et k2 -> cubic-bezier [x1, y1, x2, y2] (l'inverse de applyBezToSegment)
    function readBezFromSegment(p, k1, k2, dim) {
        var dt = p.keyTime(k2) - p.keyTime(k1);
        var LIN = KeyframeInterpolationType.LINEAR;
        var HOLD = KeyframeInterpolationType.HOLD;
        if (p.keyOutInterpolationType(k1) === HOLD) return null;
        if (dt <= 0) return null;
        var outLinear = p.keyOutInterpolationType(k1) === LIN;
        var inLinear = p.keyInInterpolationType(k2) === LIN;

        var D;
        if (dim < 0) D = vecLength(valueDelta(p.keyValue(k1), p.keyValue(k2)));
        else D = keyDim(p.keyValue(k2), dim) - keyDim(p.keyValue(k1), dim);

        var eo = p.keyOutTemporalEase(k1), ei = p.keyInTemporalEase(k2);
        var di = (dim < 0) ? 0 : Math.min(dim, eo.length - 1);
        var x1 = eo[di].influence / 100, x2 = 1 - ei[di].influence / 100;
        var y1, y2;
        if (Math.abs(D) < 1e-9) {
            y1 = 0; y2 = 1;
        } else {
            y1 = eo[di].speed * x1 * dt / D;
            y2 = 1 - ei[di].speed * (1 - x2) * dt / D;
        }
        if (outLinear) { x1 = 0.3333; y1 = 0.3333; }
        if (inLinear) { x2 = 0.6667; y2 = 0.6667; }
        return [round4(clampNum(x1, 0, 1)), round4(clampNum(y1, -3, 4)), round4(clampNum(x2, 0, 1)), round4(clampNum(y2, -3, 4))];
    }

    // Lit la courbe sur la 1re propri\u00e9t\u00e9 qui a au moins 2 keyframes s\u00e9lectionn\u00e9es
    function readCurveFromSelection(comp) {
        var props = comp.selectedProperties;
        for (var i = 0; i < props.length; i++) {
            var p = props[i];
            if (p.propertyType !== PropertyType.PROPERTY) continue;
            var sel = p.selectedKeys;
            if (!sel || sel.length < 2 || !isEasable(p)) continue;
            var keys = [];
            for (var j = 0; j < sel.length; j++) keys.push(sel[j]);
            keys.sort(function (a, b) { return a - b; });

            // dimension utilis\u00e9e : distance si spatial, sinon celle qui bouge le plus
            var dim = -1;
            if (!p.isSpatial) {
                var v1 = p.keyValue(keys[0]), v2 = p.keyValue(keys[1]);
                dim = 0;
                if (v1 instanceof Array) {
                    var best = -1;
                    for (var d = 0; d < v1.length; d++) {
                        var m = Math.abs(v2[d] - v1[d]);
                        if (m > best) { best = m; dim = d; }
                    }
                }
            }

            var c = defaultCurve();
            var b1 = readBezFromSegment(p, keys[0], keys[1], dim);
            if (!b1) return { error: "Les keyframes s\u00e9lectionn\u00e9es sont en maintien (hold) : rien \u00e0 lire." };
            if (keys.length >= 3) {
                var b2 = readBezFromSegment(p, keys[1], keys[2], dim);
                if (b2) {
                    var t0 = p.keyTime(keys[0]), t2 = p.keyTime(keys[2]);
                    var a0, a1, a2;
                    if (dim < 0) {
                        a0 = 0;
                        a1 = vecLength(valueDelta(p.keyValue(keys[0]), p.keyValue(keys[1])));
                        a2 = vecLength(valueDelta(p.keyValue(keys[0]), p.keyValue(keys[2])));
                    } else {
                        a0 = keyDim(p.keyValue(keys[0]), dim);
                        a1 = keyDim(p.keyValue(keys[1]), dim);
                        a2 = keyDim(p.keyValue(keys[2]), dim);
                    }
                    var span = a1 - a0;
                    c.keys = 3;
                    c.segs = [b1, b2];
                    c.mid = [round4(clampNum((p.keyTime(keys[1]) - t0) / (t2 - t0), 0.05, 0.95)), 1];
                    c.end = (Math.abs(span) < 1e-9) ? 0 : round4(clampNum((a2 - a0) / span, -1, 2));
                    fixThreeKeyValues(c);
                    return { curve: c, prop: p.name };
                }
            }
            c.segs = [b1];
            return { curve: c, prop: p.name };
        }
        return { error: "S\u00e9lectionne au moins 2 keyframes sur une propri\u00e9t\u00e9 (dans la timeline)." };
    }

    // Applique la courbe \u00e0 toutes les keyframes s\u00e9lectionn\u00e9es de la composition
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

    // =====================================================================
    // API appel\u00e9e par le panneau HTML (r\u00e9ponses en JSON)
    // =====================================================================

    function out(o) { return toJSON(o); }
    function ok(msg, data) { var o = { ok: true, msg: msg || "" }; if (data !== undefined) o.data = data; return out(o); }
    function fail(msg) { return out({ ok: false, msg: msg }); }
    function needComp() {
        var c = getActiveComp();
        if (!c) throw new Error("Ouvre d'abord une composition.");
        return c;
    }
    function undoable(name, fn) {
        app.beginUndoGroup(name);
        try { return fn(); }
        finally { app.endUndoGroup(); }
    }
    function arg(s) { return (typeof s === "string") ? parseJSONSafe(s) : s; }

    var API = {};

    // ---------- Miroir / Dupliquer / Solide ----------

    // mode miroir : retourne horizontalement les calques selectionnes (echelle X inversee)
    function mirrorLayer(L) {
        var sc = L.property("ADBE Transform Group").property("ADBE Scale");
        if (!sc || sc.expressionEnabled) return false;
        function flip(v) { var o = [-v[0], v[1]]; if (v.length > 2) o.push(v[2]); return o; }
        if (sc.numKeys > 0) { for (var k = 1; k <= sc.numKeys; k++) sc.setValueAtKey(k, flip(sc.keyValue(k))); }
        else sc.setValue(flip(sc.value));
        return true;
    }

    API.reverse = function () {
        try {
            var comp = needComp();
            var sel = comp.selectedLayers, src = [], i;
            for (i = 0; i < sel.length; i++) src.push(sel[i]);
            if (!src.length) return fail("S\u00e9lectionne d'abord un ou plusieurs calques.");
            return undoable("Miroir", function () {
                var n = 0;
                for (i = 0; i < src.length; i++) { try { if (mirrorLayer(src[i])) n++; } catch (e1) {} }
                var m = n + " calque(s) en miroir.";
                if (n < src.length) m += " " + (src.length - n) + " n'a (n'ont) pas pu \u00eatre retourn\u00e9(s).";
                return ok(m);
            });
        } catch (e) { return fail("Erreur : " + e.message); }
    };

    API.duplicate = function () {
        try {
            var comp = needComp();
            var sel = comp.selectedLayers, src = [], i;
            for (i = 0; i < sel.length; i++) src.push(sel[i]);
            if (!src.length) return fail("S\u00e9lectionne d'abord un ou plusieurs calques.");
            return undoable("Dupliquer", function () {
                var dups = [];
                for (i = 0; i < src.length; i++) dups.push(src[i].duplicate());
                for (i = 0; i < src.length; i++) src[i].selected = false;
                for (i = 0; i < dups.length; i++) dups[i].selected = true;
                return ok(dups.length + " calque(s) dupliqu\u00e9(s).");
            });
        } catch (e) { return fail("Erreur : " + e.message); }
    };

    // solide : meme fonctionnement que Text / Adjustment layer (a la duree du calque selectionne),
    // ou sur toute la composition si rien n'est selectionne
    API.solid = function (hexJson) {
        try {
            var comp = needComp();
            var hex = String(arg(hexJson) || "#000000").replace("#", "");
            if (!/^[0-9a-fA-F]{6}$/.test(hex)) hex = "000000";
            hex = hex.toUpperCase();
            var col = [parseInt(hex.substr(0, 2), 16) / 255, parseInt(hex.substr(2, 2), 16) / 255, parseInt(hex.substr(4, 2), 16) / 255];
            var sel = comp.selectedLayers, targets = [], i;
            for (i = 0; i < sel.length; i++) targets.push(sel[i]);
            return undoable("Solide", function () {
                var made = [];
                function mk() { return comp.layers.addSolid(col, "Solide #" + hex, comp.width, comp.height, comp.pixelAspect, comp.duration); }
                if (!targets.length) {
                    var L0 = mk();
                    L0.startTime = 0; L0.inPoint = 0; L0.outPoint = comp.duration;
                    made.push(L0);
                } else {
                    for (i = 0; i < targets.length; i++) {
                        var src = targets[i], inP = src.inPoint, outP = src.outPoint;
                        if (outP - inP <= 0) continue;
                        var L = mk();
                        L.startTime = inP; L.inPoint = inP; L.outPoint = outP;
                        L.moveBefore(src);
                        made.push(L);
                    }
                }
                deselectAll(comp);
                for (i = 0; i < made.length; i++) made[i].selected = true;
                return ok(made.length + " solide(s) #" + hex + " cr\u00e9\u00e9(s)" + (targets.length ? "." : " sur toute la composition."));
            });
        } catch (e) { return fail("Erreur : " + e.message); }
    };

    // ---------- Coller une image (fichier prepare par le panneau) ----------
    function imagesFolder(name) {
        name = name || "AuraScript Images";
        var root = app.project.rootFolder;
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof FolderItem && it.name === name && it.parentFolder === root) return it;
        }
        return app.project.items.addFolder(name);
    }

    API.importImage = function (pathJson, atZero) {
        try {
            var comp = needComp();
            var f = new File(String(arg(pathJson)));
            if (!f.exists) return fail("Fichier image introuvable.");
            var sel = comp.selectedLayers, top = null, i;
            for (i = 0; i < sel.length; i++) if (!top || sel[i].index < top.index) top = sel[i];
            var t = atZero ? 0 : comp.time;
            return undoable("Coller l'image", function () {
                var io = new ImportOptions(f);
                var item = app.project.importFile(io);
                var isVideo = item.duration > 0 && !item.mainSource.isStill;
                try { item.parentFolder = imagesFolder(isVideo ? "AuraScript Vid\u00e9os" : "AuraScript Images"); } catch (e1) {}
                var L = comp.layers.add(item);
                var len = L.outPoint - L.inPoint;
                if (!(len > 0)) len = comp.duration;
                L.startTime = t;
                L.inPoint = t;
                L.outPoint = Math.min(comp.duration, t + len);
                if (top) { try { L.moveBefore(top); } catch (e2) {} }
                var w = item.width, h = item.height;
                if (w > comp.width || h > comp.height) {
                    var k = Math.min(comp.width / w, comp.height / h) * 100;
                    L.property("ADBE Transform Group").property("ADBE Scale").setValue([k, k]);
                }
                L.property("ADBE Transform Group").property("ADBE Position").setValue([comp.width / 2, comp.height / 2]);
                deselectAll(comp);
                L.selected = true;
                return ok((isVideo ? "Vid\u00e9o coll\u00e9e : " : "Image coll\u00e9e : ") + item.name + " (" + w + "\u00d7" + h + ").");
            });
        } catch (e) { return fail("Erreur : " + e.message); }
    };

    // ---------- Onglet PRESETS ----------
    function lastKeyTime(group) {
        var m = -1;
        for (var i = 1; i <= group.numProperties; i++) {
            var p = null;
            try { p = group.property(i); } catch (e) { p = null; }
            if (!p) continue;
            try {
                if (p.propertyType === PropertyType.PROPERTY) {
                    if (p.numKeys > 0) { var k = p.keyTime(p.numKeys); if (k > m) m = k; }
                } else {
                    var c = lastKeyTime(p); if (c > m) m = c;
                }
            } catch (e2) {}
        }
        return m;
    }

    API.fxPickFiles = function () {
        var filter = isWindows() ? "Presets After Effects:*.ffx" : function (f) { return (f instanceof Folder) || /\.ffx$/i.test(f.name); };
        var files = File.openDialog("Choisis un ou plusieurs presets .ffx", filter, true);
        if (!files) return ok("", []);
        if (!(files instanceof Array)) files = [files];
        var out = [];
        for (var i = 0; i < files.length; i++) if (/\.ffx$/i.test(files[i].name)) out.push(files[i].fsName);
        return ok("", out);
    };

    API.fxPickFolder = function () {
        var f = Folder.selectDialog("Choisis le dossier qui contient tes presets .ffx");
        return ok("", f ? f.fsName : "");
    };

    // calque(s) selectionne(s) : preset applique dessus ; rien de selectionne : nouveau calque d'effet
    // a la taille de la compo, qui commence a la tete de lecture et dure le temps de l'animation du preset
    API.fxApply = function (pathJson) {
        try {
            var comp = needComp();
            var f = new File(String(arg(pathJson)));
            if (!f.exists) return fail("Fichier de preset introuvable :\n" + f.fsName);
            var name = decodeURI(f.name).replace(/\.ffx$/i, "");
            var sel = comp.selectedLayers, targets = [], i;
            for (i = 0; i < sel.length; i++) targets.push(sel[i]);
            var t = comp.time;
            return undoable("Preset : " + name, function () {
                if (targets.length) {
                    for (i = 0; i < targets.length; i++) {
                        deselectAll(comp);
                        targets[i].selected = true;
                        comp.time = t;
                        targets[i].applyPreset(f);
                    }
                    deselectAll(comp);
                    for (i = 0; i < targets.length; i++) targets[i].selected = true;
                    comp.time = t;
                    return ok("\u00ab " + name + " \u00bb appliqu\u00e9 sur " + targets.length + " calque(s).");
                }
                deselectAll(comp);
                var lay = newLayerByCommand(comp, ["Adjustment Layer", "Calque d'effets", "Calque d\u2019effets"], 2279, isAdjustment);
                if (!lay) {
                    lay = comp.layers.addSolid([1, 1, 1], name, comp.width, comp.height, comp.pixelAspect, comp.duration);
                    lay.adjustmentLayer = true;
                }
                lay.startTime = 0; lay.inPoint = 0; lay.outPoint = comp.duration;
                try { lay.name = name; } catch (e1) {}
                deselectAll(comp);
                lay.selected = true;
                comp.time = t;
                lay.applyPreset(f);
                var fd = comp.frameDuration, end = lastKeyTime(lay);
                lay.inPoint = t;
                lay.outPoint = (end > t + fd / 2) ? Math.min(comp.duration, end + fd) : comp.duration;
                comp.time = t;
                deselectAll(comp);
                lay.selected = true;
                return ok("\u00ab " + name + " \u00bb mis sur un nouveau calque d'effet.");
            });
        } catch (e) { return fail("Erreur : " + e.message); }
    };

    // ---------- Extraire l'audio (video TikTok ou autre) ----------
    function findCompById(id) {
        for (var i = 1; i <= app.project.numItems; i++) { var it = app.project.item(i); if (it instanceof CompItem && it.id === id) return it; }
        return null;
    }

    API.videoLayers = function () {
        try {
            var comp = needComp();
            var sel = comp.selectedLayers, out = [];
            for (var i = 0; i < sel.length; i++) {
                var L = sel[i];
                try {
                    if (L.hasAudio && L.hasVideo && L.source && L.source.file) out.push({ compId: comp.id, index: L.index, name: L.name, path: L.source.file.fsName });
                } catch (e) {}
            }
            if (!out.length) return fail("S\u00e9lectionne la vid\u00e9o TikTok (un calque vid\u00e9o avec du son) dans la timeline.");
            return ok("", out);
        } catch (e) { return fail(e.message); }
    };

    // ajoute le fichier audio extrait juste sous la video, cale au meme endroit, et coupe le son de la video
    API.placeAudio = function (compId, index, audioJson) {
        try {
            var comp = findCompById(compId);
            if (!comp) return fail("Composition introuvable.");
            var src = comp.layer(index);
            var f = new File(String(arg(audioJson)));
            if (!f.exists) return fail("Fichier audio introuvable.");
            return undoable("Extraire l'audio", function () {
                var item = app.project.importFile(new ImportOptions(f));
                try { item.parentFolder = imagesFolder("AuraScript Audio"); } catch (e1) {}
                var A = comp.layers.add(item);
                try { A.stretch = src.stretch; } catch (e2) {}
                A.startTime = src.startTime;
                A.inPoint = src.inPoint;
                A.outPoint = src.outPoint;
                A.moveAfter(src);
                try { A.name = "Audio - " + src.name; } catch (e3) {}
                try { src.audioEnabled = false; } catch (e4) {}
                deselectAll(comp);
                A.selected = true;
                return ok("Audio extrait : \u00ab " + A.name + " \u00bb (le son de la vid\u00e9o est coup\u00e9).");
            });
        } catch (e) { return fail("Erreur : " + e.message); }
    };

    // sans ffmpeg : copie du calque en audio seul
    API.splitAudio = function () {
        try {
            var comp = needComp();
            var sel = comp.selectedLayers, src = [], i;
            for (i = 0; i < sel.length; i++) { try { if (sel[i].hasAudio && sel[i].hasVideo) src.push(sel[i]); } catch (e) {} }
            if (!src.length) return fail("S\u00e9lectionne la vid\u00e9o TikTok (un calque vid\u00e9o avec du son) dans la timeline.");
            return undoable("Extraire l'audio", function () {
                var made = [];
                for (i = 0; i < src.length; i++) {
                    var A = src[i].duplicate();
                    A.moveAfter(src[i]);
                    A.enabled = false;
                    A.audioEnabled = true;
                    try { A.name = "Audio - " + src[i].name; } catch (e1) {}
                    src[i].audioEnabled = false;
                    made.push(A);
                }
                deselectAll(comp);
                for (i = 0; i < made.length; i++) made[i].selected = true;
                return ok(made.length + " audio(s) extrait(s).");
            });
        } catch (e) { return fail("Erreur : " + e.message); }
    };

    // ---------- Accelerer x2 / Ralentir x2 ----------
    // change la vitesse des calques selectionnes en gardant leur debut au meme endroit dans la timeline
    API.speed = function (factor) {
        try {
            var comp = needComp();
            var sel = comp.selectedLayers, src = [], i;
            for (i = 0; i < sel.length; i++) src.push(sel[i]);
            if (!src.length) return fail("S\u00e9lectionne d'abord un ou plusieurs calques.");
            factor = Number(factor);
            if (!(factor > 0)) return fail("Vitesse invalide.");
            var label = factor > 1 ? "Acc\u00e9l\u00e9rer x" + factor : "Ralentir x" + Math.round(1 / factor);
            return undoable(label, function () {
                var done = 0, skipped = 0;
                for (i = 0; i < src.length; i++) {
                    var L = src[i];
                    try {
                        if (L.locked) { skipped++; continue; }
                        var oldS = L.stretch, newS = oldS / factor;
                        if (Math.abs(newS) > 9900 || Math.abs(newS) < 1) { skipped++; continue; }
                        var inP = L.inPoint, outP = L.outPoint;
                        var srcIn = (inP - L.startTime) / (oldS / 100);
                        L.stretch = newS;
                        L.startTime = inP - srcIn * (newS / 100);
                        L.inPoint = inP;
                        L.outPoint = inP + (outP - inP) / factor;
                        done++;
                    } catch (e1) { skipped++; }
                }
                var m = done + " calque(s) " + (factor > 1 ? "acc\u00e9l\u00e9r\u00e9(s) x" + factor : "ralenti(s) x" + Math.round(1 / factor)) + ".";
                if (skipped) m += " " + skipped + " ignor\u00e9(s) (verrouill\u00e9 ou limite de vitesse).";
                return ok(m);
            });
        } catch (e) { return fail("Erreur : " + e.message); }
    };

    // ---------- image de fond du panneau ----------
    API.bgPickImage = function () {
        var filter = isWindows() ? "Images:*.png;*.jpg;*.jpeg;*.gif;*.bmp;*.webp" : function (f) { return (f instanceof Folder) || /\.(png|jpe?g|gif|bmp|webp)$/i.test(f.name); };
        var f = File.openDialog("Choisis une image de fond", filter, false);
        return ok("", f ? f.fsName : "");
    };

    API.ping = function () { return ok("pong", { ae: app.version, os: $.os }); };

    API.align = function (h, v) {
        try {
            var comp = needComp();
            if (!comp.selectedLayers.length) return fail("S\u00e9lectionne d'abord un ou plusieurs calques.");
            return undoable("Aligner : " + ALIGN_LABELS[v][h], function () {
                var res = alignLayers(comp, h, v);
                var m = res.moved + " calque(s) plac\u00e9(s) : " + ALIGN_LABELS[v][h] + ".";
                if (res.skipped) m += " " + res.skipped + " n'a (n'ont) pas pu \u00eatre d\u00e9plac\u00e9(s).";
                return ok(m);
            });
        } catch (e) { return fail("Erreur : " + e.message); }
    };

    var SPAN_LABELS = { adjust: "Adjustment layer", "null": "Null", text: "Text" };
    API.span = function (kind) {
        try {
            var comp = needComp();
            var sel = comp.selectedLayers, targets = [];
            for (var i = 0; i < sel.length; i++) targets.push(sel[i]);
            if (!targets.length) return fail("Clique d'abord sur une vid\u00e9o (ou un calque) dans la timeline.");
            return undoable(SPAN_LABELS[kind], function () {
                for (var j = 0; j < targets.length; j++) createSpanLayerFor(comp, targets[j], kind);
                return ok(targets.length + " calque(s) \u00ab " + SPAN_LABELS[kind] + " \u00bb cr\u00e9\u00e9(s).");
            });
        } catch (e) { return fail("Erreur : " + e.message); }
    };

    API.precomp = function () {
        try {
            var comp = needComp();
            if (!comp.selectedLayers.length) return fail("S\u00e9lectionne d'abord un ou plusieurs calques.");
            return undoable("Precomp", function () {
                var nc = precomposeSelected(comp);
                return ok(nc ? "Precomp \u00ab " + nc.name + " \u00bb cr\u00e9\u00e9." : "");
            });
        } catch (e) { return fail("Erreur : " + e.message); }
    };

    API.uncomp = function () {
        try {
            var comp = needComp();
            var sel = comp.selectedLayers, targets = [];
            for (var i = 0; i < sel.length; i++) if (sel[i].source && sel[i].source instanceof CompItem) targets.push(sel[i]);
            if (!targets.length) return fail("S\u00e9lectionne un calque precomp dans la timeline.");
            var extras = false;
            for (var j = 0; j < targets.length; j++) if (hasLayerExtras(targets[j])) extras = true;
            if (extras && !confirm("Les effets, animations ou le time remap pos\u00e9s sur le precomp lui-m\u00eame seront perdus. Continuer ?")) return ok("");
            return undoable("D\u00e9precomp", function () {
                var total = 0;
                for (var k = 0; k < targets.length; k++) total += uncompose(comp, targets[k]);
                return ok("D\u00e9precomp : " + total + " calque(s) remis dans la composition.");
            });
        } catch (e) { return fail("Erreur : " + e.message); }
    };

    API.anchor = function () {
        try {
            var comp = needComp();
            if (!comp.selectedLayers.length) return fail("S\u00e9lectionne d'abord un ou plusieurs calques.");
            return undoable("Centrer le point d'ancrage", function () {
                var r = centerAnchors(comp);
                return ok(r.done + " point(s) d'ancrage centr\u00e9(s)." + (r.skipped ? " " + r.skipped + " calque(s) ignor\u00e9(s) (cam\u00e9ra, lumi\u00e8re ou ancre anim\u00e9e)." : ""));
            });
        } catch (e) { return fail("Erreur : " + e.message); }
    };

    API.textCase = function (upper) {
        try {
            var comp = needComp();
            return undoable(upper ? "Majuscule" : "Minuscule", function () {
                var n = changeTextCase(comp, upper);
                if (!n) return fail("S\u00e9lectionne un ou plusieurs calques texte dans la timeline.");
                return ok(n + " texte(s) mis en " + (upper ? "majuscules." : "minuscules."));
            });
        } catch (e) { return fail("Erreur : " + e.message); }
    };

    // ---------- Presets .ffx ----------
    API.presetsList = function () {
        loadPresets();
        var names = [];
        for (var i = 0; i < presets.length; i++) names.push(presets[i].name);
        return ok("", names);
    };

    API.presetsAdd = function () {
        loadPresets();
        var filter = isWindows() ? "Presets After Effects:*.ffx" : function (f) { return (f instanceof Folder) || /\.ffx$/i.test(f.name); };
        var files = File.openDialog("Choisis un ou plusieurs presets .ffx", filter, true);
        if (!files) return ok("", -1);
        if (!(files instanceof Array)) files = [files];
        var added = 0;
        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            if (!/\.ffx$/i.test(f.name)) continue;
            var exists = false;
            for (var j = 0; j < presets.length; j++) if (presets[j].path === f.fsName) { exists = true; break; }
            if (exists) continue;
            presets.push({ name: decodeURI(f.name).replace(/\.ffx$/i, ""), path: f.fsName });
            added++;
        }
        if (!added) return ok("Aucun nouveau preset ajout\u00e9.", -1);
        savePresets();
        return ok(added + " preset(s) ajout\u00e9(s).", presets.length - 1);
    };

    API.presetsRemove = function (idx) {
        loadPresets();
        if (idx < 0 || idx >= presets.length) return fail("Choisis d'abord un preset dans la liste.");
        presets.splice(idx, 1);
        savePresets();
        return ok("Preset retir\u00e9 de la liste.");
    };

    API.presetApply = function (idx) {
        try {
            loadPresets();
            var preset = presets[idx];
            if (!preset) return fail("Choisis un preset dans la liste (ajoute un .ffx avec \u00ab + \u00bb).");
            var comp = needComp();
            var sel = comp.selectedLayers, texts = [];
            for (var i = 0; i < sel.length; i++) if (sel[i] instanceof TextLayer) texts.push(sel[i]);
            if (!texts.length) return fail("S\u00e9lectionne au moins un calque texte.");
            return undoable("Appliquer preset texte", function () {
                applyPresetToLayers(comp, preset, texts);
                return ok("\u00ab " + preset.name + " \u00bb appliqu\u00e9 \u00e0 " + texts.length + " texte(s).");
            });
        } catch (e) { return fail("Erreur : " + e.message); }
    };

    API.createLyrics = function (textJson, size, presetIdx) {
        try {
            var comp = needComp();
            loadPresets();
            var text = arg(textJson);
            var preset = (presetIdx >= 0) ? presets[presetIdx] : null;
            if (isNaN(size) || size <= 0) size = 150;
            return undoable("Cr\u00e9er les paroles", function () {
                return ok(createLyrics(comp, text, size, preset));
            });
        } catch (e) { return fail(e.message); }
    };

    // ---------- Musique s\u00e9lectionn\u00e9e (pour la d\u00e9tection des paroles) ----------
    API.audioLayer = function () {
        try {
            var comp = needComp();
            var sel = comp.selectedLayers, layer = null;
            for (var i = 0; i < sel.length; i++) {
                try { if (sel[i].hasAudio && sel[i].source && sel[i].source.file) { layer = sel[i]; break; } } catch (e) {}
            }
            if (!layer) return fail("S\u00e9lectionne ta musique dans la timeline (le calque audio).");
            var k = 1;
            try { k = layer.stretch / 100; } catch (eK) {}
            if (!k || k < 0) k = 1;
            return ok("", {
                compId: comp.id, layerIndex: layer.index, name: layer.name,
                path: layer.source.file.fsName, fileName: decodeURI(layer.source.file.name),
                srcIn: Math.max(0, (layer.inPoint - layer.startTime) / k),
                srcOut: Math.max(0.2, (layer.outPoint - layer.startTime) / k),
                markers: layer.property("ADBE Marker").numKeys
            });
        } catch (e) { return fail(e.message); }
    };

    API.placeMarkers = function (compId, layerIndex, wordsJson, replace) {
        try {
            var comp = null;
            for (var i = 1; i <= app.project.numItems; i++) {
                var it = app.project.item(i);
                if (it instanceof CompItem && it.id === compId) { comp = it; break; }
            }
            if (!comp) return fail("La composition de la musique est introuvable.");
            var layer = comp.layer(layerIndex);
            var words = arg(wordsJson);
            return undoable("D\u00e9tecter les paroles", function () {
                var n = placeWordMarkers(layer, words, replace);
                try { deselectAll(comp); layer.selected = true; } catch (eSel) {}
                return ok("", n);
            });
        } catch (e) { return fail("Erreur : " + e.message); }
    };

    API.confirm = function (msgJson) { return ok("", confirm(arg(msgJson))); };
    API.alert = function (msgJson) { alert(arg(msgJson)); return ok(""); };
    API.prompt = function (msgJson, defJson) {
        var r = prompt(arg(msgJson), arg(defJson));
        return ok("", r === null ? null : String(r));
    };

    // ---------- Courbes ----------
    API.curvesList = function () { loadCurveLib(); return ok("", curveLib); };

    API.curveSave = function (curveJson) {
        loadCurveLib();
        var c = sanitizeCurve(arg(curveJson));
        var idx = findCurveIndex(c.id);
        if (idx >= 0) curveLib[idx] = c; else curveLib.push(c);
        if (!saveCurveLib()) return fail("Impossible d'enregistrer la biblioth\u00e8que.\n\nV\u00e9rifie l'option : Pr\u00e9f\u00e9rences > Scripts et expressions > \u00ab Autoriser les scripts \u00e0 \u00e9crire des fichiers et \u00e0 acc\u00e9der au r\u00e9seau \u00bb");
        return ok("Courbe \u00ab " + c.name + " \u00bb enregistr\u00e9e.", c);
    };

    API.curveDelete = function (id) {
        loadCurveLib();
        var idx = findCurveIndex(arg(id));
        if (idx < 0) return fail("Clique d'abord sur une vignette de courbe.");
        curveLib.splice(idx, 1);
        saveCurveLib();
        return ok("Courbe supprim\u00e9e.");
    };

    API.curveImportFlow = function () {
        loadCurveLib();
        var filter = isWindows() ? "Courbes Flow:*.flow;*.json;*.txt,Tous les fichiers:*.*" : function (f) { return (f instanceof Folder) || /\.(flow|json|txt)$/i.test(f.name); };
        var start = flowLibraryFolder(), f = null;
        if (start.exists) {
            try { f = new File(start.fsName + "/x.flow").openDlg("Choisis tes courbes Flow (.flow / .json)", filter, false); }
            catch (e) { f = File.openDialog("Choisis tes courbes Flow (.flow / .json)", filter, false); }
        } else {
            f = File.openDialog("Choisis tes courbes Flow (.flow / .json)", filter, false);
        }
        if (!f) return ok("");
        var r = importFlowFile(f);
        if (!r.found) return fail("Aucune courbe trouv\u00e9e dans ce fichier.");
        saveCurveLib();
        var msg = r.added + " courbe(s) import\u00e9e(s)";
        if (r.found > r.added) msg += " (" + (r.found - r.added) + " d\u00e9j\u00e0 pr\u00e9sente(s))";
        return ok(msg + ".");
    };

    API.curveApply = function (curveJson) {
        try {
            var comp = needComp();
            var c = sanitizeCurve(arg(curveJson));
            return undoable("Courbe : " + (c.name || "sans nom"), function () {
                var res = applyCurveToSelection(comp, c, "normal", false);
                if (!res.segs) return fail("S\u00e9lectionne au moins 2 keyframes sur une propri\u00e9t\u00e9 (dans la timeline).");
                return ok("Courbe appliqu\u00e9e : " + res.segs + " transition(s) sur " + res.props + " propri\u00e9t\u00e9(s).");
            });
        } catch (e) { return fail("Erreur : " + e.message); }
    };

    API.curveRead = function () {
        try {
            var comp = needComp();
            var r = readCurveFromSelection(comp);
            if (r.error) return fail(r.error);
            return ok("Courbe lue sur \u00ab " + r.prop + " \u00bb. Clique sur Enregistrer pour la garder.", r.curve);
        } catch (e) { return fail("Erreur : " + e.message); }
    };

    API.dataFolder = function () { return ok("", Folder.userData.fsName + "/AuraScript"); };

    $.global.AuraAPI = API;

})();
