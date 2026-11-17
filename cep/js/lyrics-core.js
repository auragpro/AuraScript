// AuraScript — calcul des paroles (alignement, calage sur le signal) — partagé avec l'ancienne version
(function (G) {
    var VOICE_FILTER = "aformat=channel_layouts=stereo,aresample=16000,dialoguenhance=original=0:enhance=3," +
        "pan=mono|c0=FC,highpass=f=200,lowpass=f=3000,asetnsamples=n=160:p=0," +
        "astats=metadata=1:reset=1:measure_overall=RMS_level:measure_perchannel=none," +
        "aspectralstats=win_size=512:measure=flatness,ametadata=print:file=env.txt";

    function trim(s) {
        return String(s).replace(/^\s+|\s+$/g, "");
    }

    function stripAccents(s) {
        var from = "àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝœŒæÆ";
        var to = "aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUYoOaA";
        var out = "";
        for (var i = 0; i < s.length; i++) {
            var c = s.charAt(i), k = from.indexOf(c);
            if (k >= 0) c = to.charAt(k);
            if (c.charCodeAt(0) > 126) c = " ";
            out += c;
        }
        return out;
    }

    function promptFromLyrics(text) {
        var s = stripAccents(String(text || "")).replace(/[\r\n\t]+/g, " ").replace(/["%^&|<>!]/g, " ").replace(/\s+/g, " ");
        s = trim(s);
        if (s.length > 600) s = s.substring(0, 600);
        return s;
    }

    function unescapeJsonText(s) {
        return s.replace(/\\u([0-9a-fA-F]{4})/g, function (a, h) { return String.fromCharCode(parseInt(h, 16)); })
            .replace(/\\n/g, " ").replace(/\\t/g, " ").replace(/\\"/g, "\"").replace(/\\\//g, "/").replace(/\\\\/g, "\\");
    }

    function dtwStart(chunk, fallback) {
        var re = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"((?:(?!"text")[\s\S])*?)"t_dtw"\s*:\s*(-?[\d.]+)/g, m;
        while ((m = re.exec(chunk)) !== null) {
            var tx = unescapeJsonText(m[1]);
            if (/^\s*\[_/.test(tx) || !trim(tx)) continue; // tokens spéciaux [_BEG_], [_TT_..]
            var t = parseFloat(m[3]);
            if (isNaN(t) || t < 0) return fallback;
            t = t / 100;
            if (Math.abs(t - fallback) > 1.5) return fallback; // valeur aberrante : on garde l'estimation normale
            return (t + fallback) / 2;
        }
        return fallback;
    }

    function readWhisperWords(txt) {
        txt = String(txt || "");
        var re = /"offsets"\s*:\s*\{\s*"from"\s*:\s*(\d+)\s*,\s*"to"\s*:\s*(\d+)\s*\}\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
        var segs = [], m;
        while ((m = re.exec(txt)) !== null) segs.push({ from: parseInt(m[1], 10) / 1000, text: m[3], start: m.index, end: re.lastIndex });
        var words = [];
        for (var si = 0; si < segs.length; si++) {
            var sg = segs[si];
            var chunkEnd = (si + 1 < segs.length) ? segs[si + 1].start : txt.length;
            m = [null, null, null, sg.text];
            var w = trim(unescapeJsonText(m[3]));
            if (!w) continue;
            if (/[\[\]\(\)\*♪♫]/.test(w)) continue; // [Musique], (rires), ♪
            w = w.replace(/^[^\wÀ-ÿ']+|[^\wÀ-ÿ']+$/g, "");
            if (!w) continue;
            words.push({ t: dtwStart(txt.substring(sg.end, chunkEnd), sg.from), w: w });
        }
        return words;
    }

    function readVoiceOnsets(txt, offsetSec) {
        if (!txt) return [];
        var blocks = txt.split("frame:");
        var T = [], S0 = [], i;
        for (i = 1; i < blocks.length; i++) {
            var b = blocks[i];
            var mt = /pts_time:([\d.]+)/.exec(b);
            var mr = /RMS_level=(-?[\d.]+|-inf)/.exec(b);
            var mf = /flatness=([\d.eE+\-]+)/.exec(b);
            if (!mt) continue;
            var e = (!mr || mr[1] === "-inf") ? -120 : Math.max(-120, parseFloat(mr[1]));
            var f = mf ? parseFloat(mf[1]) : 1;
            if (isNaN(f)) f = 1;
            T.push(parseFloat(mt[1]) + offsetSec);
            S0.push(Math.max(0, (e + 60) / 60) * (1 - Math.min(1, f * 1.5)));
        }
        var n = T.length;
        if (n < 10) return [];
        var S = [], O = [], k, mx = 0;
        for (i = 0; i < n; i++) {
            var a = Math.max(0, i - 1), z = Math.min(n - 1, i + 1), sum = 0;
            for (k = a; k <= z; k++) sum += S0[k];
            S.push(sum / (z - a + 1));
        }
        for (i = 0; i < n; i++) {
            var mn = S[i];
            for (k = Math.max(0, i - 4); k < i; k++) if (S[k] < mn) mn = S[k];
            O.push(Math.max(0, S[i] - mn));
            if (O[i] > mx) mx = O[i];
        }
        if (mx <= 0) return [];
        var ons = [];
        for (i = 2; i < n - 2; i++) {
            var isPeak = true;
            for (k = i - 2; k <= i + 2; k++) if (O[k] > O[i]) { isPeak = false; break; }
            if (!isPeak || O[i] <= 0.08 * mx) continue;
            var j = i;
            for (k = Math.max(0, i - 8); k <= i; k++) if (S[k] < S[j]) j = k;
            var q = j;
            while (q < i && S[q] < S[j] + 0.15 * (S[i] - S[j])) q++;
            if (ons.length && T[q] <= ons[ons.length - 1].t) continue;
            ons.push({ t: T[q], s: O[i] / mx });
        }
        return ons;
    }

    function bestOnset(ons, t, lo, hi) {
        var best = null, bs = 0;
        for (var k = 0; k < ons.length; k++) {
            var o = ons[k];
            if (o.t <= lo || o.t >= hi || Math.abs(o.t - t) > 0.35) continue;
            var d = (o.t - t) / 0.3;
            var sc = o.s * Math.exp(-d * d);
            if (sc > bs) { bs = sc; best = o.t; }
        }
        return best;
    }

    function snapWordsToOnsets(words, ons) {
        if (!ons || !ons.length || !words.length) return 0;
        var n = words.length, i, snapped = 0;
        var orig = [], isM = [];
        for (i = 0; i < n; i++) { orig.push(words[i].t); isM.push(words[i].m !== false); }

        // 1) mots reconnus
        var prev = -1;
        for (i = 0; i < n; i++) {
            if (!isM[i]) continue;
            var b = bestOnset(ons, orig[i], prev + 0.06, 1e9);
            var v = (b !== null) ? b : orig[i];
            if (b !== null) snapped++;
            if (v <= prev + 0.04) v = prev + 0.04;
            words[i].t = v;
            prev = v;
        }

        // 2) mots devinés, entre leurs voisins reconnus
        for (i = 0; i < n; i++) {
            if (isM[i]) continue;
            var pi = i - 1, ni = i + 1;
            while (ni < n && !isM[ni]) ni++;
            var lo = (pi >= 0) ? words[pi].t : -1;
            var hi = (ni < n) ? words[ni].t : 1e9;
            // estimation recalée selon le déplacement des voisins reconnus
            var est = orig[i];
            var pa = i - 1; while (pa >= 0 && !isM[pa]) pa--;
            if (pa >= 0 && ni < n && orig[ni] > orig[pa]) {
                var r = (orig[i] - orig[pa]) / (orig[ni] - orig[pa]);
                est = words[pa].t + r * (words[ni].t - words[pa].t);
            } else if (pa >= 0) {
                est = orig[i] + (words[pa].t - orig[pa]);
            } else if (ni < n) {
                est = orig[i] + (words[ni].t - orig[ni]);
            }
            var b2 = bestOnset(ons, est, lo + 0.06, hi - 0.06);
            var v2 = (b2 !== null) ? b2 : est;
            if (b2 !== null) snapped++;
            if (v2 <= lo + 0.04) v2 = lo + 0.04;
            if (hi < 1e9 && v2 >= hi - 0.04) v2 = (lo + hi) / 2;
            words[i].t = v2;
        }
        return snapped;
    }

    function normWord(w) {
        return stripAccents(String(w)).toLowerCase().replace(/[^a-z0-9]/g, "");
    }

    function levenshtein(a, b) {
        if (a === b) return 0;
        var la = a.length, lb = b.length, i, j;
        if (!la) return lb;
        if (!lb) return la;
        var prev = [], cur = [];
        for (j = 0; j <= lb; j++) prev[j] = j;
        for (i = 1; i <= la; i++) {
            cur = [i];
            for (j = 1; j <= lb; j++) {
                var c = (a.charAt(i - 1) === b.charAt(j - 1)) ? 0 : 1;
                cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
            }
            prev = cur;
        }
        return prev[lb];
    }

    function wordSim(a, b) {
        if (!a || !b) return 0;
        var m = Math.max(a.length, b.length);
        return 1 - levenshtein(a, b) / m;
    }

    function alignLyrics(userWords, heard, t0, t1) {
        var U = [], H = [], i, j;
        for (i = 0; i < userWords.length; i++) U.push(normWord(userWords[i]));
        for (j = 0; j < heard.length; j++) {
            if (heard[j].t >= t0 - 1 && heard[j].t <= t1 + 1) H.push({ n: normWord(heard[j].w), t: heard[j].t });
        }
        var n = U.length, m = H.length;
        var times = [];
        for (i = 0; i < n; i++) times.push(null);

        // programmation dynamique : meilleure correspondance dans l'ordre (mots ressemblants)
        if (m) {
            var dp = [], bt = [];
            for (i = 0; i <= n; i++) { dp.push([]); bt.push([]); for (j = 0; j <= m; j++) { dp[i].push(0); bt[i].push(0); } }
            for (i = 1; i <= n; i++) {
                for (j = 1; j <= m; j++) {
                    var best = dp[i - 1][j], dir = 1;
                    if (dp[i][j - 1] > best) { best = dp[i][j - 1]; dir = 2; }
                    var s = wordSim(U[i - 1], H[j - 1].n);
                    if (s >= 0.5 && dp[i - 1][j - 1] + s > best) { best = dp[i - 1][j - 1] + s; dir = 3; }
                    dp[i][j] = best;
                    bt[i][j] = dir;
                }
            }
            i = n; j = m;
            while (i > 0 && j > 0) {
                if (bt[i][j] === 3) { times[i - 1] = H[j - 1].t; i--; j--; }
                else if (bt[i][j] === 1) i--;
                else j--;
            }
        }

        var matched = 0, matchedFlags = [];
        for (i = 0; i < n; i++) { matchedFlags.push(times[i] !== null); if (times[i] !== null) matched++; }
        if (!matched) return { words: null, matched: 0 };

        // mots non trouvés : répartis entre leurs voisins trouvés (selon la longueur des mots)
        var step = 0.25;
        var first = -1, last = -1;
        for (i = 0; i < n; i++) if (times[i] !== null) { if (first < 0) first = i; last = i; }
        for (i = first - 1; i >= 0; i--) times[i] = Math.max(t0, times[i + 1] - step);
        for (i = last + 1; i < n; i++) times[i] = Math.min(t1 - 0.05, times[i - 1] + step);
        i = first;
        while (i < last) {
            var k = i + 1;
            while (times[k] === null) k++;
            if (k > i + 1) {
                var total = 0, acc = 0, q;
                for (q = i; q < k; q++) total += Math.max(1, U[q].length);
                for (q = i + 1; q < k; q++) {
                    acc += Math.max(1, U[q - 1].length);
                    times[q] = times[i] + (times[k] - times[i]) * acc / total;
                }
            }
            i = k;
        }

        var out = [], prev = -1;
        for (i = 0; i < n; i++) {
            var t = times[i];
            if (t < t0) t = t0;
            if (t > t1 - 0.04) t = t1 - 0.04;
            if (t <= prev + 0.04) t = prev + 0.04;
            prev = t;
            out.push({ t: t, w: userWords[i], m: matchedFlags[i] });
        }
        return { words: out, matched: matched };
    }

    G.LyricsCore = { VOICE_FILTER: VOICE_FILTER, trim: trim, promptFromLyrics: promptFromLyrics, readWhisperWords: readWhisperWords, readVoiceOnsets: readVoiceOnsets, snapWordsToOnsets: snapWordsToOnsets, alignLyrics: alignLyrics };
})(window);
