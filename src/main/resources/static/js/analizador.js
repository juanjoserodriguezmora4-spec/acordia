/*
 * ACORDIA - Analizador de audio (versión 2)
 * ==========================================
 * Detecta el tempo, los pulsos, el inicio de cada compás y los acordes de una canción.
 *
 * Pasos:
 *   1. Golpes: envolvente de "energía nueva" cada 12 ms (flujo espectral).
 *   2. Tempo: autocorrelación de los golpes + revisión del tempo doble y la mitad.
 *   3. Pulsos: programación dinámica (Ellis, 2007): cada pulso en un golpe fuerte y a ritmo parejo.
 *   4. Espectro armónico: FFT larga (graves) y mediana (agudos), con un filtro de mediana en el tiempo
 *      que borra los golpes de batería y deja solo las notas que se sostienen.
 *   5. Picos espectrales → afinación → cromagrama (12 notas) por pulso, separado en agudos y bajo.
 *   6. Compás: el tiempo 1 es donde más cambia la armonía y donde suenan bajo y bombo.
 *   7. Tonalidad (Krumhansl) y comparación con plantillas de los 24 acordes mayores y menores.
 *   8. Viterbi: la secuencia de acordes más probable, usando la matriz de cambios aprendida de
 *      Chordonomicon, la preferencia por acordes de la tonalidad y la posición en el compás
 *      (es más probable cambiar de acorde en el tiempo 1 que en el 2).
 *
 * Funciona en el navegador (Web Worker) y en Node.js (pruebas).
 */
(function (global) {
  'use strict';

  const NOTAS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const ETIQUETAS = NOTAS.concat(NOTAS.map(n => n + 'm')); // 0-11 mayores, 12-23 menores
  const SIN_ACORDE = 'N';
  const mod = (a, n) => ((a % n) + n) % n;

  // ================================================================ utilidades
  function crearFFT(n) {
    const niveles = Math.round(Math.log2(n));
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0, x = i;
      for (let b = 0; b < niveles; b++) { r = (r << 1) | (x & 1); x >>= 1; }
      rev[i] = r;
    }
    const cos = new Float64Array(n / 2), sen = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sen[i] = Math.sin(2 * Math.PI * i / n); }
    return function fft(re, im) {
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
      }
      for (let tam = 2; tam <= n; tam <<= 1) {
        const mitad = tam >> 1, paso = n / tam;
        for (let i = 0; i < n; i += tam) {
          for (let j = i, k = 0; j < i + mitad; j++, k += paso) {
            const l = j + mitad;
            const tre = re[l] * cos[k] + im[l] * sen[k];
            const tim = im[l] * cos[k] - re[l] * sen[k];
            re[l] = re[j] - tre; im[l] = im[j] - tim;
            re[j] += tre; im[j] += tim;
          }
        }
      }
    };
  }

  function ventanaHann(n) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
    return w;
  }

  function normalizar(v) {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i] * v[i];
    s = Math.sqrt(s) || 1;
    const r = new Float64Array(v.length);
    for (let i = 0; i < v.length; i++) r[i] = v[i] / s;
    return r;
  }

  function coseno(a, b) {
    let s = 0, na = 0, nb = 0;
    for (let i = 0; i < 12; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return s / (Math.sqrt(na * nb) || 1);
  }

  function percentil(arr, p) {
    const o = Array.from(arr).sort((a, b) => a - b);
    return o.length ? o[Math.min(o.length - 1, Math.floor(o.length * p))] : 0;
  }

  // ================================================================ 1. Golpes (envolvente fina)
  /**
   * Flujo espectral cada ~12 ms con ventana de ~46 ms. Devuelve la envolvente total y la de graves
   * (bombo y bajo, útil para encontrar el tiempo 1).
   */
  function envolventeGolpes(muestras, sr, avisar) {
    const W = 1 << Math.round(Math.log2(sr * 0.046));
    const h = W >> 2;
    const n = Math.max(0, Math.floor((muestras.length - W) / h) + 1);
    const fft = crearFFT(W), w = ventanaHann(W);
    const re = new Float64Array(W), im = new Float64Array(W);
    let ant = new Float64Array(W / 2), act = new Float64Array(W / 2);
    const total = new Float32Array(n), graves = new Float32Array(n);
    const kGrave = Math.max(2, Math.round(160 * W / sr));
    const kMax = Math.min(W / 2, Math.round(5000 * W / sr));
    const cada = Math.max(1, Math.floor(n / 10));
    for (let t = 0; t < n; t++) {
      const ini = t * h;
      for (let i = 0; i < W; i++) { re[i] = muestras[ini + i] * w[i]; im[i] = 0; }
      fft(re, im);
      let f = 0, g = 0;
      for (let k = 1; k < kMax; k++) {
        const l = Math.log(1 + 100 * Math.sqrt(re[k] * re[k] + im[k] * im[k]));
        act[k] = l;
        const d = l - ant[k];
        if (d > 0 && t > 0) { f += d; if (k <= kGrave) g += d; }
      }
      total[t] = f; graves[t] = g;
      const tmp = ant; ant = act; act = tmp;
      if (avisar && t % cada === 0) avisar(0.02 + 0.13 * t / n, 'Escuchando el ritmo');
    }
    return { total, graves, fps: sr / h, tiempo: (t) => (t * h + W / 2) / sr, n };
  }

  /** Quita la tendencia (promedio local de ~0.5 s), deja solo lo positivo y normaliza. */
  function realzar(env, fps) {
    const n = env.length, o = new Float64Array(n);
    const radio = Math.max(1, Math.round(fps * 0.25));
    const pref = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pref[i + 1] = pref[i] + env[i];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - radio), b = Math.min(n, i + radio + 1);
      o[i] = Math.max(0, env[i] - (pref[b] - pref[a]) / (b - a));
    }
    let s = 0, s2 = 0;
    for (let i = 0; i < n; i++) { s += o[i]; s2 += o[i] * o[i]; }
    const desv = Math.sqrt(Math.max(1e-12, s2 / n - (s / n) ** 2));
    for (let i = 0; i < n; i++) o[i] /= desv;
    return o;
  }

  // ================================================================ 2-3. Tempo y pulsos
  function autocorrelacion(o, maxLag) {
    const n = o.length, acf = new Float64Array(maxLag + 2);
    for (let lag = 1; lag <= maxLag + 1 && lag < n; lag++) {
      let s = 0;
      for (let i = lag; i < n; i++) s += o[i] * o[i - lag];
      acf[lag] = s / (n - lag);
    }
    return acf;
  }

  /** Periodo (en cuadros) más probable, con preferencia por tempos entre 70 y 160 BPM. */
  function periodoInicial(acf, fps, bpmSugerido) {
    let minBpm = 50, maxBpm = 210, centro = 105, ancho = 0.75;
    if (bpmSugerido) { minBpm = bpmSugerido * 0.85; maxBpm = bpmSugerido * 1.15; centro = bpmSugerido; ancho = 0.2; }
    const minLag = Math.max(2, Math.floor(fps * 60 / maxBpm));
    const maxLag = Math.min(acf.length - 2, Math.ceil(fps * 60 / minBpm));
    let mejor = -Infinity, mejorLag = Math.round(fps * 60 / centro);
    for (let lag = minLag; lag <= maxLag; lag++) {
      const bpm = 60 * fps / lag;
      const pref = Math.exp(-0.5 * Math.pow(Math.log2(bpm / centro) / ancho, 2));
      // Saliencia: el periodo y sus múltiplos (si el pulso es correcto, los múltiplos también "suenan").
      const v = (acf[lag] + 0.5 * (acf[2 * lag] || 0) + 0.25 * (acf[3 * lag] || 0)) * pref;
      if (v > mejor) { mejor = v; mejorLag = lag; }
    }
    return refinarLag(acf, mejorLag);
  }

  function refinarLag(acf, lag) {
    if (lag <= 1 || lag >= acf.length - 1) return lag;
    const a = acf[lag - 1], b = acf[lag], c = acf[lag + 1];
    const den = a - 2 * b + c;
    return den < 0 ? lag + 0.5 * (a - c) / den : lag;
  }

  /** Programación dinámica de Ellis (2007). */
  function seguirPulsos(o, periodo, ajuste = 100) {
    const n = o.length;
    const puntaje = new Float64Array(n);
    const previo = new Int32Array(n).fill(-1);
    for (let t = 0; t < n; t++) {
      const desde = Math.max(0, Math.round(t - 2 * periodo));
      const hasta = Math.round(t - periodo / 2);
      let mejor = -Infinity, mejorP = -1;
      for (let p = desde; p <= hasta; p++) {
        const l = Math.log((t - p) / periodo);
        const v = puntaje[p] - ajuste * l * l;
        if (v > mejor) { mejor = v; mejorP = p; }
      }
      puntaje[t] = o[t] + (mejorP >= 0 && mejor > 0 ? mejor : 0);
      previo[t] = mejor > 0 ? mejorP : -1;
    }
    let t = n - 1, mejor = -Infinity;
    for (let i = Math.max(0, Math.floor(n - periodo)); i < n; i++) if (puntaje[i] > mejor) { mejor = puntaje[i]; t = i; }
    const pulsos = [];
    while (t >= 0) { pulsos.push(t); t = previo[t]; }
    return pulsos.reverse();
  }

  /**
   * Rejilla de pulsos perfectamente pareja con un tempo exacto (canciones grabadas con metrónomo).
   * Solo se busca la fase: dónde cae el primer pulso para que los pulsos coincidan con los golpes.
   */
  function rejillaFija(o, periodo) {
    const n = o.length;
    const fuerza = (k) => Math.max(o[k] || 0, o[k - 1] || 0, o[k + 1] || 0);
    let mejorFase = 0, mejor = -Infinity;
    for (let fase = 0; fase < periodo; fase += 0.25) {
      let s = 0;
      for (let t = fase; t < n; t += periodo) s += fuerza(Math.round(t));
      if (s > mejor) { mejor = s; mejorFase = fase; }
    }
    const pulsos = [];
    for (let t = mejorFase; t < n; t += periodo) pulsos.push(t);
    return pulsos;
  }

  /**
   * Tempo fino a partir de los pulsos encontrados: recta de mínimos cuadrados (momento de cada pulso
   * contra su número), quitando los pulsos que se salen. Con cientos de pulsos el error queda en
   * centésimas de BPM, mucho mejor que el pico de la autocorrelación (que solo tiene ~1 BPM de resolución).
   * @returns {{periodo, origen}} en cuadros, o null si hay muy pocos pulsos
   */
  function ajustarTempo(indices, periodo) {
    if (indices.length < 8) return null;
    const num = [0];
    for (let k = 1; k < indices.length; k++) num.push(num[k - 1] + Math.max(1, Math.round((indices[k] - indices[k - 1]) / periodo)));
    let usar = indices.map((_, k) => k), p = periodo, a = indices[0];
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      if (usar.length < 8) break;
      let mn = 0, mt = 0;
      for (const k of usar) { mn += num[k]; mt += indices[k]; }
      mn /= usar.length; mt /= usar.length;
      let cov = 0, vari = 0;
      for (const k of usar) { cov += (num[k] - mn) * (indices[k] - mt); vari += (num[k] - mn) ** 2; }
      if (vari <= 0) break;
      p = cov / vari; a = mt - p * mn;
      const tol = periodo * (vuelta === 0 ? 0.35 : 0.2);
      usar = usar.filter(k => Math.abs(indices[k] - (a + p * num[k])) < tol);
    }
    return { periodo: p, origen: a };
  }

  /**
   * ¿Los pulsos encontrados siguen una rejilla pareja? Devuelve qué parte cae cerca (±10 % del periodo)
   * y cuánto se corre la rejilla de un tramo a otro de la canción (si la canción acelera o frena, los
   * pulsos se van alejando de la rejilla aunque al principio coincidan).
   */
  function coincidenciaRejilla(indices, rejilla, periodo) {
    if (!indices.length || !rejilla.length) return { parte: 0, deriva: Infinity };
    const desde = Math.floor(indices.length * 0.05), hasta = Math.ceil(indices.length * 0.95);
    let j = 0, bien = 0, total = 0;
    const dif = [];
    for (let k = desde; k < hasta; k++) {
      const t = indices[k];
      while (j + 1 < rejilla.length && Math.abs(rejilla[j + 1] - t) <= Math.abs(rejilla[j] - t)) j++;
      total++;
      const d = t - rejilla[j];
      if (Math.abs(d) <= periodo * 0.1) { bien++; dif.push({ k, d }); }
    }
    const mediana = (v) => { if (!v.length) return 0; const o = v.slice().sort((a, b) => a - b); return o[o.length >> 1]; };
    // La canción se parte en 8 tramos: en cada uno, cuánto se corren (mediana) los pulsos de la rejilla.
    const tramos = 8, largo = (hasta - desde) / tramos, corrimientos = [];
    for (let q = 0; q < tramos; q++) {
      const d = dif.filter(x => x.k >= desde + q * largo && x.k < desde + (q + 1) * largo).map(x => x.d);
      if (d.length >= 3) corrimientos.push(mediana(d));
    }
    const deriva = corrimientos.length ? (Math.max(...corrimientos) - Math.min(...corrimientos)) / periodo : Infinity;
    return { parte: total ? bien / total : 0, deriva };
  }

  /**
   * La mayoría de las canciones de estudio se graban con metrónomo a un tempo entero (188, no 188,4).
   * Se prueba una rejilla pareja con el tempo fino redondeado: si casi todos los pulsos encontrados caen
   * sobre ella, se usa esa rejilla (pulsos perfectamente parejos, sin desfase al final de la canción).
   * Si la canción acelera o frena (en vivo), se dejan los pulsos encontrados y solo se redondea el número.
   */
  function tempoFinal(o, fps, indices, periodo) {
    const ajuste = ajustarTempo(indices, periodo);
    if (!ajuste) return { indices, periodo, bpm: Math.round(60 * fps / periodo), pareja: false };
    const fino = 60 * fps / ajuste.periodo;
    const candidatos = [Math.round(fino)];
    if (Math.abs(fino - Math.round(fino)) > 0.15) candidatos.push(Math.round(fino * 2) / 2); // por ejemplo 92,5
    for (const bpm of candidatos) {
      const p = 60 * fps / bpm;
      const rejilla = rejillaFija(o, p);
      const c = coincidenciaRejilla(indices, rejilla, p);
      if (c.parte >= 0.9 && c.deriva <= 0.07) return { indices: rejilla, periodo: p, bpm, pareja: true };
    }
    return { indices, periodo: ajuste.periodo, bpm: Math.round(fino), pareja: false };
  }

  function promedioEn(o, indices) {
    let s = 0, c = 0;
    for (const i of indices) {
      const k = Math.round(i);
      if (k < 0 || k >= o.length) continue;
      s += Math.max(o[k], o[k - 1] || 0, o[k + 1] || 0); c++;
    }
    return c ? s / c : 0;
  }

  /**
   * Elige entre el tempo encontrado, el doble y la mitad (el error más común de cualquier detector de tempo).
   * Puntaje = fuerza promedio de los golpes en los pulsos × preferencia por tempos cercanos a 115 BPM.
   * Los parámetros se ajustaron con 32 canciones sintéticas de 60 a 172 BPM: acierta de 80 a 150 BPM;
   * fuera de ese rango puede dar el doble o la mitad, y el usuario lo corrige con los botones ×2 / ÷2.
   */
  function elegirTempo(o, fps, periodo, bpmSugerido) {
    if (bpmSugerido) return periodo;
    const bpm = (p) => 60 * fps / p;
    let mejor = periodo, mejorPuntaje = -Infinity;
    for (const p of [periodo, periodo / 2, periodo * 2]) {
      const b = bpm(p);
      if (b < 50 || b > 210) continue;
      const pul = seguirPulsos(o, p);
      if (pul.length < 4) continue;
      const fuerza = promedioEn(o, pul);
      const puntaje = fuerza * Math.exp(-0.5 * Math.pow(Math.log2(b / 115) / 0.3, 2));
      if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = p; }
    }
    return mejor;
  }

  // ================================================================ 4-5. Espectro armónico y croma
  /**
   * Para cada cuadro (cada ~46 ms) guarda los picos del espectro armónico:
   * graves con FFT de ~0.37 s (38-265 Hz) y agudos con FFT de ~0.19 s (185-2000 Hz).
   * Antes de buscar picos se aplica una mediana en el tiempo a cada frecuencia: así los golpes
   * (que duran poco) desaparecen y quedan las notas sostenidas.
   */
  function espectroArmonico(muestras, sr, avisar) {
    const NL = 1 << Math.round(Math.log2(sr * 0.37));
    const NC = NL >> 1;
    const salto = NL >> 3;
    const nV = Math.max(0, Math.floor((muestras.length - NL) / salto) + 1);
    const fftL = crearFFT(NL), fftC = crearFFT(NC);
    const wL = ventanaHann(NL), wC = ventanaHann(NC);
    const reL = new Float64Array(NL), imL = new Float64Array(NL);
    const reC = new Float64Array(NC), imC = new Float64Array(NC);

    const bL0 = Math.floor(38 * NL / sr), bL1 = Math.ceil(265 * NL / sr);
    const bC0 = Math.floor(185 * NC / sr), bC1 = Math.min(NC / 2 - 2, Math.ceil(2000 * NC / sr));
    const nbL = bL1 - bL0 + 1, nbC = bC1 - bC0 + 1;
    const magL = new Float32Array(nV * nbL), magC = new Float32Array(nV * nbC);
    const rms = new Float32Array(nV);

    const cada = Math.max(1, Math.floor(nV / 20));
    for (let t = 0; t < nV; t++) {
      const ini = t * salto;
      for (let i = 0; i < NL; i++) { reL[i] = muestras[ini + i] * wL[i]; imL[i] = 0; }
      fftL(reL, imL);
      for (let k = bL0; k <= bL1; k++) magL[t * nbL + k - bL0] = Math.sqrt(reL[k] * reL[k] + imL[k] * imL[k]);
      const iniC = ini + (NL >> 1) - (NC >> 1);
      let e = 0;
      for (let i = 0; i < NC; i++) { const v = muestras[iniC + i]; e += v * v; reC[i] = v * wC[i]; imC[i] = 0; }
      rms[t] = Math.sqrt(e / NC);
      fftC(reC, imC);
      for (let k = bC0; k <= bC1; k++) magC[t * nbC + k - bC0] = 2 * Math.sqrt(reC[k] * reC[k] + imC[k] * imC[k]);
      if (avisar && t % cada === 0) avisar(0.18 + 0.45 * t / nV, 'Escuchando las notas');
    }

    medianaTemporal(magL, nV, nbL, 7);
    medianaTemporal(magC, nV, nbC, 7);

    const graves = picos(magL, nV, nbL, bL0, sr / NL, 0.05);
    const agudos = picos(magC, nV, nbC, bC0, sr / NC, 0.04);
    return {
      nV, salto, NL, rms, graves, agudos,
      fps: sr / salto,
      tiempo: (t) => (t * salto + NL / 2) / sr
    };
  }

  /** Mediana en el tiempo (largo impar) de cada frecuencia, en el mismo arreglo. */
  function medianaTemporal(mag, nV, nb, largo) {
    const r = largo >> 1;
    const col = new Float32Array(nV), ventana = new Float32Array(largo);
    for (let b = 0; b < nb; b++) {
      for (let t = 0; t < nV; t++) col[t] = mag[t * nb + b];
      for (let t = 0; t < nV; t++) {
        let c = 0;
        for (let k = t - r; k <= t + r; k++) ventana[c++] = col[Math.min(nV - 1, Math.max(0, k))];
        for (let i = 1; i < largo; i++) { const v = ventana[i]; let j = i - 1; while (j >= 0 && ventana[j] > v) { ventana[j + 1] = ventana[j]; j--; } ventana[j + 1] = v; }
        mag[t * nb + b] = ventana[r];
      }
    }
  }

  /** Picos por cuadro con interpolación parabólica: { inicio[t], frec[], amp[] }. */
  function picos(mag, nV, nb, b0, anchoBin, umbralRel) {
    const inicio = new Int32Array(nV + 1);
    const frec = [], amp = [];
    for (let t = 0; t < nV; t++) {
      inicio[t] = frec.length;
      const base = t * nb;
      let max = 0;
      for (let k = 0; k < nb; k++) if (mag[base + k] > max) max = mag[base + k];
      const umbral = max * umbralRel;
      for (let k = 1; k < nb - 1; k++) {
        const m = mag[base + k];
        if (m > umbral && m > mag[base + k - 1] && m >= mag[base + k + 1]) {
          const a = Math.log(mag[base + k - 1] + 1e-9), b = Math.log(m + 1e-9), c = Math.log(mag[base + k + 1] + 1e-9);
          const den = a - 2 * b + c;
          let d = den < 0 ? 0.5 * (a - c) / den : 0;
          d = Math.max(-0.5, Math.min(0.5, d));
          frec.push((b0 + k + d) * anchoBin);
          amp.push(Math.exp(b - 0.25 * (a - c) * d));
        }
      }
    }
    inicio[nV] = frec.length;
    return { inicio, frec: Float32Array.from(frec), amp: Float32Array.from(amp) };
  }

  /** Afinación de la grabación en semitonos (-0.5 a 0.5): promedio circular de la desviación de los picos. */
  function estimarAfinacion(e) {
    let x = 0, y = 0;
    for (const p of [e.agudos, e.graves]) {
      for (let i = 0; i < p.frec.length; i++) {
        const f = p.frec[i];
        if (f < 60 || f > 1500) continue;
        const m = 12 * Math.log2(f / 440) + 69;
        const dev = m - Math.round(m);
        const w = p.amp[i] * p.amp[i];
        x += w * Math.cos(2 * Math.PI * dev); y += w * Math.sin(2 * Math.PI * dev);
      }
    }
    return Math.atan2(y, x) / (2 * Math.PI);
  }

  function acumularCroma(p, t, afinacion, salida) {
    for (let i = p.inicio[t]; i < p.inicio[t + 1]; i++) {
      const m = 12 * Math.log2(p.frec[i] / 440) + 69 - afinacion;
      const nota = Math.round(m);
      const cerca = Math.cos(Math.PI * (m - nota)) ** 2;
      salida[mod(nota, 12)] += p.amp[i] * p.amp[i] * cerca;
    }
  }

  /** Croma promedio (agudos y bajo) en cada intervalo [a, b) de tiempo. */
  function cromaPorIntervalos(e, limites, duracion, afinacion) {
    const n = limites.length;
    const croma = [], bajo = [], energia = new Float64Array(n);
    let t = 0;
    for (let i = 0; i < n; i++) {
      const a = limites[i], b = i + 1 < n ? limites[i + 1] : duracion;
      const c = new Float64Array(12), cb = new Float64Array(12);
      let cuenta = 0, en = 0;
      while (t > 0 && e.tiempo(t) > a) t--;
      for (; t < e.nV; t++) {
        const s = e.tiempo(t);
        if (s < a) continue;
        if (s >= b) break;
        acumularCroma(e.agudos, t, afinacion, c);
        acumularCroma(e.graves, t, afinacion, cb);
        en += e.rms[t]; cuenta++;
      }
      if (cuenta === 0 && e.nV > 0) {
        const k = Math.min(e.nV - 1, Math.max(0, Math.round((a + b) / 2 * e.fps - e.NL / 2 / e.salto)));
        acumularCroma(e.agudos, k, afinacion, c);
        acumularCroma(e.graves, k, afinacion, cb);
        en = e.rms[k]; cuenta = 1;
      }
      for (let k = 0; k < 12; k++) { c[k] = Math.sqrt(c[k] / cuenta); cb[k] = Math.sqrt(cb[k] / cuenta); }
      croma.push(c); bajo.push(cb); energia[i] = en / cuenta;
    }
    return { croma, bajo, energia };
  }

  // ================================================================ 6. Compás (tiempo 1)
  /**
   * Prueba las 4 posiciones posibles del tiempo 1. Gana la que tiene más cambios de armonía
   * y más golpes graves (bombo/bajo) en esa posición.
   * @return índice (0-3) del primer pulso que es tiempo 1
   */
  function estimarCompas(cp, golpesGraves, golpesPorPulso) {
    const n = cp.croma.length;
    const puntos = [0, 0, 0, 0], cuentas = [0, 0, 0, 0];
    for (let i = 1; i < n; i++) {
      const cambio = 1 - coseno(conBajo(cp.croma[i - 1], cp.bajo[i - 1]), conBajo(cp.croma[i], cp.bajo[i]));
      puntos[i % 4] += cambio + 0.08 * Math.min(4, golpesPorPulso[i] || 0) + 0.15 * Math.min(3, golpesGraves[i] || 0);
      cuentas[i % 4]++;
    }
    let mejor = 0;
    for (let p = 1; p < 4; p++) if (puntos[p] / (cuentas[p] || 1) > puntos[mejor] / (cuentas[mejor] || 1)) mejor = p;
    return mejor;
  }

  function conBajo(c, b) {
    const r = new Float64Array(12);
    let sc = 0, sb = 0;
    for (let k = 0; k < 12; k++) { sc += c[k]; sb += b[k]; }
    for (let k = 0; k < 12; k++) r[k] = c[k] / (sc || 1) + 0.6 * b[k] / (sb || 1);
    return r;
  }

  // ================================================================ 7. Tonalidad y plantillas
  const PERFIL_MAYOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const PERFIL_MENOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  /** Krumhansl-Schmuckler. Devuelve { raiz, menor, etiqueta }. */
  function estimarTonalidad(cp) {
    const total = new Float64Array(12);
    cp.croma.forEach((c, i) => {
      let s = 0, sb = 0;
      for (let k = 0; k < 12; k++) { s += c[k]; sb += cp.bajo[i][k]; }
      for (let k = 0; k < 12; k++) total[k] += c[k] / (s || 1) + 0.5 * cp.bajo[i][k] / (sb || 1);
    });
    const corr = (x, y) => {
      const mx = x.reduce((a, b) => a + b) / 12, my = y.reduce((a, b) => a + b) / 12;
      let num = 0, dx = 0, dy = 0;
      for (let i = 0; i < 12; i++) { num += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; }
      return num / Math.sqrt(dx * dy || 1);
    };
    let mejor = { raiz: 0, menor: false, r: -Infinity };
    for (let raiz = 0; raiz < 12; raiz++) {
      const rot = Array.from({ length: 12 }, (_, i) => total[mod(i + raiz, 12)]);
      const rM = corr(rot, PERFIL_MAYOR), rm = corr(rot, PERFIL_MENOR);
      if (rM > mejor.r) mejor = { raiz, menor: false, r: rM };
      if (rm > mejor.r) mejor = { raiz, menor: true, r: rm };
    }
    mejor.etiqueta = NOTAS[mejor.raiz] + (mejor.menor ? 'm' : '');
    return mejor;
  }

  /**
   * Bonificación (en unidades de similitud) por acorde según la tonalidad:
   * los 6 acordes de la tonalidad no pierden nada, los "prestados" comunes un poco, el resto más.
   */
  function preferenciaTonalidad(ton, fuerza) {
    const r = ton.menor ? mod(ton.raiz + 3, 12) : ton.raiz; // se trabaja con la mayor relativa
    const p = new Float64Array(25).fill(-fuerza);
    const set = (raiz, menor, v) => { p[mod(raiz, 12) + (menor ? 12 : 0)] = v; };
    // Diatónicos: I ii iii IV V vi
    [[0, false], [2, true], [4, true], [5, false], [7, false], [9, true]].forEach(([i, m]) => set(r + i, m, 0));
    // Prestados comunes: bVII, iv, II (V/V), III (V/vi), bVI
    [[10, false], [5, true], [2, false], [4, false], [8, false]].forEach(([i, m]) => set(r + i, m, -fuerza * 0.4));
    p[24] = 0;
    return p;
  }

  function crearPlantillas() {
    const plantillas = [];
    for (let i = 0; i < 24; i++) {
      const raiz = i % 12, menor = i >= 12;
      const notas = [raiz, raiz + (menor ? 3 : 4), raiz + 7];
      const p = new Float64Array(12);
      notas.forEach((nota, idx) => {
        const w = idx === 0 ? 1.15 : 1;
        p[mod(nota, 12)] += w;
        p[mod(nota + 7, 12)] += w * 0.3;
        p[mod(nota + 4, 12)] += w * 0.15;
      });
      plantillas.push(normalizar(p));
    }
    return plantillas;
  }

  /** similitud[pulso][acorde]; la columna 24 es "sin acorde". */
  function calcularSimilitudes(cp) {
    const plantillas = crearPlantillas();
    const n = cp.croma.length;
    const ref = percentil(cp.energia, 0.9) || 1;
    const sim = [];
    for (let i = 0; i < n; i++) {
      const c = normalizar(cp.croma[i]);
      let sb = 0; for (let k = 0; k < 12; k++) sb += cp.bajo[i][k];
      const fila = new Float64Array(25);
      for (let j = 0; j < 24; j++) {
        let s = 0; for (let k = 0; k < 12; k++) s += c[k] * plantillas[j][k];
        const raiz = j % 12, menor = j >= 12;
        const bajo = sb > 0 ? (cp.bajo[i][raiz] + 0.3 * cp.bajo[i][mod(raiz + 7, 12)] + 0.2 * cp.bajo[i][mod(raiz + (menor ? 3 : 4), 12)]) / sb : 0;
        fila[j] = s + 0.3 * bajo;
      }
      const relativa = cp.energia[i] / ref;
      fila[24] = relativa < 0.03 ? 1.5 : relativa < 0.08 ? 0.75 : 0.25;
      sim.push(fila);
    }
    return sim;
  }

  // ================================================================ 8. Viterbi
  /**
   * @param sim       similitudes [pulso][25]
   * @param estados   índices permitidos (0-23); el 24 ("sin acorde") se agrega siempre
   * @param matriz    probabilidad de cambio [24][24]
   * @param opciones  { estabilidad, nitidez, posiciones (posición en el compás de cada pulso, 0-3), prior[25] }
   */
  function viterbi(sim, estados, matriz, opciones) {
    const nitidez = opciones.nitidez ?? 14;
    const est = opciones.estabilidad ?? 0.82;
    // Probabilidad de quedarse en el mismo acorde según la posición en el compás.
    const quedarsePos = [Math.max(0.35, 1 - (1 - est) * 2.2), 1 - (1 - est) * 0.35, est, 1 - (1 - est) * 0.35];
    const S = estados.concat([24]);
    const K = S.length, n = sim.length;
    if (n === 0) return [];
    const prior = opciones.prior || null;

    const logCambio = [];
    const probSilencio = 0.03;
    for (let a = 0; a < K; a++) {
      const fila = new Float64Array(K);
      let suma = 0;
      for (let b = 0; b < K; b++) {
        if (a === b) continue;
        fila[b] = (S[a] === 24 || S[b] === 24) ? 1 : matriz[S[a]][S[b]];
        suma += fila[b];
      }
      for (let b = 0; b < K; b++) {
        if (a === b) { fila[b] = 0; continue; }
        let p = fila[b] / (suma || 1);
        if (S[b] === 24 && S[a] !== 24) p = probSilencio;
        else if (S[a] !== 24) p *= (1 - probSilencio);
        fila[b] = Math.log(Math.max(p, 1e-9));
      }
      logCambio.push(fila);
    }
    // El control "cambios más seguidos / más estables" también abarata o encarece elegir un acorde nuevo:
    // con 0.82 (normal) el costo es el de siempre; con 0.6 baja a la mitad.
    const escalaCambio = Math.max(0.35, Math.min(1.2, (est - 0.5) / 0.32));
    for (const fila of logCambio) for (let b = 0; b < fila.length; b++) fila[b] *= escalaCambio;
    const emision = (t, k) => nitidez * (sim[t][S[k]] + (prior ? prior[S[k]] : 0));

    let delta = new Float64Array(K);
    for (let k = 0; k < K; k++) delta[k] = emision(0, k);
    const atras = [];
    for (let t = 1; t < n; t++) {
      const pos = opciones.posiciones ? opciones.posiciones[t] : 2;
      const lq = Math.log(quedarsePos[pos]), lc = Math.log(1 - quedarsePos[pos]);
      const nuevo = new Float64Array(K), ptr = new Int16Array(K);
      for (let b = 0; b < K; b++) {
        let mejor = -Infinity, mejorA = 0;
        for (let a = 0; a < K; a++) {
          const v = delta[a] + (a === b ? lq : lc + logCambio[a][b]);
          if (v > mejor) { mejor = v; mejorA = a; }
        }
        nuevo[b] = mejor + emision(t, b);
        ptr[b] = mejorA;
      }
      atras.push(ptr);
      delta = nuevo;
    }
    let k = 0;
    for (let i = 1; i < K; i++) if (delta[i] > delta[k]) k = i;
    const camino = new Array(n);
    camino[n - 1] = S[k];
    for (let t = n - 1; t > 0; t--) { k = atras[t - 1][k]; camino[t - 1] = S[k]; }
    return camino;
  }

  // ================================================================ Referencia de la base de datos
  function indiceDe(etiqueta) {
    if (!etiqueta) return -1;
    const m = /^([A-Ga-g])([#b]?)(m?)$/.exec(etiqueta.trim());
    if (!m) return -1;
    const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()];
    return mod(base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0), 12) + (m[3] ? 12 : 0);
  }

  function transponerIndice(i, semitonos) {
    return (i >= 12 ? 12 : 0) + mod((i % 12) + semitonos, 12);
  }

  /** La versión del audio puede estar en otro tono que la referencia: se prueban los 12. */
  function elegirTransposicion(sim, candidatos) {
    const puntajes = [];
    for (let k = 0; k < 12; k++) {
      const conjunto = candidatos.map(i => transponerIndice(i, k));
      let s = 0;
      for (const fila of sim) { let m = -Infinity; for (const j of conjunto) if (fila[j] > m) m = fila[j]; s += m; }
      puntajes.push(s);
    }
    let mejor = 0;
    for (let k = 1; k < 12; k++) if (puntajes[k] > puntajes[mejor] * 1.01) mejor = k;
    return { semitonos: mejor, puntaje: puntajes[mejor] };
  }

  function matrizConReferencia(matriz, secuencia, semitonos) {
    const conteo = Array.from({ length: 24 }, () => new Float64Array(24));
    const filas = new Set();
    let anterior = -1;
    for (const e of secuencia) {
      const i = indiceDe(e);
      if (i < 0) continue;
      const t = transponerIndice(i, semitonos);
      if (anterior >= 0 && t !== anterior) { conteo[anterior][t] += 1; filas.add(anterior); }
      anterior = t;
    }
    return matriz.map((fila, i) => {
      if (!filas.has(i)) return fila;
      let suma = 0; for (let j = 0; j < 24; j++) suma += conteo[i][j];
      return fila.map((p, j) => 0.35 * p + 0.65 * conteo[i][j] / suma);
    });
  }

  function matrizUniforme() {
    return Array.from({ length: 24 }, (_, i) => Array.from({ length: 24 }, (_, j) => (i === j ? 0 : 1 / 23)));
  }

  // ================================================================ Programa principal
  /**
   * @param {Float32Array} muestras  audio mono
   * @param {number} sr              frecuencia de muestreo (se recomienda 11025)
   * @param {object} opciones
   *    modelo:      { matriz, fuente } (/api/modelo/transiciones)
   *    referencia:  { acordesSimplificados: [...], secuencia: [...] } (opcional)
   *    estabilidad: 0.6 a 0.94 — más alto = cambia de acorde menos seguido
   *    bpmSugerido: tempo aproximado si el usuario lo marcó (corrige errores de doble/mitad)
   *    tempoFijo:   true si bpmSugerido es el tempo exacto: los pulsos quedan perfectamente parejos
   * @param {function} alProgreso (fraccion 0-1, mensaje)
   */
  function analizar(muestras, sr, opciones = {}, alProgreso) {
    const avisar = alProgreso || (() => {});
    const duracion = muestras.length / sr;
    if (duracion < 3) throw new Error('El audio es demasiado corto para analizarlo.');
    avisar(0.01, 'Preparando el audio');

    // --- 1-3. Golpes, tempo y pulsos
    const env = envolventeGolpes(muestras, sr, avisar);
    const o = realzar(env.total, env.fps);
    const og = realzar(env.graves, env.fps);
    const acf = autocorrelacion(o, Math.ceil(env.fps * 60 / 40) * 3 + 2);
    const fijo = !!(opciones.tempoFijo && opciones.bpmSugerido);
    let periodo = fijo ? env.fps * 60 / opciones.bpmSugerido : periodoInicial(acf, env.fps, opciones.bpmSugerido);
    if (!fijo) periodo = elegirTempo(o, env.fps, periodo, opciones.bpmSugerido);
    let indices = fijo ? rejillaFija(o, periodo) : seguirPulsos(o, periodo);
    let bpmFinal = opciones.bpmSugerido, tempoParejo = fijo, exactoDescartado = false;
    if (fijo) {
      // "Exacto" solo sirve si la canción de verdad va pareja a ese tempo. Si los golpes se van
      // alejando de la rejilla (por ejemplo, el tempo real es 63,4 y no 63), se siguen los golpes.
      const seguidos = seguirPulsos(o, periodo);
      const c = coincidenciaRejilla(seguidos, indices, periodo);
      if (seguidos.length >= 16 && (c.parte < 0.8 || c.deriva > 0.12)) {
        const t = tempoFinal(o, env.fps, seguidos, periodo);
        indices = t.indices; periodo = t.periodo; bpmFinal = t.bpm; tempoParejo = t.pareja; exactoDescartado = true;
      }
    } else {
      const t = tempoFinal(o, env.fps, indices, periodo);
      indices = t.indices; periodo = t.periodo; bpmFinal = t.bpm; tempoParejo = t.pareja;
    }
    const periodoSeg = periodo / env.fps;
    let pulsos = indices.map(env.tiempo);
    // Se completan los pulsos antes del primero y después del último (intro y final sin golpes claros).
    if (pulsos.length < 2) { pulsos = []; for (let s = 0; s < duracion; s += periodoSeg) pulsos.push(s); }
    else {
      const antes = [];
      for (let s = pulsos[0] - periodoSeg; s > 0.02; s -= periodoSeg) antes.unshift(s);
      const despues = [];
      for (let s = pulsos[pulsos.length - 1] + periodoSeg; s < duracion - 0.05; s += periodoSeg) despues.push(s);
      pulsos = antes.concat(pulsos, despues);
    }
    pulsos = pulsos.map(s => Math.round(s * 1000) / 1000);
    const enPulso = (env2) => pulsos.map(s => {
      const k = Math.round((s - env.tiempo(0)) * env.fps);
      return Math.max(env2[k] || 0, env2[k - 1] || 0, env2[k + 1] || 0);
    });
    const golpesPorPulso = enPulso(o);
    const gravesPorPulso = enPulso(og);

    // --- 4-5. Notas
    const e = espectroArmonico(muestras, sr, avisar);
    avisar(0.68, 'Buscando el compás');
    const afinacion = estimarAfinacion(e);
    const cp = cromaPorIntervalos(e, pulsos, duracion, afinacion);

    // --- 6. Compás
    const fase = estimarCompas(cp, gravesPorPulso, golpesPorPulso);
    const posiciones = pulsos.map((_, i) => mod(i - fase, 4));
    const compases = [];
    for (let i = fase; i < pulsos.length; i += 4) compases.push(i);

    // --- 7. Tonalidad y similitudes
    avisar(0.75, 'Comparando con los acordes');
    const ton = estimarTonalidad(cp);
    const sim = calcularSimilitudes(cp);

    const matrizBase = (opciones.modelo && opciones.modelo.matriz) || matrizUniforme();
    let estados = Array.from({ length: 24 }, (_, i) => i);
    let matriz = matrizBase;
    let transposicion = 0, referenciaConfiable = null;
    let prior = preferenciaTonalidad(ton, 0.12);

    const ref = opciones.referencia;
    const candidatos = ref ? [...new Set((ref.acordesSimplificados || []).map(indiceDe).filter(i => i >= 0))] : [];
    if (candidatos.length > 0) {
      avisar(0.85, 'Usando los acordes de referencia');
      const eleccion = elegirTransposicion(sim, candidatos);
      const libre = sim.reduce((s, fila) => s + Math.max(...fila.slice(0, 24)), 0);
      referenciaConfiable = eleccion.puntaje >= 0.9 * libre;
      if (referenciaConfiable) {
        transposicion = eleccion.semitonos;
        estados = candidatos.map(i => transponerIndice(i, transposicion));
        matriz = matrizConReferencia(matrizBase, ref.secuencia || ref.acordesSimplificados, transposicion);
        prior = null; // la referencia ya dice qué acordes van
      }
    }

    // --- 8. Viterbi
    avisar(0.9, 'Eligiendo la secuencia más probable');
    const camino = viterbi(sim, estados, matriz, { ...opciones, posiciones, prior });
    const acordesPorPulso = camino.map(i => (i === 24 ? SIN_ACORDE : ETIQUETAS[i]));

    const eventos = [];
    for (let i = 0; i < pulsos.length; i++) {
      const fin = i + 1 < pulsos.length ? pulsos[i + 1] : duracion;
      const acorde = acordesPorPulso[i];
      const conf = camino[i] === 24 ? 1 : sim[i][camino[i]];
      const ultimo = eventos[eventos.length - 1];
      if (ultimo && ultimo.acorde === acorde) { ultimo.fin = fin; ultimo._s += conf; ultimo._n++; }
      else eventos.push({ inicio: i === 0 ? 0 : pulsos[i], fin, acorde, _s: conf, _n: 1 });
    }
    const origen = candidatos.length > 0 && referenciaConfiable ? 'BASE_DATOS' : 'DETECTADO';
    eventos.forEach(ev => {
      ev.confianza = Math.round(Math.min(1, ev._s / ev._n) * 100) / 100;
      ev.inicio = Math.round(ev.inicio * 1000) / 1000;
      ev.fin = Math.round(ev.fin * 1000) / 1000;
      ev.origen = origen;
      delete ev._s; delete ev._n;
    });

    avisar(1, 'Listo');
    return {
      duracion: Math.round(duracion * 1000) / 1000,
      bpm: bpmFinal,
      tempoParejo,
      exactoDescartado,
      pulsos,
      compases,
      primerTiempo: fase,
      acordesPorPulso,
      eventos,
      tonalidad: ton.etiqueta,
      afinacionCents: Math.round(afinacion * 100),
      transposicionReferencia: transposicion,
      referenciaConfiable,
      modelo: (opciones.modelo && opciones.modelo.fuente) || 'uniforme'
    };
  }

  const Analizador = {
    analizar, crearFFT, indiceDe, transponerIndice, seguirPulsos,
    ETIQUETAS, NOTAS, SIN_ACORDE,
    _interno: { envolventeGolpes, realzar, autocorrelacion, periodoInicial, elegirTempo, espectroArmonico,
      estimarAfinacion, cromaPorIntervalos, rejillaFija, calcularSimilitudes, estimarCompas, estimarTonalidad, crearPlantillas }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Analizador;
  else global.Analizador = Analizador;
})(typeof self !== 'undefined' ? self : this);
