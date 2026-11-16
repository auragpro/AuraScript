// AURASCRIPT-APP  (ne pas supprimer : permet au lanceur de reconnaître ce fichier)
// version: 1.0.1
// nouveautes: Correction de l'erreur « Erreur de syntaxe (ligne 1) »
// nouveautes: Mise à jour automatique à l'ouverture du panneau
// nouveautes: Calque d'effet calé sur la durée du calque sélectionné
// nouveautes: Paroles : un texte par ligne, calé sur les marqueurs
// nouveautes: Presets de texte (style ou fichier .ffx) avec + Preset et Appliquer
//
// AuraScript — code principal de l'outil, chargé par le lanceur AuraScript.jsx.

(function (thisObj) {
    var SCRIPT_NAME = "AuraScript";
    var SETTINGS_SECTION = "AuraScript";
    var SETTINGS_KEY = "presets";
    var POSITIONS = [
        { label: "Haut", y: 0.15 },
        { label: "Centre", y: 0.5 },
        { label: "Bas", y: 0.85 }
    ];
    var presets = [];

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

    function deselectAll(comp) {
        for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
    }

    function isWindows() {
        return $.os.indexOf("Windows") !== -1;
    }

    function getTextDocProp(layer) {
        return layer.property("ADBE Text Properties").property("ADBE Text Document");
    }

    // =====================================================================
    // Presets (sauvegardés dans les préférences d'After Effects)
    // =====================================================================

    function loadPresets() {
        presets = [];
        try {
            var section = SETTINGS_SECTION;
            // Récupère les presets de l'ancienne version (« Calque d'effet & Paroles »)
            if (!app.settings.haveSetting(section, SETTINGS_KEY) &&
                app.settings.haveSetting("CalqueEffetParoles", SETTINGS_KEY)) {
                section = "CalqueEffetParoles";
            }
            if (app.settings.haveSetting(section, SETTINGS_KEY)) {
                var s = app.settings.getSetting(section, SETTINGS_KEY);
                if (s) {
                    var arr = eval(s);
                    if (arr instanceof Array) presets = arr;
                }
            }
        } catch (e) {
            presets = [];
        }
    }

    function savePresets() {
        app.settings.saveSetting(SETTINGS_SECTION, SETTINGS_KEY, presets.toSource());
    }

    // Lit le style d'un TextDocument
    function captureStyle(td) {
        var st = {};
        try { st.font = td.font; } catch (e) {}
        try { st.fontSize = td.fontSize; } catch (e) {}
        try { st.applyFill = td.applyFill; } catch (e) {}
        try { if (td.applyFill) st.fillColor = [td.fillColor[0], td.fillColor[1], td.fillColor[2]]; } catch (e) {}
        try { st.applyStroke = td.applyStroke; } catch (e) {}
        try {
            if (td.applyStroke) {
                st.strokeColor = [td.strokeColor[0], td.strokeColor[1], td.strokeColor[2]];
                st.strokeWidth = td.strokeWidth;
                st.strokeOverFill = td.strokeOverFill;
            }
        } catch (e) {}
        try { st.tracking = td.tracking; } catch (e) {}
        try { st.autoLeading = td.autoLeading; } catch (e) {}
        try { if (!td.autoLeading) st.leading = td.leading; } catch (e) {}
        try { st.allCaps = td.allCaps; } catch (e) {}
        try { st.fauxBold = td.fauxBold; } catch (e) {}
        try { st.fauxItalic = td.fauxItalic; } catch (e) {}
        return st;
    }

    // Applique un style à un TextDocument (le texte lui-même n'est pas modifié)
    function setStyle(td, st) {
        try { if (st.font) td.font = st.font; } catch (e) {}
        try { if (st.fontSize) td.fontSize = st.fontSize; } catch (e) {}
        try {
            if (st.applyFill !== undefined) td.applyFill = st.applyFill;
            if (st.applyFill && st.fillColor) td.fillColor = st.fillColor;
        } catch (e) {}
        try {
            if (st.applyStroke !== undefined) td.applyStroke = st.applyStroke;
            if (st.applyStroke) {
                if (st.strokeColor) td.strokeColor = st.strokeColor;
                if (st.strokeWidth !== undefined) td.strokeWidth = st.strokeWidth;
                if (st.strokeOverFill !== undefined) td.strokeOverFill = st.strokeOverFill;
            }
        } catch (e) {}
        try { if (st.tracking !== undefined) td.tracking = st.tracking; } catch (e) {}
        try { if (st.autoLeading !== undefined) td.autoLeading = st.autoLeading; } catch (e) {}
        try { if (st.leading !== undefined && !st.autoLeading) td.leading = st.leading; } catch (e) {}
        try { if (st.allCaps !== undefined) td.allCaps = st.allCaps; } catch (e) {}
        try { if (st.fauxBold !== undefined) td.fauxBold = st.fauxBold; } catch (e) {}
        try { if (st.fauxItalic !== undefined) td.fauxItalic = st.fauxItalic; } catch (e) {}
    }

    // Applique un style à un calque texte (gère aussi les images clés de texte source)
    function applyStyleToLayer(layer, st) {
        var prop = getTextDocProp(layer);
        var td;
        if (prop.numKeys > 0) {
            for (var k = 1; k <= prop.numKeys; k++) {
                td = prop.keyValue(k);
                setStyle(td, st);
                prop.setValueAtKey(k, td);
            }
        } else {
            td = prop.value;
            setStyle(td, st);
            prop.setValue(td);
        }
    }

    // Applique un preset (style ou .ffx) à une liste de calques texte
    function applyPresetToLayers(comp, preset, layers) {
        if (!layers.length) return;
        if (preset.type === "style") {
            for (var i = 0; i < layers.length; i++) applyStyleToLayer(layers[i], preset.style);
        } else if (preset.type === "ffx") {
            var f = new File(preset.path);
            if (!f.exists) throw new Error("Fichier introuvable :\n" + preset.path);
            // applyPreset s'applique à tous les calques sélectionnés de la compo
            deselectAll(comp);
            for (var j = 0; j < layers.length; j++) layers[j].selected = true;
            layers[0].applyPreset(f);
        }
    }

    // =====================================================================
    // Calque d'effet
    // =====================================================================

    function createAdjustmentFor(comp, srcLayer, placeAbove) {
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
        if (placeAbove) adj.moveBefore(srcLayer);
        return adj;
    }

    // =====================================================================
    // Paroles
    // =====================================================================

    // Marqueurs : ceux du calque sélectionné (ex. la musique) s'il en a, sinon ceux de la composition
    function getMarkers(comp) {
        var sel = comp.selectedLayers;
        var i, m, times = [];
        for (i = 0; i < sel.length; i++) {
            m = sel[i].property("ADBE Marker");
            if (m && m.numKeys > 0) {
                for (var k = 1; k <= m.numKeys; k++) times.push(m.keyTime(k));
                return { times: times, end: sel[i].outPoint, source: "le calque « " + sel[i].name + " »" };
            }
        }
        m = comp.markerProperty;
        if (m && m.numKeys > 0) {
            for (var k2 = 1; k2 <= m.numKeys; k2++) times.push(m.keyTime(k2));
            return { times: times, end: comp.duration, source: "la composition" };
        }
        return null;
    }

    function centerTextLayer(layer, comp, yRatio) {
        var r = layer.sourceRectAtTime(layer.inPoint, false);
        var tr = layer.property("ADBE Transform Group");
        tr.property("ADBE Anchor Point").setValue([r.left + r.width / 2, r.top + r.height / 2]);
        tr.property("ADBE Position").setValue([comp.width / 2, comp.height * yRatio]);
    }

    function createLyrics(comp, rawText, fontSize, yRatio, preset) {
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
            if (preset && preset.type === "style") setStyle(td, preset.style);
            td.justification = ParagraphJustification.CENTER_JUSTIFY;
            prop.setValue(td);

            t.inPoint = start;
            t.outPoint = end;
            t.label = 9;
            centerTextLayer(t, comp, yRatio);
            created.push(t);
        }

        if (preset && preset.type === "ffx" && created.length) {
            applyPresetToLayers(comp, preset, created);
        }

        var msg = created.length + " texte(s) créé(s) depuis les marqueurs de " + mk.source + ".";
        if (lines.length > mk.times.length) {
            msg += "\n" + (lines.length - mk.times.length) + " ligne(s) sans marqueur ignorée(s).";
        }
        return msg;
    }

    // =====================================================================
    // Fenêtre « + Preset »
    // =====================================================================

    function askNewPreset() {
        var dlg = new Window("dialog", "Nouveau preset de texte");
        dlg.orientation = "column";
        dlg.alignChildren = ["fill", "top"];

        var gName = dlg.add("group");
        gName.add("statictext", undefined, "Nom :");
        var etName = gName.add("edittext", undefined, "");
        etName.characters = 24;

        var gType = dlg.add("panel", undefined, "Source du preset");
        gType.alignChildren = ["left", "top"];
        var rbStyle = gType.add("radiobutton", undefined, "Style du texte sélectionné (police, taille, couleur, contour…)");
        var rbFfx = gType.add("radiobutton", undefined, "Fichier de preset d'animation (.ffx)");
        rbStyle.value = true;

        var gBtn = dlg.add("group");
        gBtn.alignment = ["right", "top"];
        gBtn.add("button", undefined, "Annuler", { name: "cancel" });
        gBtn.add("button", undefined, "OK", { name: "ok" });

        if (dlg.show() !== 1) return null;

        var name = trim(etName.text);

        if (rbStyle.value) {
            var comp = getActiveComp();
            var layer = null;
            if (comp) {
                var sel = comp.selectedLayers;
                for (var i = 0; i < sel.length; i++) {
                    if (sel[i] instanceof TextLayer) { layer = sel[i]; break; }
                }
            }
            if (!layer) { alert("Sélectionne d'abord un calque texte dont tu veux copier le style."); return null; }
            var style = captureStyle(getTextDocProp(layer).value);
            if (!name) name = (style.font || "Style") + " " + Math.round(style.fontSize || 0) + "px";
            return { name: name, type: "style", style: style };
        }

        var filter = isWindows()
            ? "Presets After Effects:*.ffx"
            : function (f) { return (f instanceof Folder) || /\.ffx$/i.test(f.name); };
        var f = File.openDialog("Choisis un preset .ffx", filter);
        if (!f) return null;
        if (!name) name = decodeURI(f.name).replace(/\.ffx$/i, "");
        return { name: name, type: "ffx", path: f.fsName };
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
        var chkAbove = pAdj.add("checkbox", undefined, "Placer juste au-dessus du calque");
        chkAbove.value = true;

        // ---------- Paroles ----------
        var pLyr = win.add("panel", undefined, "Paroles");
        pLyr.alignChildren = ["fill", "top"];
        pLyr.margins = [10, 15, 10, 10];
        pLyr.add("statictext", undefined, "Une ligne = un texte, calé sur un marqueur :");
        var etLyrics = pLyr.add("edittext", undefined, "", { multiline: true, scrolling: true, wantReturn: true });
        etLyrics.preferredSize = [260, 120];

        var gOpt = pLyr.add("group");
        gOpt.add("statictext", undefined, "Position :");
        var ddPos = gOpt.add("dropdownlist", undefined, [POSITIONS[0].label, POSITIONS[1].label, POSITIONS[2].label]);
        ddPos.selection = 0;
        gOpt.add("statictext", undefined, "Taille :");
        var etSize = gOpt.add("edittext", undefined, "70");
        etSize.characters = 4;

        var chkLyrPreset = pLyr.add("checkbox", undefined, "Appliquer le preset choisi ci-dessous");
        chkLyrPreset.value = false;

        var btnLyrics = pLyr.add("button", undefined, "Créer les paroles");

        // ---------- Presets ----------
        var pPre = win.add("panel", undefined, "Presets de texte");
        pPre.alignChildren = ["fill", "top"];
        pPre.margins = [10, 15, 10, 10];
        var gPre = pPre.add("group");
        gPre.alignChildren = ["fill", "center"];
        var ddPreset = gPre.add("dropdownlist", undefined, []);
        ddPreset.alignment = ["fill", "center"];
        ddPreset.preferredSize.width = 150;
        var btnAddPreset = gPre.add("button", undefined, "+ Preset");
        btnAddPreset.alignment = ["right", "center"];
        var btnDelPreset = gPre.add("button", undefined, "–");
        btnDelPreset.alignment = ["right", "center"];
        btnDelPreset.preferredSize.width = 28;
        btnDelPreset.helpTip = "Supprimer le preset choisi";
        var btnApply = pPre.add("button", undefined, "Appliquer aux textes sélectionnés");

        var status = win.add("statictext", undefined, "", { multiline: true });
        status.preferredSize.height = 34;

        // ---------- Logique ----------

        function refreshPresetList(selectIndex) {
            ddPreset.removeAll();
            for (var i = 0; i < presets.length; i++) {
                var tag = (presets[i].type === "ffx") ? " [ffx]" : "";
                ddPreset.add("item", presets[i].name + tag);
            }
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
                    createAdjustmentFor(comp, targets[j], chkAbove.value);
                    count++;
                }
            } catch (e) {
                alert("Erreur : " + e.message);
            } finally {
                app.endUndoGroup();
            }
            status.text = count + " calque(s) d'effet créé(s).";
        };

        btnLyrics.onClick = function () {
            var comp = getActiveComp();
            if (!comp) { alert("Ouvre d'abord une composition."); return; }
            var size = parseFloat(etSize.text);
            if (isNaN(size) || size <= 0) size = 70;
            var preset = chkLyrPreset.value ? selectedPreset() : null;
            if (chkLyrPreset.value && !preset) { alert("Aucun preset choisi : ajoute-en un avec « + Preset »."); return; }

            app.beginUndoGroup("Créer les paroles");
            try {
                status.text = createLyrics(comp, etLyrics.text, size, POSITIONS[ddPos.selection.index].y, preset);
            } catch (e) {
                alert(e.message);
            } finally {
                app.endUndoGroup();
            }
        };

        btnAddPreset.onClick = function () {
            var p = askNewPreset();
            if (!p) return;
            presets.push(p);
            savePresets();
            refreshPresetList(presets.length - 1);
            status.text = "Preset « " + p.name + " » ajouté.";
        };

        btnDelPreset.onClick = function () {
            if (!ddPreset.selection) return;
            var idx = ddPreset.selection.index;
            var p = presets[idx];
            if (!confirm("Supprimer le preset « " + p.name + " » ?")) return;
            presets.splice(idx, 1);
            savePresets();
            refreshPresetList(idx - 1);
            status.text = "Preset supprimé.";
        };

        btnApply.onClick = function () {
            var comp = getActiveComp();
            if (!comp) { alert("Ouvre d'abord une composition."); return; }
            var preset = selectedPreset();
            if (!preset) { alert("Ajoute d'abord un preset avec « + Preset »."); return; }

            var sel = comp.selectedLayers;
            var texts = [];
            for (var i = 0; i < sel.length; i++) {
                if (sel[i] instanceof TextLayer) texts.push(sel[i]);
            }
            if (!texts.length) { alert("Sélectionne au moins un calque texte."); return; }

            app.beginUndoGroup("Appliquer preset texte");
            try {
                applyPresetToLayers(comp, preset, texts);
                status.text = "Preset « " + preset.name + " » appliqué à " + texts.length + " texte(s).";
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
