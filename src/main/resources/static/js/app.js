/*
 * ACORDIA - lógica de la página
 * =============================
 * Una sola página con tres vistas (según la dirección después del #):
 *   #/              biblioteca
 *   #/nueva         subir canción (archivo de audio o link de YouTube)
 *   #/cancion/{id}  reproductor con los acordes sincronizados
 */
(function () {
  'use strict';

  const $ = (s, raiz = document) => raiz.querySelector(s);
  const $$ = (s, raiz = document) => Array.from(raiz.querySelectorAll(s));
  const esc = Acordes.escaparXML;
  const mod = (a, n) => ((a % n) + n) % n;

  // ============================================================ utilidades
  /** localStorage puede fallar (modo privado, etc.): siempre con try/catch. */
  const local = {
    leer(clave, porDefecto) {
      try { const v = localStorage.getItem(clave); return v === null ? porDefecto : JSON.parse(v); } catch { return porDefecto; }
    },
    guardar(clave, valor) { try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* sin almacenamiento */ } }
  };

  /** Llama a la API del servidor. Si hay error, lanza una excepción con el mensaje del servidor. */
  async function api(url, { method = 'GET', json, cuerpo, texto } = {}) {
    const opciones = { method, headers: {} };
    if (json !== undefined) { opciones.body = JSON.stringify(json); opciones.headers['Content-Type'] = 'application/json'; }
    else if (texto !== undefined) { opciones.body = texto; opciones.headers['Content-Type'] = 'text/plain;charset=UTF-8'; }
    else if (cuerpo) opciones.body = cuerpo;
    let r;
    try { r = await fetch(url, opciones); } catch { throw new Error('No hay conexión con el servidor. ¿Está corriendo Acordia?'); }
    if (r.status === 204) return null;
    const tipo = r.headers.get('content-type') || '';
    const datos = tipo.includes('json') ? await r.json() : await r.text();
    if (!r.ok) throw new Error((datos && datos.mensaje) || `El servidor respondió con error ${r.status}.`);
    return datos;
  }

  let temporizadorAviso;
  function avisar(texto, esError = false) {
    const a = $('#aviso');
    a.textContent = texto;
    a.classList.toggle('error', esError);
    a.classList.remove('saliendo');
    a.hidden = false;
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => {
      a.classList.add('saliendo');                                   // se desvanece (150 ms) y luego se oculta
      temporizadorAviso = setTimeout(() => { a.hidden = true; a.classList.remove('saliendo'); }, 160);
    }, esError ? 7000 : 3500);
  }

  function mmss(s) {
    s = Math.max(0, s || 0);
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }

  /** Escribe ♯ y ♭ en vez de # y b (solo para mostrar). */
  function bonito(nombre) {
    return String(nombre).replace(/([A-G]|Do|Re|Mi|Fa|Sol|La|Si)#/g, '$1♯').replace(/([A-G]|Do|Re|Mi|Fa|Sol|La|Si)b/g, '$1♭');
  }

  /** Reduce cualquier acorde a mayor/menor (lo que entiende el analizador). */
  function aTriada(nombre) {
    const a = Acordes.leer(nombre);
    if (!a || a.sinAcorde) return null;
    return Acordes.NOMBRES[a.raiz] + (Acordes.esMenor(a.calidad) ? 'm' : '');
  }

  function sinTildes(t) {
    return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  // ============================================================ estado global
  const app = {
    servidor: null,
    modelo: null,
    filtro: '', filtroTipo: 'todas', filtroAcorde: null,
    notacion: local.leer('acordia.notacion', 'americana'),
    instrumento: local.leer('acordia.instrumento', 'guitarra'),
    vista: local.leer('acordia.vista', 'diagramas'),
    modoVista: local.leer('acordia.modoVista', 'animado'),
    conteo: local.leer('acordia.conteo', false),
    // Nivel "Sencillo": los acordes se muestran simplificados (E7 → E, Am7 → Am, D/F# → D).
    sencillo: local.leer('acordia.sencillo', false),
    volumen: local.leer('acordia.volumen', 100)
  };
  const secuenciasPendientes = new Map();

  async function cargarEstadoServidor() {
    try { app.servidor = await api('/api/estado'); } catch { app.servidor = null; }
    return app.servidor;
  }
  async function cargarModelo() {
    if (app.modelo) return app.modelo;
    try { app.modelo = await api('/api/modelo/transiciones'); } catch { app.modelo = null; }
    return app.modelo;
  }

  // ============================================================ navegación
  let salirDeVista = null;
  let hashActual = location.hash;
  let ignorarHash = false;

  window.addEventListener('hashchange', () => {
    if (ignorarHash) { ignorarHash = false; return; }
    if (rep && rep.cambios && !confirm('Tienes cambios sin guardar en los acordes. ¿Salir de todos modos?')) {
      ignorarHash = true;
      location.hash = hashActual;
      return;
    }
    hashActual = location.hash;
    enrutar();
  });
  window.addEventListener('beforeunload', (e) => { if (rep && rep.cambios) { e.preventDefault(); e.returnValue = ''; } });

  async function enrutar() {
    if (salirDeVista) { const salir = salirDeVista; salirDeVista = null; salir(); }
    cerrarMenus();
    const h = location.hash || '#/';
    const m = /^#\/cancion\/(\d+)/.exec(h);
    if (h.startsWith('#/nueva')) { mostrarVista('nueva'); await vistaNueva(); }
    else if (m) { mostrarVista('reproductor'); await vistaReproductor(Number(m[1]), h.includes('video=1')); }
    else { mostrarVista('biblioteca'); await vistaBiblioteca(); }
  }

  function mostrarVista(nombre) {
    ['biblioteca', 'nueva', 'reproductor'].forEach(v => { $('#vista-' + v).hidden = v !== nombre; });
    $$('[data-nav]').forEach(a => a.classList.toggle('activo', a.dataset.nav === nombre));
    window.scrollTo(0, 0);
  }

  // ============================================================ BIBLIOTECA
  let cancionesCache = [];

  async function vistaBiblioteca() {
    const [estado, canciones] = await Promise.all([
      cargarEstadoServidor(),
      api('/api/canciones').catch(e => { avisar(e.message, true); return []; })
    ]);
    cancionesCache = canciones;
    pintarEstadoServidor(estado);
    pintarFrecuentes();
    pintarBiblioteca();
    entradaBiblioteca();
    try {
      const imp = await api('/api/chordonomicon/estado');
      pintarImportacion(imp);
      if (imp.fase === 'DESCARGANDO' || imp.fase === 'IMPORTANDO') vigilarImportacion();
    } catch { /* servidor viejo sin importador */ }
  }

  /** La secuencia de entrada (portada y tarjetas) solo al abrir la biblioteca, no al escribir en el buscador. */
  let temporizadorEntrada = 0;
  function entradaBiblioteca() {
    const v = $('#vista-biblioteca');
    v.classList.add('entrando');
    clearTimeout(temporizadorEntrada);
    temporizadorEntrada = setTimeout(() => v.classList.remove('entrando'), 1400);
  }

  /** Los acordes que más aparecen en la biblioteca: al tocar uno se ven solo las canciones que lo usan. */
  function pintarFrecuentes() {
    const cuenta = new Map();
    const alteracion = new Map();   // ♯ o ♭ según la tonalidad de la primera canción que lo usa (igual que en su tarjeta)
    cancionesCache.forEach(c => (c.acordesPrincipales || []).forEach(a => {
      cuenta.set(a, (cuenta.get(a) || 0) + 1);
      if (!alteracion.has(a)) alteracion.set(a, c.tonalidad ? Acordes.alteracionDe(c.tonalidad) : undefined);
    }));
    const top = [...cuenta.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6).map(x => x[0]);
    if (app.filtroAcorde && !top.includes(app.filtroAcorde)) app.filtroAcorde = null;
    $('#frecuentes').innerHTML = top.length
      ? '<span>Canciones con</span>' + top.map(a => `<button type="button" class="chip-hero ${a === app.filtroAcorde ? 'activa' : ''}" data-acorde="${esc(a)}" aria-pressed="${a === app.filtroAcorde}">${esc(bonito(Acordes.mostrar(a, 0, app.notacion, alteracion.get(a))))}</button>`).join('')
      : '';
  }

  function pintarBiblioteca() {
    const q = sinTildes(app.filtro.trim());
    const tipo = app.filtroTipo, acorde = app.filtroAcorde;
    const lista = cancionesCache.filter(c =>
      (!q || sinTildes(c.titulo + ' ' + (c.artista || '')).includes(q))
      && (tipo === 'todas' || (tipo === 'youtube' ? c.fuente === 'YOUTUBE' : tipo === 'archivo' ? c.fuente !== 'YOUTUBE' : !!c.usarParaAprender))
      && (!acorde || (c.acordesPrincipales || []).includes(acorde)));
    const filtrando = !!q || tipo !== 'todas' || !!acorde;
    $('#lista-canciones').innerHTML = lista.map((c, i) => tarjetaCancion(c, i)).join('');
    $$('#filtros .filtro').forEach(b => { const si = b.dataset.tipo === tipo; b.classList.toggle('activa', si); b.setAttribute('aria-pressed', String(si)); });
    const n = lista.length;
    $('#sub-biblioteca').textContent = filtrando
      ? `${n} de ${cancionesCache.length} ${cancionesCache.length === 1 ? 'canción' : 'canciones'}`
      : (n ? `${n} ${n === 1 ? 'canción' : 'canciones'} con sus acordes guardados` : '');
    const vacia = n === 0 && !!app.servidor;
    $('#biblioteca-vacia').hidden = !vacia;
    if (vacia) {
      $('#vacio-titulo').textContent = filtrando ? 'Ninguna canción coincide' : 'Todavía no hay canciones';
      $('#vacio-texto').textContent = filtrando ? 'Prueba con otro filtro u otra búsqueda, o sube la canción.' : 'Sube un MP3 o pega un link de YouTube y Acordia te muestra los acordes mientras suena.';
      $('#vacio-boton').textContent = filtrando ? 'Subir canción' : 'Agregar la primera';
    }
  }

  function pintarEstadoServidor(e) {
    const caja = $('#estado-servidor');
    if (!e) { caja.innerHTML = '<span class="pildora alerta">Sin conexión con el servidor</span>'; return; }
    const base = e.progresionesEnBase > 0
      ? `<span class="pildora ok">Base de acordes: ${e.progresionesEnBase.toLocaleString('es-CO')} canciones</span>`
      : '<span class="pildora alerta">Base de acordes sin importar · el analizador usa teoría musical <button type="button" class="boton boton-primario pequeno" id="b-importar">Importar ahora (264 MB)</button></span>';
    const spotify = e.spotifyConfigurado
      ? '<span class="pildora ok">Búsqueda por nombre (Spotify) activa</span>'
      : '<span class="pildora" title="Configura spotify.client-id y spotify.client-secret">Búsqueda por nombre sin configurar</span>';
    const n = e.cancionesAprendidas || 0;
    const aprendizaje = n > 0
      ? `<span class="pildora ok" title="Acordia usa los cambios de acorde de estas canciones al analizar">Aprendió de ${n} ${n === 1 ? 'canción tuya' : 'canciones tuyas'}</span>`
      : '<span class="pildora" title="Abre una canción con los acordes ya corregidos y, en Detalles, pulsa «Enseñar a Acordia»">Aún no aprende de tus canciones</span>';
    caja.innerHTML = base + spotify + aprendizaje;
    const b = $('#b-importar');
    if (b) b.addEventListener('click', iniciarImportacion);
  }

  // ---------- importación de Chordonomicon (la hace el servidor en segundo plano)
  let sondeoImportacion = 0;

  async function iniciarImportacion() {
    if (!confirm('Acordia va a descargar la base de acordes Chordonomicon (264 MB, unas 680.000 canciones) desde Hugging Face '
      + 'y a guardarla en MySQL. Según tu internet y tu computador puede tardar entre 5 y 20 minutos. ¿Empezar?')) return;
    try {
      pintarImportacion(await api('/api/chordonomicon/importar', { method: 'POST' }));
      vigilarImportacion();
    } catch (e) { avisar(e.message, true); }
  }

  function vigilarImportacion() {
    clearTimeout(sondeoImportacion);
    const paso = async () => {
      let e;
      try { e = await api('/api/chordonomicon/estado'); } catch { sondeoImportacion = setTimeout(paso, 3000); return; }
      pintarImportacion(e);
      if (e.fase === 'DESCARGANDO' || e.fase === 'IMPORTANDO') { sondeoImportacion = setTimeout(paso, 1500); return; }
      if (e.fase === 'LISTO') {
        app.modelo = null; // el modelo de cambios de acorde ahora sale de las 680.000 canciones
        avisar('La base de acordes quedó importada.');
        if (!$('#vista-biblioteca').hidden) pintarEstadoServidor(await cargarEstadoServidor());
      }
    };
    sondeoImportacion = setTimeout(paso, 1000);
  }

  function pintarImportacion(e) {
    const caja = $('#importacion');
    if (!e || e.fase === 'INACTIVO') { caja.hidden = true; return; }
    caja.hidden = false;
    caja.classList.toggle('error', e.fase === 'ERROR');
    $('#importacion-mensaje').textContent = e.mensaje || '';
    $('#importacion-relleno').style.transform = `scaleX(${Math.min(1, Math.max(0, e.avance || 0))})`;
    $('#importacion-ayuda').hidden = e.fase === 'LISTO' || e.fase === 'ERROR';
    const b = $('#b-importar');
    if (b) b.disabled = e.fase === 'DESCARGANDO' || e.fase === 'IMPORTANDO';
  }

  function tarjetaCancion(c, orden) {
    const hue = (c.id * 47 + 250) % 360;
    const principal = c.acordesPrincipales && c.acordesPrincipales[0];
    const alt = c.tonalidad ? Acordes.alteracionDe(c.tonalidad) : undefined;
    const fichas = (c.acordesPrincipales || []).map(a => `<span class="ficha">${esc(bonito(Acordes.mostrar(a, 0, app.notacion, alt)))}</span>`).join('');
    const meta = [
      c.bpm ? `${Math.round(c.bpm)} BPM` : null,
      c.tonalidad ? `Tono ${esc(bonito(Acordes.mostrar(c.tonalidad, 0, app.notacion, alt)))}` : null,
      c.duracionSeg ? mmss(c.duracionSeg) : null,
      c.cantidadAcordes === 0 ? 'sin acordes todavía' : null,
    ].filter(Boolean).map(t => `<span>${t}</span>`).join('');
    return `<a class="tarjeta" href="#/cancion/${c.id}" style="--i:${Math.min(orden || 0, 11)}">
      <div class="portada" style="background:linear-gradient(140deg,hsl(${hue} 78% 58%),hsl(${(hue + 55) % 360} 70% 26%))">
        <svg class="ic"><use href="#${c.fuente === 'YOUTUBE' ? 'i-video' : 'i-archivo'}"/></svg>
        ${c.usarParaAprender ? '<span class="sello-aprende" title="Acordia aprende de los acordes de esta canción">✓ Enseña</span>' : ''}
        <span class="acorde-grande">${principal ? esc(bonito(Acordes.mostrar(principal, 0, app.notacion, alt))) : '♪'}</span>
      </div>
      <div class="tarjeta-cuerpo">
        <div><h3>${esc(c.titulo)}</h3><div class="artista">${esc(c.artista || 'Artista sin especificar')}</div></div>
        <div class="acordes-previos">${fichas}</div>
        <div class="meta">${meta}</div>
      </div>
    </a>`;
  }

  // ============================================================ SELECTOR DE REFERENCIA
  function crearSelectorReferencia(contenedor, { alElegirCancion, modoInicial = 'buscar' } = {}) {
    let referencia = null, spotifyId = null, modo = modoInicial;
    const s = app.servidor || { spotifyConfigurado: false, progresionesEnBase: 0 };

    contenedor.innerHTML = `
      <div class="pestanas" role="tablist">
        <button type="button" role="tab" data-modo="buscar">Buscar en la base de datos</button>
        <button type="button" role="tab" data-modo="pegar">Pegar acordes</button>
        <button type="button" role="tab" data-modo="ninguna">Sin referencia</button>
      </div>
      <div data-panel="buscar">
        <div class="aviso-config" data-aviso hidden></div>
        <form class="buscador" data-buscar>
          <input name="q" placeholder="Nombre de la canción y artista" autocomplete="off">
          <button class="boton" type="submit">Buscar</button>
        </form>
        <ul class="resultados" data-resultados></ul>
      </div>
      <div data-panel="pegar" hidden>
        <textarea rows="5" data-texto placeholder="[Verso]&#10;G D Em C&#10;[Coro]&#10;C G D Em"></textarea>
        <div class="fila-botones"><button type="button" class="boton" data-convertir>Usar estos acordes</button></div>
        <p class="ayuda">Pega solo los acordes, sin la letra. Sirve C D E… o Do Re Mi…, y las partes entre corchetes son opcionales.
          Si el cancionero dice "capo en el traste 3", pega los acordes tal cual: Acordia descubre solo en qué tono suena tu audio.</p>
      </div>
      <div data-panel="ninguna" hidden>
        <p class="nota">El analizador elige libremente entre los 24 acordes mayores y menores, ayudándose con la tonalidad
          y con lo que es común en la música. Funciona con cualquier canción, aunque se equivoca más.</p>
      </div>
      <div class="referencia" data-ref hidden></div>`;

    const aviso = $('[data-aviso]', contenedor);
    const form = $('[data-buscar]', contenedor);
    const mensajes = [];
    if (!s.spotifyConfigurado) mensajes.push('La búsqueda por nombre necesita Spotify: escribe el <code>Client ID</code> y el <code>Client Secret</code> de tu app en <code>application.properties</code> (el dueño de la app debe tener Spotify Premium).');
    if (!s.progresionesEnBase) mensajes.push('Todavía no importaste Chordonomicon, así que no habrá acordes para ninguna canción. Impórtala con el botón <em>Importar ahora</em> de la biblioteca.');
    if (mensajes.length) { aviso.innerHTML = mensajes.join('<br>') + '<br>Mientras tanto puedes <strong>pegar los acordes</strong>.'; aviso.hidden = false; }
    $$('input, button', form).forEach(el => { el.disabled = !s.spotifyConfigurado; });

    function cambiarModo(nuevo) {
      modo = nuevo;
      $$('[data-modo]', contenedor).forEach(b => { b.classList.toggle('activa', b.dataset.modo === modo); b.setAttribute('aria-selected', String(b.dataset.modo === modo)); });
      $$('[data-panel]', contenedor).forEach(p => { p.hidden = p.dataset.panel !== modo; });
      $('[data-ref]', contenedor).hidden = !referencia || modo === 'ninguna';
    }
    $$('[data-modo]', contenedor).forEach(b => b.addEventListener('click', () => cambiarModo(b.dataset.modo)));
    cambiarModo(modo);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = form.q.value.trim();
      if (!q) return;
      const ul = $('[data-resultados]', contenedor);
      ul.innerHTML = '<li class="nota">Buscando…</li>';
      try {
        const resultados = await api('/api/referencias/buscar?q=' + encodeURIComponent(q));
        if (!resultados.length) { ul.innerHTML = '<li class="nota">No se encontró nada. Prueba con otras palabras.</li>'; return; }
        ul.innerHTML = resultados.map((r, i) => `
          <li><button type="button" class="resultado ${r.tieneAcordes ? '' : 'sin-acordes'}" data-i="${i}">
            ${r.imagen ? `<img src="${esc(r.imagen)}" alt="" loading="lazy">` : '<span class="sin-portada"></span>'}
            <span class="info"><strong>${esc(r.titulo)}</strong><span>${esc(r.artista)}${r.album ? ' · ' + esc(r.album) : ''}</span></span>
            <span class="insignia ${r.tieneAcordes ? 'si' : 'no'}">${r.tieneAcordes ? 'Tiene acordes' : 'No está en la base'}</span>
          </button></li>`).join('');
        $$('.resultado', ul).forEach(b => b.addEventListener('click', () => elegirResultado(resultados[Number(b.dataset.i)])));
      } catch (err) { ul.innerHTML = ''; avisar(err.message, true); }
    });

    async function elegirResultado(r) {
      if (alElegirCancion) alElegirCancion({ titulo: r.titulo, artista: r.artista });
      if (!r.tieneAcordes) { avisar('Esa canción no está en la base de datos de acordes. Prueba otra versión, pega los acordes o sigue sin referencia.'); return; }
      try { fijar(await api('/api/referencias/' + encodeURIComponent(r.spotifyId)), r.spotifyId, `${r.titulo} — ${r.artista}`); }
      catch (err) { avisar(err.message, true); }
    }

    $('[data-convertir]', contenedor).addEventListener('click', async () => {
      const texto = $('[data-texto]', contenedor).value.trim();
      if (!texto) { avisar('Pega primero los acordes.', true); return; }
      try { fijar(await api('/api/referencias/convertir', { method: 'POST', texto }), null, 'Acordes pegados'); }
      catch (err) { avisar(err.message, true); }
    });

    function fijar(ref, id, nombre) {
      referencia = ref; spotifyId = id;
      const caja = $('[data-ref]', contenedor);
      caja.innerHTML = `
        <div class="referencia-cabeza">
          <div><strong>${esc(nombre || 'Referencia')}</strong>
            <div class="ayuda">${ref.secuencia.length} cambios de acorde · ${ref.acordesSimplificados.length} acordes distintos${ref.generoPrincipal ? ' · ' + esc(ref.generoPrincipal) : ''}</div></div>
          <button type="button" class="boton pequeno" data-quitar>Quitar</button>
        </div>
        <div class="secciones">${ref.secciones.map(sec => `
          <div class="seccion"><span>${esc(sec.nombre)}</span><div class="fichas">${
            sec.acordes.slice(0, 32).map(a => `<span class="ficha">${esc(bonito(Acordes.mostrar(a, 0, app.notacion)))}</span>`).join('')
          }${sec.acordes.length > 32 ? '<span class="ayuda">…</span>' : ''}</div></div>`).join('')}
        </div>`;
      caja.hidden = false;
      $('[data-quitar]', caja).addEventListener('click', () => { referencia = null; spotifyId = null; caja.hidden = true; });
    }

    return { obtener: () => (modo === 'ninguna' ? null : referencia), spotifyId: () => (modo === 'ninguna' ? null : spotifyId), fijar };
  }

  // ============================================================ ANÁLISIS DE AUDIO
  async function decodificar(arrayBuffer) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx || !window.OfflineAudioContext) throw new Error('Este navegador no puede analizar audio. Usa Chrome, Edge o Firefox actualizados.');
    const ctx = new Ctx();
    let buffer;
    try { buffer = await ctx.decodeAudioData(arrayBuffer); }
    catch { throw new Error('No se pudo leer el audio. ¿El archivo está dañado o tiene un formato raro?'); }
    finally { if (ctx.close) ctx.close(); }
    const sr = 11025;
    const fuera = new OfflineAudioContext(1, Math.max(1, Math.ceil(buffer.duration * sr)), sr);
    const fuente = fuera.createBufferSource();
    fuente.buffer = buffer;
    fuente.connect(fuera.destination);
    fuente.start();
    const mono = await fuera.startRendering();
    return { muestras: mono.getChannelData(0), sr };
  }

  async function analizarAudio(arrayBuffer, referencia, opcionesExtra, alProgreso) {
    alProgreso(0, 'Leyendo el audio');
    const { muestras, sr } = await decodificar(arrayBuffer);
    return analizarMuestras(muestras, sr, referencia, opcionesExtra, alProgreso);
  }

  async function analizarMuestras(muestras, sr, referencia, opcionesExtra, alProgreso) {
    const modelo = await cargarModelo();
    return new Promise((resolver, rechazar) => {
      const trabajador = new Worker('js/analizador-worker.js');
      trabajador.onmessage = (e) => {
        const d = e.data;
        if (d.tipo === 'progreso') alProgreso(d.fraccion, d.mensaje);
        else if (d.tipo === 'resultado') { trabajador.terminate(); resolver(d.resultado); }
        else { trabajador.terminate(); rechazar(new Error(d.mensaje)); }
      };
      trabajador.onerror = (e) => { trabajador.terminate(); rechazar(new Error('Falló el analizador: ' + (e.message || 'error desconocido'))); };
      const copia = new Float32Array(muestras);
      trabajador.postMessage({
        muestras: copia, sr,
        opciones: {
          ...opcionesExtra,
          modelo: modelo ? { matriz: modelo.matriz, fuente: modelo.fuente } : null,
          referencia: referencia ? { acordesSimplificados: referencia.acordesSimplificados, secuencia: referencia.secuencia.map(aTriada).filter(Boolean) } : null
        }
      }, [copia.buffer]);
    });
  }

  function paraGuardar(r) {
    return {
      bpm: r.bpm,
      tonalidad: Acordes.normalizar(r.tonalidad),
      duracionSeg: r.duracion,
      pulsos: r.pulsos,
      primerTiempo: r.primerTiempo,
      eventos: r.eventos.map(e => ({ inicio: e.inicio, fin: e.fin, origen: e.origen, acorde: e.acorde === 'N' ? 'N' : Acordes.normalizar(e.acorde) }))
    };
  }

  function avisoResultado(resultado, referencia) {
    if (resultado.exactoDescartado) {
      avisar('La canción no va exactamente pareja al tempo que escribiste (con el tiempo se iría desfasando), así que Acordia siguió los golpes de la canción.');
    } else if (referencia && resultado.referenciaConfiable === false) {
      avisar('Los acordes de referencia no coincidían con el audio, así que se usó la detección libre.');
    } else if (resultado.transposicionReferencia) {
      const t = resultado.transposicionReferencia, arriba = t <= 6;
      avisar(`Tu audio suena ${arriba ? t : 12 - t} semitono(s) más ${arriba ? 'arriba' : 'abajo'} que los acordes de referencia (por ejemplo, por un capo); ya se ajustó.`);
    }
  }

  // ============================================================ NUEVA CANCIÓN
  const nueva = { fuente: 'MP3', archivo: null, selector: null, ocupado: false };

  async function vistaNueva() {
    await cargarEstadoServidor();
    nueva.archivo = null;
    $('#archivo').value = '';
    $('#url-youtube').value = '';
    $('#titulo').value = '';
    $('#artista').value = '';
    $('#texto-zona').textContent = 'Arrastra el archivo aquí o haz clic para elegirlo';
    $('#zona-archivo').classList.remove('lista');
    $('#progreso').hidden = true;
    cambiarFuente('MP3');
    nueva.selector = crearSelectorReferencia($('#selector-referencia-nueva'), {
      alElegirCancion: ({ titulo, artista }) => {
        if (!$('#titulo').value.trim()) $('#titulo').value = titulo;
        if (!$('#artista').value.trim()) $('#artista').value = artista;
      }
    });
  }

  function cambiarFuente(fuente) {
    nueva.fuente = fuente;
    $$('#pestanas-fuente button').forEach(b => { b.classList.toggle('activa', b.dataset.fuente === fuente); b.setAttribute('aria-selected', String(b.dataset.fuente === fuente)); });
    $('#panel-mp3').hidden = fuente !== 'MP3';
    $('#panel-youtube').hidden = fuente !== 'YOUTUBE';
    $('#crear').textContent = fuente === 'MP3' ? 'Crear y analizar' : 'Crear';
    $('#ref-requisito').textContent = fuente === 'MP3' ? 'opcional: mejora la detección' : 'recomendado: son los acordes que vas a sincronizar';
  }

  function elegirArchivo(archivo) {
    if (!archivo) return;
    if (archivo.size > 40 * 1024 * 1024) { avisar('El archivo pesa más de 40 MB.', true); return; }
    nueva.archivo = archivo;
    $('#texto-zona').textContent = archivo.name;
    $('#zona-archivo').classList.add('lista');
    if (!$('#titulo').value.trim()) $('#titulo').value = archivo.name.replace(/\.[^.]+$/, '').replace(/_+/g, ' ');
  }

  function progresoNueva(fraccion, mensaje) {
    $('#progreso-relleno').style.transform = `scaleX(${Math.min(1, Math.max(0, fraccion))})`;
    $('#progreso-texto').textContent = mensaje;
  }

  async function crear() {
    if (nueva.ocupado) return;
    const titulo = $('#titulo').value.trim(), artista = $('#artista').value.trim();
    const referencia = nueva.selector.obtener(), spotifyId = nueva.selector.spotifyId();
    if (nueva.fuente === 'MP3' && !nueva.archivo) { avisar('Elige un archivo de audio.', true); return; }
    if (nueva.fuente === 'YOUTUBE') {
      if (!$('#url-youtube').value.trim()) { avisar('Pega el link del video de YouTube.', true); return; }
      if (!titulo) { avisar('Escribe el título de la canción.', true); return; }
    }
    nueva.ocupado = true;
    $('#crear').disabled = true;
    $('#progreso').hidden = false;
    try {
      if (nueva.fuente === 'MP3') {
        progresoNueva(0.02, 'Subiendo el archivo');
        const datos = new FormData();
        datos.append('archivo', nueva.archivo);
        datos.append('titulo', titulo);
        datos.append('artista', artista);
        if (spotifyId) datos.append('spotifyId', spotifyId);
        const cancion = await api('/api/canciones', { method: 'POST', cuerpo: datos });
        const resultado = await analizarAudio(await nueva.archivo.arrayBuffer(), referencia, { estabilidad: 0.82 }, (f, m) => progresoNueva(0.06 + 0.9 * f, m));
        progresoNueva(0.98, 'Guardando los acordes');
        await api(`/api/canciones/${cancion.id}/acordes`, { method: 'PUT', json: paraGuardar(resultado) });
        avisoResultado(resultado, referencia);
        location.hash = '#/cancion/' + cancion.id;
      } else {
        const cancion = await api('/api/canciones/youtube', { method: 'POST', json: { titulo, artista, urlYoutube: $('#url-youtube').value.trim(), spotifyId } });
        secuenciasPendientes.set(cancion.id, { referencia, spotifyId, secuencia: referencia ? referencia.secuencia : null, desdeBase: !!spotifyId });
        location.hash = `#/cancion/${cancion.id}?video=1`;
      }
    } catch (e) {
      avisar(e.message, true);
      $('#progreso').hidden = true;
    } finally {
      nueva.ocupado = false;
      $('#crear').disabled = false;
    }
  }

  // ============================================================ REPRODUCTOR
  /** Estado de la canción abierta (null si no hay ninguna). */
  let rep = null;
  const VELOCIDADES = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5];

  async function vistaReproductor(id, recienCreadaDeVideo) {
    let c;
    try { c = await api('/api/canciones/' + id); }
    catch (e) { avisar(e.message, true); location.hash = '#/'; return; }
    if (!app.servidor) cargarEstadoServidor();

    rep = {
      c,
      pulsos: c.pulsos || [],
      porPulso: [], origenPorPulso: [], editado: [],
      eventos: c.eventos.map(e => ({ ...e })),
      modo: c.pulsos && c.pulsos.length ? 'pulsos' : 'eventos',
      primerTiempo: c.primerTiempo || 0,
      // Compases vacíos al principio de la parrilla para que las filas empiecen donde empiezan en la
      // imagen importada (preferencia de vista de este navegador).
      compasesExtra: local.leer('acordia.filas.' + c.id, 0) || 0,
      transposicion: c.transposicion || 0,
      capo: c.capo || 0,
      desfase: c.desfase || 0,
      velocidad: 1,
      editando: false, cambios: false,
      sel: null, arrastre: null, portapapeles: null,
      deshacer: [], rehacer: [],
      bucle: null, bucleModo: null, bucleInicio: null,
      indice: -2, acordeVisible: undefined, siguienteVisible: undefined,
      celdasTira: [], celdasParrilla: [],
      reproductor: null, animacion: 0, arrastrando: false,
      marcado: null, temporizadorAjustes: 0, conteoActivo: false
    };
    if (rep.modo === 'pulsos') pulsosDesdeEventos();

    $('#r-titulo').textContent = c.titulo;
    $('#barra-edicion').hidden = true;
    $('#b-editar').setAttribute('aria-pressed', 'false');
    ['panel-reanalizar', 'panel-marcar', 'panel-importar'].forEach(p => { $('#' + p).hidden = true; });
    $('#aviso-bucle').hidden = true;
    $('#sinc').value = String(Math.round(rep.desfase * 1000));
    $('#m-reanalizar').textContent = c.fuente === 'MP3' ? 'Volver a analizar…' : 'Analizar el audio del video…';
    $('#contenedor-youtube').hidden = true;
    pintarHerramientas();
    pintarSub();
    pintarTodo();

    try {
      rep.reproductor = c.fuente === 'MP3' ? crearReproductorAudio(c.urlAudio) : await crearReproductorYoutube(c.youtubeId);
    } catch (e) { avisar(e.message, true); return; }
    if (!rep) return;
    rep.reproductor.volumen(app.volumen / 100);
    actualizarDiagramasLaterales(true);
    const repActual = rep;
    const ciclo = () => { if (rep !== repActual) return; cuadro(); rep.animacion = requestAnimationFrame(ciclo); };
    rep.animacion = requestAnimationFrame(ciclo);

    salirDeVista = () => {
      if (!rep) return;
      cancelAnimationFrame(rep.animacion);
      if (rep.reproductor) rep.reproductor.destruir();
      cerrarSelector();
      rep = null;
    };

    if (recienCreadaDeVideo || (c.fuente === 'YOUTUBE' && c.eventos.length === 0)) abrirPanelReanalizar();
  }

  // ---------- modelo de datos: pulsos ⇄ eventos
  function pulsosDesdeEventos() {
    const n = rep.pulsos.length;
    rep.porPulso = new Array(n);
    rep.origenPorPulso = new Array(n);
    rep.editado = new Array(n).fill(false);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const t = rep.pulsos[i] + 0.02;
      while (j < rep.eventos.length && rep.eventos[j].fin <= t) j++;
      const e = rep.eventos[j];
      if (e && e.inicio <= t) { rep.porPulso[i] = e.acorde; rep.origenPorPulso[i] = e.origen; }
      else { rep.porPulso[i] = 'N'; rep.origenPorPulso[i] = 'DETECTADO'; }
    }
  }

  function eventosDesdePulsos() {
    const n = rep.pulsos.length;
    const duracion = rep.c.duracionSeg || (rep.reproductor && rep.reproductor.duracion()) || (rep.pulsos[n - 1] + 1);
    const eventos = [];
    for (let i = 0; i < n; i++) {
      const acorde = rep.porPulso[i];
      const ultimo = eventos[eventos.length - 1];
      const fin = i + 1 < n ? rep.pulsos[i + 1] : Math.max(duracion, rep.pulsos[i] + 0.1);
      if (ultimo && ultimo.acorde === acorde) { ultimo.fin = fin; if (rep.editado[i]) ultimo.origen = 'MANUAL'; }
      else eventos.push({ inicio: i === 0 ? 0 : rep.pulsos[i], fin, acorde, origen: rep.editado[i] ? 'MANUAL' : rep.origenPorPulso[i] });
    }
    return eventos;
  }

  // ---------- reproductores (archivo o YouTube con la misma "interfaz")
  function crearReproductorAudio(url) {
    const audio = $('#audio');
    audio.src = url;
    audio.preservesPitch = true; audio.mozPreservesPitch = true; audio.webkitPreservesPitch = true;
    audio.playbackRate = 1;
    audio.onerror = () => avisar('No se pudo cargar el audio de esta canción.', true);
    return {
      tiempo: () => audio.currentTime,
      duracion: () => (isFinite(audio.duration) ? audio.duration : (rep && rep.c.duracionSeg) || 0),
      sonando: () => !audio.paused,
      terminado: () => audio.ended,
      reproducir: () => audio.play().catch(() => avisar('El navegador no dejó reproducir. Toca play otra vez.', true)),
      pausar: () => audio.pause(),
      irA: (s) => { audio.currentTime = Math.max(0, s); },
      velocidad: (v) => { audio.playbackRate = v; return v; },
      volumen: (v) => { audio.volume = Math.max(0, Math.min(1, v)); },
      destruir: () => { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    };
  }

  let promesaYoutube = null;
  function cargarApiYoutube() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (!promesaYoutube) {
      promesaYoutube = new Promise((resolver, rechazar) => {
        window.onYouTubeIframeAPIReady = () => resolver();
        const s = document.createElement('script');
        s.src = 'https://www.youtube.com/iframe_api';
        s.onerror = () => { promesaYoutube = null; rechazar(new Error('No se pudo cargar YouTube. ¿Hay internet?')); };
        document.head.appendChild(s);
      });
    }
    return promesaYoutube;
  }

  async function crearReproductorYoutube(videoId) {
    await cargarApiYoutube();
    const caja = $('#contenedor-youtube');
    caja.hidden = false;
    caja.innerHTML = '<div id="yt"></div>';
    return new Promise((resolver, rechazar) => {
      const espera = setTimeout(() => rechazar(new Error('YouTube tardó demasiado en responder.')), 20000);
      const p = new YT.Player('yt', {
        videoId,
        playerVars: { rel: 0, playsinline: 1, modestbranding: 1 },
        events: {
          onReady: () => { clearTimeout(espera); resolver(control); },
          onError: (e) => avisar(`YouTube no permite reproducir este video aquí (código ${e.data}).`, true)
        }
      });
      const control = {
        tiempo: () => (p.getCurrentTime ? p.getCurrentTime() : 0),
        duracion: () => (p.getDuration ? p.getDuration() : 0),
        sonando: () => !!(p.getPlayerState && p.getPlayerState() === 1),
        terminado: () => !!(p.getPlayerState && p.getPlayerState() === 0),
        reproducir: () => p.playVideo(),
        pausar: () => p.pauseVideo(),
        irA: (s) => p.seekTo(Math.max(0, s), true),
        velocidad: (v) => {
          const disponibles = p.getAvailablePlaybackRates ? p.getAvailablePlaybackRates() : [1];
          const elegida = disponibles.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), 1);
          p.setPlaybackRate(elegida);
          return elegida;
        },
        volumen: (v) => { if (p.setVolume) p.setVolume(Math.round(v * 100)); },
        destruir: () => { try { p.destroy(); } catch { /* ya no existe */ } caja.hidden = true; caja.innerHTML = ''; }
      };
    });
  }

  // ---------- consultas sobre la línea de tiempo
  const posicion = (i) => mod(i - rep.primerTiempo, 4);
  const cantidad = () => (rep.modo === 'pulsos' ? rep.pulsos.length : rep.eventos.length);
  const acordeGuardado = (i) => (i < 0 ? null : rep.modo === 'pulsos' ? rep.porPulso[i] : (rep.eventos[i] && rep.eventos[i].acorde));
  /** El acorde que se ve en el pulso i (simplificado si está el nivel Sencillo). */
  const acordeDe = (i) => { const a = acordeGuardado(i); return sencilloActivo() ? simplificar(a) : a; };
  const tiempoDe = (i) => (rep.modo === 'pulsos' ? (i <= 0 ? 0 : rep.pulsos[i]) : rep.eventos[i].inicio);
  const finDe = (i) => {
    if (rep.modo === 'pulsos') return i + 1 < rep.pulsos.length ? rep.pulsos[i + 1] : (rep.reproductor ? rep.reproductor.duracion() : rep.pulsos[i] + 1);
    return rep.eventos[i].fin;
  };

  function indiceEn(t) {
    if (rep.modo === 'pulsos') {
      const p = rep.pulsos;
      if (!p.length || t < p[0] - 0.001) return p.length && t >= 0 ? 0 : -1;
      let lo = 0, hi = p.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (p[m] <= t) lo = m; else hi = m - 1; }
      return lo;
    }
    const ev = rep.eventos;
    for (let i = 0; i < ev.length; i++) if (t >= ev[i].inicio && t < ev[i].fin) return i;
    return -1;
  }

  /**
   * Nivel Sencillo: deja solo la tríada mayor o menor, sin séptimas, novenas, sus ni bajo.
   * E7 → E, Am7 → Am, Cmaj7 → C, Dsus4 → D, Bdim → Bm, D/F# → D. Solo cambia lo que se ve.
   */
  function simplificar(nombre) {
    if (!nombre || nombre === 'N') return nombre;
    const a = Acordes.leer(nombre);
    if (!a || a.sinAcorde) return nombre;
    return Acordes.NOMBRES[a.raiz] + (Acordes.esMenor(a.calidad) ? 'm' : '');
  }
  /** El nivel Sencillo se aplica al ver y tocar; al editar se ven los acordes guardados. */
  const sencilloActivo = () => !!(app.sencillo && rep && !rep.editando);

  /** ¿Bemoles o sostenidos? Según la tonalidad (ya transpuesta) de la canción. */
  function alteracion() {
    return rep.c.tonalidad ? Acordes.alteracionDe(Acordes.transponer(rep.c.tonalidad, rep.transposicion)) : undefined;
  }

  function mostrarAcorde(nombre) {
    if (sencilloActivo()) nombre = simplificar(nombre);
    return nombre === 'N' ? 'N.C.' : bonito(Acordes.mostrar(nombre, rep.transposicion, app.notacion, alteracion()));
  }

  /** Forma que se toca con el capo puesto. */
  function formaConCapo(nombre) {
    return Acordes.transponer(nombre, rep.transposicion - rep.capo);
  }

  function acordesAlrededor(i) {
    const n = cantidad();
    if (n === 0) return { actual: null, siguiente: null };
    if (i < 0) {
      let j = 0; while (j < n && acordeDe(j) === 'N') j++;
      return { actual: null, siguiente: j < n ? acordeDe(j) : null };
    }
    const actual = acordeDe(i);
    let k = i;
    while (k < n && acordeDe(k) === actual) k++;
    while (k < n && acordeDe(k) === 'N') k++;
    return { actual, siguiente: k < n ? acordeDe(k) : null };
  }

  /** Los próximos cambios de acorde: [{ acorde, t, i }] empezando por el actual. */
  function proximosCambios(i, cuantos) {
    const n = cantidad(), lista = [];
    let k = Math.max(0, i);
    let anterior = null;
    if (i >= 0) { lista.push({ acorde: acordeDe(i), t: tiempoDe(bloqueInicio(i)), i }); anterior = acordeDe(i); k = i + 1; }
    for (; k < n && lista.length < cuantos; k++) {
      const a = acordeDe(k);
      if (a !== anterior && a !== 'N') lista.push({ acorde: a, t: tiempoDe(k), i: k });
      anterior = a;
    }
    return lista;
  }

  function bloqueInicio(i) {
    let j = i;
    while (j > 0 && acordeDe(j - 1) === acordeDe(i)) j--;
    return j;
  }

  /** Acordes de la canción ordenados por cuánto tiempo suenan. */
  function acordesDeLaCancion() {
    const tiempo = new Map();
    const n = cantidad();
    for (let i = 0; i < n; i++) {
      const a = acordeDe(i);
      if (a && a !== 'N') tiempo.set(a, (tiempo.get(a) || 0) + (finDe(i) - tiempoDe(i)));
    }
    return [...tiempo.entries()].sort((x, y) => y[1] - x[1]).map(e => e[0]);
  }

  function acordesEnOrden() {
    const vistos = [];
    for (let i = 0; i < cantidad(); i++) { const a = acordeDe(i); if (a && a !== 'N' && !vistos.includes(a)) vistos.push(a); }
    return vistos;
  }

  // ---------- pintado
  function pintarTodo() {
    pintarTira();
    pintarVista();
    pintarDetalles();
    pintarPractica();
    actualizarDiagramasLaterales(true);
    if (rep.editando) pintarPaleta();
  }

  function pintarSub() {
    const c = rep.c;
    const origenes = rep.eventos.map(e => e.origen);
    const cuenta = (o) => origenes.filter(x => x === o).length;
    let origen = 'Analizada por Acordia';
    if (cuenta('MANUAL') > 0) origen = 'Analizada por Acordia · editada por ti';
    else if (cuenta('BASE_DATOS') > cuenta('DETECTADO')) origen = 'Acordes de la base de datos, sincronizados por Acordia';
    if (c.fuente === 'YOUTUBE') origen = rep.eventos.length ? 'Sincronizada a mano sobre YouTube' : 'Video de YouTube · sin acordes todavía';
    $('#r-sub').textContent = [c.artista, origen].filter(Boolean).join(' · ');
  }

  function pintarTira() {
    const tira = $('#tira');
    tira.classList.toggle('eventos', rep.modo === 'eventos');
    rep.indice = -2;
    const n = cantidad();
    if (n === 0) {
      tira.innerHTML = `<div class="tira-vacia">Todavía no hay acordes. ${rep.c.fuente === 'YOUTUBE'
        ? 'Usa <strong>Más → Analizar el audio del video</strong> (o <strong>Marcar cambios en vivo</strong> para hacerlo a mano).' : 'Usa <strong>Más → Volver a analizar</strong>.'}</div>`;
      rep.celdasTira = [];
      return;
    }
    const partes = [];
    if (rep.modo === 'pulsos') {
      for (let i = 0; i < n; i++) {
        const a = acordeDe(i);
        const cambia = i === 0 || a !== acordeDe(i - 1);
        const clases = ['celda'];
        if (posicion(i) === 0) clases.push('compas');
        if (a === 'N') clases.push('sin-acorde');
        if (rep.editado[i]) clases.push('editada');
        if (enSeleccion(i)) clases.push('seleccionada');
        if (enBucle(i)) clases.push('en-bucle');
        partes.push(`<button type="button" class="${clases.join(' ')}" data-i="${i}" aria-label="${mmss(tiempoDe(i))} ${esc(mostrarAcorde(a))}">${cambia ? `<span class="nombre">${esc(mostrarAcorde(a))}</span>` : ''}</button>`);
      }
    } else {
      rep.eventos.forEach((e, i) => {
        const clases = ['celda', 'compas'];
        if (e.acorde === 'N') clases.push('sin-acorde');
        if (e.origen === 'MANUAL') clases.push('editada');
        if (enSeleccion(i)) clases.push('seleccionada');
        if (enBucle(i)) clases.push('en-bucle');
        partes.push(`<button type="button" class="${clases.join(' ')}" data-i="${i}"><span class="nombre">${esc(mostrarAcorde(e.acorde))}</span><small>${mmss(e.inicio)}</small></button>`);
      });
    }
    tira.innerHTML = partes.join('');
    rep.celdasTira = $$('.celda[data-i]', tira);
  }

  function pintarVista() {
    $$('#tabs-vista button').forEach(b => b.classList.toggle('activa', b.dataset.vista === app.vista));
    $$('#tabs-modo button').forEach(b => b.classList.toggle('activa', b.dataset.modo === app.modoVista));
    const diag = $('#vista-diagramas'), grid = $('#cuadricula');
    diag.hidden = app.vista !== 'diagramas';
    grid.hidden = app.vista !== 'parrilla';
    rep.celdasParrilla = [];
    if (app.vista === 'diagramas') pintarDiagramas(true);
    else pintarParrilla();
  }

  function dibujar(nombre, extra = {}) {
    if (sencilloActivo()) nombre = simplificar(nombre);
    if (!nombre) return Acordes.diagramaSVG('N', { titulo: '—', instrumento: app.instrumento });
    if (nombre === 'N') return Acordes.diagramaSVG('N', { titulo: 'N.C.', instrumento: app.instrumento });
    const conCapo = rep.capo > 0 && app.instrumento !== 'piano';
    const forma = conCapo ? formaConCapo(nombre) : Acordes.transponer(nombre, rep.transposicion);
    // Con cejilla el título es la forma que se toca (G, C, D…); sin cejilla, el acorde que suena.
    const titulo = conCapo ? bonito(Acordes.mostrar(forma, 0, app.notacion)) : mostrarAcorde(nombre);
    return Acordes.diagramaSVG(forma, { instrumento: app.instrumento, notacion: app.notacion, titulo, ...extra });
  }

  let firmaDiagramas = '';
  function pintarDiagramas(forzar = false) {
    const caja = $('#vista-diagramas');
    caja.classList.toggle('resumen', app.modoVista === 'resumen');
    if (cantidad() === 0) { caja.innerHTML = ''; firmaDiagramas = ''; return; }
    if (app.modoVista === 'resumen') {
      const firma = 'r|' + acordesEnOrden().join(',') + app.instrumento + rep.transposicion + rep.capo + app.notacion + app.sencillo;
      if (!forzar && firma === firmaDiagramas) return;
      firmaDiagramas = firma;
      caja.innerHTML = acordesEnOrden().map(a => `<div class="carta-diagrama">${dibujar(a)}${rep.capo && app.instrumento !== 'piano' ? `<small>suena ${esc(mostrarAcorde(a))}</small>` : ''}</div>`).join('');
      return;
    }
    const lista = proximosCambios(rep.indice, 7);
    if (rep.indice < 0 && lista.length) lista.unshift({ acorde: null, t: 0, i: -1 });
    const firma = 'a|' + lista.map(x => x.acorde + '@' + x.i).join(',') + app.instrumento + rep.transposicion + rep.capo + app.notacion + app.sencillo;
    if (!forzar && firma === firmaDiagramas) return;
    firmaDiagramas = firma;
    caja.innerHTML = lista.map((x, k) => `<div class="carta-diagrama ${k === 0 ? 'actual' : ''}">${dibujar(x.acorde)}<small>${k === 0 ? 'ahora' : mmss(x.t)}</small></div>`).join('');
  }

  function pintarParrilla() {
    const g = $('#cuadricula');
    const n = cantidad();
    g.style.gridTemplateColumns = '';
    if (n === 0) { g.innerHTML = '<div class="cuadricula-vacia">Todavía no hay acordes para esta canción.</div>'; return; }
    if (rep.modo === 'eventos') {
      g.style.gridTemplateColumns = 'repeat(auto-fill, minmax(92px, 1fr))';
      g.innerHTML = rep.eventos.map((e, i) => `<button type="button" class="pulso ${e.acorde === 'N' ? 'sin-acorde' : ''} ${enSeleccion(i) ? 'seleccionada' : ''}" data-i="${i}">${esc(mostrarAcorde(e.acorde))}</button>`).join('');
      rep.celdasParrilla = $$('.pulso[data-i]', g);
      return;
    }
    // El pulso 0 va en su lugar dentro del compás (si es el tiempo 3, van 2 casillas vacías antes).
    const relleno = posicion(0) + 4 * (rep.compasesExtra || 0);
    const indices = Array(relleno).fill(-1).concat([...Array(n).keys()]);
    const compases = [];
    for (let k = 0; k < indices.length; k += 4) compases.push(indices.slice(k, k + 4));
    const pintarCompas = (comp, interactivo) => '<div class="compas-celdas">' + comp.map((i, pos) => {
      if (i < 0) return '<span class="pulso vacio-relleno"></span>';
      const a = acordeDe(i);
      const cambia = i === 0 || a !== acordeDe(i - 1);
      const clases = ['pulso'];
      if (!cambia) clases.push('continua');
      if (pos === 0) clases.push('inicio-fila');
      if (a === 'N') clases.push('sin-acorde');
      if (interactivo && enSeleccion(i)) clases.push('seleccionada');
      if (interactivo && enBucle(i)) clases.push('en-bucle');
      return `<button type="button" class="${clases.join(' ')}" data-i="${i}" ${interactivo ? '' : 'data-resumen="1"'}>${esc(mostrarAcorde(a))}</button>`;
    }).join('') + '</div>';

    if (app.modoVista === 'resumen') {
      // Filas de 4 compases; las filas iguales seguidas se muestran una vez con "×N".
      const filas = [];
      for (let k = 0; k < compases.length; k += 4) filas.push(compases.slice(k, k + 4));
      const firma = (fila) => fila.map(c => c.map(i => (i < 0 ? '-' : acordeDe(i))).join(',')).join('|');
      const html = [];
      for (let k = 0; k < filas.length;) {
        let rep2 = 1;
        while (k + rep2 < filas.length && firma(filas[k + rep2]) === firma(filas[k]) && filas[k + rep2].length === filas[k].length) rep2++;
        html.push(filas[k].map(c => pintarCompas(c, false)).join(''));
        if (rep2 > 1) html.push(`<div class="fila-repetida">↑ se repite ×${rep2}</div>`);
        k += rep2;
      }
      g.innerHTML = html.join('');
      rep.celdasParrilla = [];
      return;
    }
    g.innerHTML = compases.map(c => pintarCompas(c, true)).join('');
    rep.celdasParrilla = [];
    $$('.pulso[data-i]', g).forEach(el => { rep.celdasParrilla[Number(el.dataset.i)] = el; });
  }

  // ---------- para practicar (como AcordesPlay: esenciales, vuelta principal, cambios y plan)
  /**
   * Resume la canción para practicarla, con los acordes que se ven (si está el nivel Sencillo, los simplificados):
   *  - esenciales: los acordes que más suenan hasta cubrir el 90 % del tiempo con acordes (máximo 6);
   *  - vuelta: la progresión de 2 a 8 acordes que más tiempo cubre al repetirse (sin solaparse);
   *  - cambios: los pasos de un acorde a otro que más se repiten fuera de la vuelta.
   */
  function analizarPractica() {
    const n = cantidad();
    const tiempo = new Map();
    const bloques = []; // [{ acorde, i (primer pulso), f (último pulso), dur }]
    let total = 0;
    for (let i = 0; i < n; i++) {
      const a = acordeDe(i);
      const dur = Math.max(0, finDe(i) - tiempoDe(i));
      if (!a || a === 'N') continue;
      tiempo.set(a, (tiempo.get(a) || 0) + dur);
      total += dur;
      const ultimo = bloques[bloques.length - 1];
      // Un silencio corto en medio no parte el bloque, pero un acorde distinto sí.
      if (ultimo && ultimo.acorde === a) { ultimo.f = i; ultimo.dur += dur; }
      else bloques.push({ acorde: a, i, f: i, dur });
    }
    if (!total || bloques.length < 2) return null;
    const orden = [...tiempo.entries()].sort((x, y) => y[1] - x[1]);
    const esenciales = [];
    let suma = 0;
    for (const [a, t] of orden) {
      if (esenciales.length >= 6 || (suma >= 0.9 * total && esenciales.length >= 2)) break;
      esenciales.push({ acorde: a, parte: t / total }); suma += t;
    }

    // Vuelta principal
    const seq = bloques.map(b => b.acorde);
    const periodoMenor = (pat) => { // [A,B,A,B] es la vuelta [A,B] dos veces
      for (let d = 1; d < pat.length; d++) if (pat.length % d === 0 && pat.every((x, k) => x === pat[k % d])) return true;
      return false;
    };
    let mejor = null;
    const vistos = new Set();
    for (let L = 2; L <= 8; L++) {
      for (let s0 = 0; s0 + L <= seq.length; s0++) {
        const pat = seq.slice(s0, s0 + L);
        const clave = pat.join('|');
        if (vistos.has(clave) || periodoMenor(pat)) continue;
        vistos.add(clave);
        const veces = [];
        for (let k = 0; k + L <= seq.length;) {
          let igual = true;
          for (let m = 0; m < L; m++) if (seq[k + m] !== pat[m]) { igual = false; break; }
          if (igual) { veces.push(k); k += L; } else k++;
        }
        if (veces.length < 2) continue;
        let cubre = 0;
        for (const k of veces) for (let m = 0; m < L; m++) cubre += bloques[k + m].dur;
        // En empate (las rotaciones de la misma vuelta cubren casi lo mismo) gana la que más veces
        // empieza en el tiempo 1 del compás, y después la que aparece primero.
        const enCompas = rep.modo === 'pulsos' ? veces.filter(k => posicion(bloques[k].i) === 0).length : 0;
        const puntaje = cubre + enCompas * 1e-3 * total / Math.max(1, veces.length) - veces[0] * 1e-6;
        if (!mejor || puntaje > mejor.puntaje) mejor = { pat, veces, cubre, puntaje };
      }
    }
    let vuelta = null;
    if (mejor && mejor.cubre / total >= 0.2) {
      const k = mejor.veces[0], L = mejor.pat.length;
      vuelta = { acordes: mejor.pat, veces: mejor.veces.length, parte: mejor.cubre / total,
        desde: bloques[k].i, hasta: bloques[k + L - 1].f };
    }

    // Cambios que más se repiten (fuera de la vuelta, contando también el paso del último al primero)
    const dentro = new Set();
    if (vuelta) vuelta.acordes.forEach((a, k) => dentro.add(a + '→' + vuelta.acordes[(k + 1) % vuelta.acordes.length]));
    const pasos = new Map();
    for (let k = 1; k < seq.length; k++) {
      const clave = seq[k - 1] + '→' + seq[k];
      if (!dentro.has(clave)) pasos.set(clave, (pasos.get(clave) || 0) + 1);
    }
    const cambios = [...pasos.entries()].filter(e => e[1] >= 2).sort((x, y) => y[1] - x[1]).slice(0, 3)
      .map(([clave, veces]) => { const [de, a] = clave.split('→'); return { de, a, veces }; });

    // ¿Cuántos acordes quedarían en el nivel Sencillo?
    const distintos = new Set(), sencillos = new Set();
    for (let i = 0; i < n; i++) { const a = acordeGuardado(i); if (a && a !== 'N') { distintos.add(a); sencillos.add(simplificar(a)); } }
    return { esenciales, cubren: suma / total, vuelta, cambios, distintos: distintos.size, sencillos: sencillos.size };
  }

  function pintarPractica() {
    const caja = $('#practicar');
    if (!caja) return;
    const p = rep && cantidad() ? analizarPractica() : null;
    $('#tarjeta-practicar').hidden = !p;
    if (!p) { caja.innerHTML = ''; return; }
    const pct = (x) => Math.round(x * 100) + ' %';
    const nombre = (a) => `<span class="ficha">${esc(mostrarAcorde(a))}</span>`;
    const lista = (v) => v.length === 1 ? v[0] : v.slice(0, -1).join(', ') + ' y ' + v[v.length - 1];
    const ese = p.esenciales.map(e => `<li>${nombre(e.acorde)}<span class="barra-parte"><span style="width:${Math.round(e.parte * 100)}%"></span></span><small>${pct(e.parte)}</small></li>`).join('');
    const partes = [];
    partes.push(`<h3>1. Aprende los esenciales</h3>
      <p class="ayuda">${esc(lista(p.esenciales.map(e => mostrarAcorde(e.acorde))))} suman el ${pct(p.cubren)} del tiempo con acordes.</p>
      <ul class="esenciales">${ese}</ul>`);
    if (p.vuelta) {
      partes.push(`<h3>2. Encadena la vuelta</h3>
        <p class="vuelta">${p.vuelta.acordes.map(nombre).join('<span class="flecha">→</span>')}</p>
        <p class="ayuda">Se repite ${p.vuelta.veces} veces y es el ${pct(p.vuelta.parte)} de la canción.</p>
        <button type="button" class="boton pequeno" data-practica="vuelta">Practicar la vuelta (bucle a 0,75×)</button>`);
    }
    if (p.cambios.length) {
      partes.push(`<h3>${p.vuelta ? '3' : '2'}. Cambios para practicar</h3>
        <ul class="cambios">${p.cambios.map(c => `<li>${nombre(c.de)}<span class="flecha">→</span>${nombre(c.a)}<small>${c.veces} veces</small></li>`).join('')}</ul>
        <p class="ayuda">Primero sin música: cambia de uno a otro 4 veces seguidas sin parar el rasgueo.</p>`);
    }
    if (p.sencillos < p.distintos) {
      partes.push(`<p class="ayuda nivel">${app.sencillo
        ? `Nivel <strong>Sencillo</strong>: ${p.sencillos} acordes en vez de ${p.distintos}. <button type="button" class="enlace" data-practica="completo">Ver los acordes completos</button>`
        : `¿Muy difícil? El nivel <strong>Sencillo</strong> deja la canción en ${p.sencillos} acordes (sin séptimas ni bajos). <button type="button" class="enlace" data-practica="sencillo">Usar nivel Sencillo</button>`}</p>`);
    }
    caja.innerHTML = partes.join('');
  }

  function practicarVuelta() {
    const p = analizarPractica();
    if (!p || !p.vuelta || !rep.reproductor) return;
    fijarVelocidad(0.75);
    fijarBucle(p.vuelta.desde, p.vuelta.hasta);
  }

  function fijarVelocidad(v) {
    if (!rep || !rep.reproductor) return;
    const real = rep.reproductor.velocidad(v);
    rep.velocidad = VELOCIDADES.includes(real) ? real : v;
    if (Math.abs(real - v) > 0.001) avisar(`YouTube solo tiene algunas velocidades: quedó en ${Math.round(real * 100)} %.`);
    pintarHerramientas();
  }

  function cambiarNivel(sencillo) {
    app.sencillo = !!sencillo; local.guardar('acordia.sencillo', app.sencillo);
    firmaDiagramas = '';
    pintarHerramientas();
    if (rep) {
      refrescarNombres();
      if (app.sencillo && rep.editando) avisar('El nivel Sencillo se verá al salir de la edición.');
      else avisar(app.sencillo ? 'Nivel Sencillo: acordes sin séptimas ni bajos (E7 → E, Am7 → Am). Lo guardado no cambia.' : 'Acordes completos.');
    }
  }

  function pintarDetalles() {
    const c = rep.c;
    const chips = acordesEnOrden().slice(0, 12).map(a => `<span class="ficha">${esc(mostrarAcorde(a))}</span>`).join('') || '<span class="ayuda">—</span>';
    const origenes = rep.eventos.map(e => e.origen);
    const origen = origenes.includes('MANUAL') ? 'Editados a mano' : origenes.filter(o => o === 'BASE_DATOS').length > origenes.length / 2 ? 'De la base de datos' : rep.eventos.length ? 'Detectados del audio' : '—';
    const filas = [
      ['Acordes', chips],
      ['Tonalidad', c.tonalidad ? esc(mostrarAcorde(c.tonalidad)) : '—'],
      ['Tempo', rep.modo === 'pulsos' && c.bpm ? `<span class="editor-tempo"><input type="number" id="bpm-editar" min="40" max="240" step="0.01" value="${Math.round(c.bpm * 100) / 100}" aria-label="Tempo en BPM" title="Escribe el tempo real (por ejemplo, el de Chordify) y pulsa Aplicar"> BPM <button type="button" class="boton pequeno" data-accion="bpm" title="Pulsos parejos a este tempo, sin cambiar los acordes">Aplicar</button><button type="button" class="boton pequeno" data-accion="afinar-menos" title="Afinar −0,1 BPM sin mover el inicio. Úsalo si con el tiempo los acordes llegan ANTES que la música">−</button><button type="button" class="boton pequeno" data-accion="afinar-mas" title="Afinar +0,1 BPM sin mover el inicio. Úsalo si con el tiempo los acordes llegan TARDE">+</button></span><button type="button" class="boton pequeno" data-accion="doble" title="La casilla va a la mitad de velocidad">×2</button><button type="button" class="boton pequeno" data-accion="mitad" title="La casilla va el doble de rápido">×½</button>` : (c.bpm ? Math.round(c.bpm) + ' BPM' : '—')],
      ['Compás', rep.modo === 'pulsos' ? `4/4 <button type="button" class="boton pequeno" data-accion="compas" title="Mover dónde empieza cada compás">Mover tiempo 1</button>` : '—'],
      ['Desplazar', rep.modo === 'pulsos'
        ? `<span class="editor-tempo desplazar"><button type="button" class="boton pequeno" data-accion="desplazar-izq" title="Mover todos los acordes hacia la izquierda (antes)">←</button><input type="number" id="desplazar-n" min="1" max="64" step="1" value="2" aria-label="Pulsos a desplazar"> pulsos <button type="button" class="boton pequeno" data-accion="desplazar-der" title="Mover todos los acordes hacia la derecha (después)">→</button></span>`
        : '<span class="ayuda">Usa Sincronía para correr todos los acordes</span>'],
      ['Duración', mmss(c.duracionSeg || (rep.reproductor && rep.reproductor.duracion()))],
      ['Origen', origen],
      ['Aprendizaje', c.usarParaAprender
        ? `<span class="aprende-si">✓ Acordia aprende de esta canción</span> <button type="button" class="boton pequeno" data-accion="aprender" title="Dejar de usarla para aprender">Quitar</button>`
        : (rep.eventos.length > 1 ? `<button type="button" class="boton pequeno" data-accion="aprender" title="Cuando los acordes ya estén bien, Acordia aprende de sus cambios de acorde">Enseñar a Acordia</button>` : '—')],
      ['Sincronía', `${Math.round(rep.desfase * 1000)} ms`]
    ];
    if (rep.capo) filas.splice(2, 0, ['Cejilla', `traste ${rep.capo}`]);
    $('#detalles').innerHTML = filas.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  }

  function pintarHerramientas() {
    $('#h-conteo').setAttribute('aria-pressed', String(app.conteo));
    $('#h-instrumento-texto').textContent = { guitarra: 'Guitarra', ukelele: 'Ukelele', piano: 'Piano' }[app.instrumento];
    $$('#m-instrumento [data-instrumento]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.instrumento === app.instrumento)));
    $$('#m-mas [data-notacion]').forEach(b => b.classList.toggle('activa', b.dataset.notacion === app.notacion));
    $$('#m-mas [data-nivel]').forEach(b => b.classList.toggle('activa', (b.dataset.nivel === 'sencillo') === !!app.sencillo));
    $('#volumen').value = String(app.volumen);
    if (!rep) return;
    $('#h-vel').textContent = Math.round(rep.velocidad * 100) + ' %';
    $('#h-capo').textContent = String(rep.capo);
    const tono = rep.c.tonalidad ? mostrarAcorde(rep.c.tonalidad) : (rep.transposicion > 0 ? '+' + rep.transposicion : String(rep.transposicion));
    $('#h-tono').textContent = tono;
    $('#h-tono').title = rep.transposicion ? `${rep.transposicion > 0 ? '+' : ''}${rep.transposicion} semitonos` : 'Tono original';
    $('#h-bucle').setAttribute('aria-pressed', String(!!rep.bucle || !!rep.bucleModo));
    $('#sinc-valor').textContent = `${Math.round(rep.desfase * 1000)} ms`;
  }

  function actualizarDiagramasLaterales(forzar = false) {
    if (!rep) return;
    const { actual, siguiente } = acordesAlrededor(rep.indice < 0 ? -1 : rep.indice);
    if (!forzar && actual === rep.acordeVisible && siguiente === rep.siguienteVisible) return;
    rep.acordeVisible = actual;
    rep.siguienteVisible = siguiente;
    $('#d-actual').innerHTML = dibujar(actual);
    $('#d-siguiente').innerHTML = dibujar(siguiente);
    const nota = $('#nota-capo');
    if (rep.capo > 0 && app.instrumento !== 'piano') {
      nota.hidden = false;
      nota.innerHTML = actual && actual !== 'N'
        ? `Cejilla en el traste ${rep.capo}: tocas <b>${esc(bonito(Acordes.mostrar(formaConCapo(actual), 0, app.notacion)))}</b> y suena <b>${esc(mostrarAcorde(actual))}</b>.`
        : `Cejilla en el traste ${rep.capo}: los diagramas muestran las formas que debes tocar.`;
    } else nota.hidden = true;
  }

  /** Se ejecuta en cada cuadro de animación (~60 por segundo). */
  function cuadro() {
    const r = rep.reproductor;
    if (!r) return;
    const t = r.tiempo();
    const dur = r.duracion();
    if (rep.bucle && t >= rep.bucle.b) r.irA(rep.bucle.a);

    // Se llama 60 veces por segundo: solo se toca la página cuando algo cambió de verdad.
    const v = rep.visto || (rep.visto = {});
    const sonando = r.sonando() || rep.conteoActivo;
    if (sonando !== v.sonando) { v.sonando = sonando; $('#b-play').classList.toggle('sonando', sonando); }
    const ta = mmss(t), tt = mmss(dur);
    if (ta !== v.ta) { v.ta = ta; $('#t-actual').textContent = ta; }
    if (tt !== v.tt) { v.tt = tt; $('#t-total').textContent = tt; }
    if (!rep.arrastrando && dur > 0) {
      const pos = String(Math.round(1000 * t / dur));
      if (pos !== v.pos) { v.pos = pos; $('#barra-tiempo').value = pos; }
    }

    const i = indiceEn(t - rep.desfase);
    if (i !== rep.indice) {
      const anterior = rep.indice;
      if (anterior >= 0) {
        if (rep.celdasTira[anterior]) rep.celdasTira[anterior].classList.remove('actual');
        if (rep.celdasParrilla[anterior]) rep.celdasParrilla[anterior].classList.remove('actual');
      }
      rep.indice = i;
      const celda = i >= 0 ? rep.celdasTira[i] : null;
      if (celda) { celda.classList.add('actual'); seguirEnTira(celda, Math.abs(i - anterior) > 2); }
      const celdaP = i >= 0 ? rep.celdasParrilla[i] : null;
      if (celdaP) { celdaP.classList.add('actual'); if (r.sonando() && app.modoVista === 'animado') mantenerVisible(celdaP); }
      actualizarDiagramasLaterales();
      if (app.vista === 'diagramas' && app.modoVista === 'animado') pintarDiagramas();
    }
  }

  /** La celda actual queda a un tercio del ancho de la tira. */
  function seguirEnTira(celda, salto) {
    const tira = $('#tira');
    const destino = celda.offsetLeft - tira.clientWidth * 0.3;
    if (salto || menosMovimiento()) tira.scrollLeft = destino;
    else tira.scrollTo({ left: destino, behavior: 'smooth' });
  }

  function menosMovimiento() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

  function mantenerVisible(celda) {
    const caja = celda.getBoundingClientRect();
    if (caja.bottom > window.innerHeight - 30 || caja.top < 80) celda.scrollIntoView({ block: 'center', behavior: menosMovimiento() ? 'auto' : 'smooth' });
  }

  // ---------- reproducción con conteo 3, 2, 1
  function periodoActual() {
    if (rep.modo === 'pulsos' && rep.pulsos.length > 2) {
      const i = Math.max(1, Math.min(rep.pulsos.length - 1, indiceEn(rep.reproductor.tiempo() - rep.desfase)));
      return Math.max(0.3, Math.min(1.5, rep.pulsos[i] - rep.pulsos[i - 1]));
    }
    return rep.c.bpm ? 60 / rep.c.bpm : 0.6;
  }

  let ctxClic = null;
  function clic(fuerte) {
    try {
      ctxClic = ctxClic || new (window.AudioContext || window.webkitAudioContext)();
      const o = ctxClic.createOscillator(), g = ctxClic.createGain();
      o.frequency.value = fuerte ? 1500 : 1000;
      g.gain.setValueAtTime(0.25, ctxClic.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctxClic.currentTime + 0.06);
      o.connect(g).connect(ctxClic.destination);
      o.start(); o.stop(ctxClic.currentTime + 0.07);
    } catch { /* sin audio */ }
  }

  async function alternarReproduccion() {
    const r = rep && rep.reproductor;
    if (!r) return;
    if (rep.conteoActivo) { rep.conteoActivo = false; $('#conteo').hidden = true; return; }
    if (r.sonando()) { r.pausar(); return; }
    if (!app.conteo) { r.reproducir(); return; }
    rep.conteoActivo = true;
    const repActual = rep;
    const periodo = periodoActual() / rep.velocidad;
    const caja = $('#conteo');
    for (const n of [3, 2, 1]) {
      if (rep !== repActual || !rep.conteoActivo) { caja.hidden = true; return; }
      caja.textContent = n; caja.hidden = false; clic(n === 3);
      if (caja.animate && !menosMovimiento()) {
        caja.animate([{ transform: 'scale(0.85)', opacity: 0.35 }, { transform: 'scale(1)', opacity: 1 }],
          { duration: Math.min(220, periodo * 500), easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
      }
      await new Promise(res => setTimeout(res, periodo * 1000));
    }
    caja.hidden = true;
    if (rep === repActual && rep.conteoActivo) { rep.conteoActivo = false; r.reproducir(); }
  }

  // ---------- ajustes guardados en el servidor (tono, capo, sincronía)
  function guardarAjustesLuego() {
    clearTimeout(rep.temporizadorAjustes);
    const id = rep.c.id, cuerpo = { transposicion: rep.transposicion, capo: rep.capo, desfase: rep.desfase };
    rep.temporizadorAjustes = setTimeout(() => { api(`/api/canciones/${id}`, { method: 'PUT', json: cuerpo }).catch(e => avisar(e.message, true)); }, 600);
  }

  function refrescarNombres() {
    pintarHerramientas();
    pintarTodo();
  }

  // ---------- bucle
  function enBucle(i) {
    if (!rep.bucle) return false;
    const t = tiempoDe(i) + rep.desfase;
    return t >= rep.bucle.a - 0.01 && t < rep.bucle.b - 0.01;
  }

  function fijarBucle(a, b) {
    let ini = Math.min(a, b), fin = Math.max(a, b);
    // Inicio y fin en el mismo pulso: repetir un solo pulso suena como un golpe que se repite sin
    // parar, así que se repite el compás completo.
    if (ini === fin && rep.modo === 'pulsos') {
      ini = Math.max(0, ini - posicion(ini));
      fin = Math.min(cantidad() - 1, ini + 3);
    }
    rep.bucle = { a: tiempoDe(ini) + rep.desfase, b: finDe(fin) + rep.desfase };
    rep.bucleModo = null;
    // Mientras haya bucle, un aviso con el botón para quitarlo.
    $('#aviso-bucle').innerHTML = `Repitiendo de ${mmss(rep.bucle.a)} a ${mmss(rep.bucle.b)}. `
      + '<button type="button" class="boton pequeno" id="b-quitar-bucle">Quitar bucle</button>';
    $('#aviso-bucle').hidden = false;
    $('#b-quitar-bucle').addEventListener('click', alternarBucle);
    pintarHerramientas();
    pintarTira(); if (app.vista === 'parrilla') pintarParrilla();
    rep.reproductor.irA(rep.bucle.a);
    if (!rep.reproductor.sonando()) alternarReproduccion();
    avisar(`Repitiendo de ${mmss(rep.bucle.a)} a ${mmss(rep.bucle.b)}. Para quitarlo: «Quitar bucle», el botón Bucle o Esc.`);
  }

  function alternarBucle() {
    if (!rep || !rep.reproductor) return;
    if (rep.bucle || rep.bucleModo) {
      rep.bucle = null; rep.bucleModo = null;
      $('#aviso-bucle').hidden = true;
      pintarHerramientas(); pintarTira(); if (app.vista === 'parrilla') pintarParrilla();
      return;
    }
    if (rep.editando && rep.sel) { fijarBucle(rep.sel.a, rep.sel.b); return; }
    rep.bucleModo = 'inicio';
    $('#aviso-bucle').textContent = 'Bucle: toca el pulso donde EMPIEZA la parte que quieres repetir.';
    $('#aviso-bucle').hidden = false;
    pintarHerramientas();
  }

  function clicBucle(i) {
    if (rep.bucleModo === 'inicio') {
      rep.bucleInicio = i;
      rep.bucleModo = 'fin';
      $('#aviso-bucle').textContent = `Bucle desde ${mmss(tiempoDe(i))}: ahora toca el pulso donde TERMINA.`;
      return;
    }
    fijarBucle(rep.bucleInicio, i);
  }

  // ---------- historial (deshacer / rehacer)
  function estado() {
    return {
      pulsos: rep.pulsos.slice(), porPulso: rep.porPulso.slice(), editado: rep.editado.slice(),
      origenPorPulso: rep.origenPorPulso.slice(), primerTiempo: rep.primerTiempo, bpm: rep.c.bpm,
      tonalidad: rep.c.tonalidad, compasesExtra: rep.compasesExtra,
      eventos: rep.eventos.map(e => ({ ...e }))
    };
  }
  function restaurar(e) {
    rep.pulsos = e.pulsos; rep.porPulso = e.porPulso; rep.editado = e.editado; rep.origenPorPulso = e.origenPorPulso;
    rep.primerTiempo = e.primerTiempo; rep.c.bpm = e.bpm; rep.eventos = e.eventos;
    rep.c.tonalidad = e.tonalidad; rep.compasesExtra = e.compasesExtra || 0;
    if (rep.sel && rep.sel.b >= cantidad()) rep.sel = null;
  }
  function recordar() {
    rep.deshacer.push(estado());
    if (rep.deshacer.length > 100) rep.deshacer.shift();
    rep.rehacer = [];
  }
  function deshacer() {
    if (!rep.deshacer.length) { avisar('No hay nada que deshacer.'); return; }
    rep.rehacer.push(estado());
    restaurar(rep.deshacer.pop());
    hayCambios(); pintarTodo();
  }
  function rehacer() {
    if (!rep.rehacer.length) return;
    rep.deshacer.push(estado());
    restaurar(rep.rehacer.pop());
    hayCambios(); pintarTodo();
  }

  function hayCambios() {
    rep.cambios = true;
    $('#e-guardar').disabled = false;
  }

  // ---------- edición
  function enSeleccion(i) { return !!(rep && rep.editando && rep.sel && i >= rep.sel.a && i <= rep.sel.b); }

  function alternarEdicion() {
    if (!rep) return;
    if (rep.editando) {
      if (rep.cambios && !confirm('Tienes cambios sin guardar. ¿Descartarlos?')) return;
      if (rep.cambios) restaurar(rep.alEntrar);
      salirEdicion();
      return;
    }
    rep.editando = true;
    rep.alEntrar = estado();
    rep.deshacer = []; rep.rehacer = [];
    rep.sel = null;
    $('#barra-edicion').hidden = false;
    $('#b-editar').setAttribute('aria-pressed', 'true');
    $('#e-guardar').disabled = true;
    $('#e-izq').textContent = rep.modo === 'pulsos' ? '← Mover cambio' : '← 0,1 s antes';
    $('#e-der').textContent = rep.modo === 'pulsos' ? 'Mover cambio →' : '0,1 s después →';
    if (app.sencillo) { firmaDiagramas = ''; pintarTodo(); avisar('Al editar se ven los acordes completos (el nivel Sencillo vuelve al salir).'); }
    pintarPaleta(); pintarSeleccion();
  }

  function salirEdicion() {
    rep.editando = false; rep.cambios = false; rep.sel = null;
    $('#barra-edicion').hidden = true;
    $('#b-editar').setAttribute('aria-pressed', 'false');
    cerrarSelector(); cerrarSelectorEvento();
    pintarTodo(); pintarSub();
  }

  function pintarPaleta() {
    const acordes = acordesDeLaCancion().slice(0, 9);
    rep.paleta = acordes;
    $('#paleta').innerHTML = acordes.map((a, k) => `<button type="button" class="chip-acorde" data-acorde="${esc(a)}" title="Tecla ${k + 1}">${esc(mostrarAcorde(a))}<small>${k + 1}</small></button>`).join('')
      + '<button type="button" class="chip-acorde otro" id="paleta-otro">+ Otro acorde</button>'
      + '<button type="button" class="chip-acorde ninguno" data-acorde="N" title="Silencio: no suena ningún acorde (tecla 0)">Sin acorde</button>'
      + '<button type="button" class="chip-acorde borrar" id="paleta-borrar" title="Quita el cambio: sigue sonando el acorde anterior (tecla Supr)">Borrar</button>';
  }

  function pintarSeleccion() {
    const s = rep.sel;
    let texto = 'Nada seleccionado';
    if (s) {
      const k = s.b - s.a + 1;
      texto = rep.modo === 'pulsos' ? `${k} pulso${k > 1 ? 's' : ''} · ${mmss(tiempoDe(s.a))}` : `${mmss(tiempoDe(s.a))} · ${mostrarAcorde(acordeDe(s.a))}`;
    }
    $('#seleccion-texto').textContent = texto;
    rep.celdasTira.forEach((el, i) => el.classList.toggle('seleccionada', enSeleccion(i)));
    rep.celdasParrilla.forEach((el, i) => el && el.classList.toggle('seleccionada', enSeleccion(i)));
  }

  function seleccionar(a, b = a, ancla = a) {
    const n = cantidad();
    a = Math.max(0, Math.min(n - 1, a)); b = Math.max(0, Math.min(n - 1, b));
    rep.sel = { a: Math.min(a, b), b: Math.max(a, b), ancla };
    pintarSeleccion();
  }

  /** Último pulso del bloque (pulsos seguidos con el mismo acorde) que contiene a i. */
  function bloqueFin(i) {
    let j = i;
    while (j + 1 < cantidad() && acordeDe(j + 1) === acordeDe(i)) j++;
    return j;
  }

  function aplicarAcorde(nombre) {
    if (!rep.sel) { avisar('Primero toca un pulso (o arrastra para elegir varios).'); return; }
    recordar();
    if (rep.modo === 'pulsos') {
      // Con un solo pulso elegido, el acorde dura hasta el siguiente cambio (como en Chordify):
      // así no reaparece el acorde viejo en el pulso de al lado.
      const hasta = rep.sel.a === rep.sel.b ? bloqueFin(rep.sel.b) : rep.sel.b;
      for (let i = rep.sel.a; i <= hasta; i++) { rep.porPulso[i] = nombre; rep.editado[i] = true; }
    } else {
      for (let i = rep.sel.a; i <= rep.sel.b; i++) { rep.eventos[i].acorde = nombre; rep.eventos[i].origen = 'MANUAL'; }
    }
    hayCambios();
    const conservar = rep.sel;
    pintarTodo();
    rep.sel = conservar; pintarSeleccion();
  }

  /**
   * Borra los cambios de acorde de la selección: esos pulsos siguen con el acorde anterior,
   * como dejar la casilla vacía en Chordify. (Distinto de «Sin acorde», que marca silencio).
   */
  function borrarCambio() {
    if (!rep.sel) { avisar('Toca la casilla donde aparece el acorde que quieres borrar.'); return; }
    if (rep.modo === 'eventos') {
      const i = rep.sel.a, ev = rep.eventos;
      recordar();
      if (i === 0) { ev[0].acorde = 'N'; ev[0].origen = 'MANUAL'; }
      else { ev[i - 1].fin = ev[i].fin; ev[i - 1].origen = 'MANUAL'; ev.splice(i, 1); }
      hayCambios(); pintarTodo(); seleccionar(Math.max(0, i - 1)); return;
    }
    const { a, b } = rep.sel;
    const inicios = [];
    for (let i = a; i <= b; i++) if (i === 0 || rep.porPulso[i] !== rep.porPulso[i - 1]) inicios.push(i);
    if (!inicios.length) { avisar('Aquí no empieza ningún acorde. Toca la casilla donde aparece su nombre.'); return; }
    recordar();
    for (const s of inicios) {
      const fin = bloqueFin(s);
      const anterior = s > 0 ? rep.porPulso[s - 1] : 'N';
      for (let i = s; i <= fin; i++) { rep.porPulso[i] = anterior; rep.editado[i] = true; }
    }
    hayCambios();
    const conservar = rep.sel;
    pintarTodo();
    rep.sel = conservar; pintarSeleccion();
  }

  function moverCambio(direccion) {
    if (!rep.sel) { avisar('Toca el pulso donde empieza el acorde que quieres mover.'); return; }
    recordar();
    if (rep.modo === 'eventos') {
      const i = rep.sel.a, ev = rep.eventos;
      const nuevo = ev[i].inicio + direccion * 0.1;
      const min = i > 0 ? ev[i - 1].inicio + 0.1 : 0, max = ev[i].fin - 0.1;
      if (i === 0 || nuevo < min || nuevo > max) { rep.deshacer.pop(); avisar('No se puede mover más.'); return; }
      ev[i].inicio = Math.round(nuevo * 1000) / 1000; ev[i - 1].fin = ev[i].inicio; ev[i].origen = 'MANUAL';
      hayCambios(); pintarTodo(); seleccionar(i); return;
    }
    const j = bloqueInicio(rep.sel.a);
    if (j === 0) { rep.deshacer.pop(); avisar('Es el primer acorde: no hay un cambio que mover.'); return; }
    if (direccion < 0) {
      rep.porPulso[j - 1] = rep.porPulso[j]; rep.editado[j - 1] = true;
      hayCambios(); pintarTodo(); seleccionar(j - 1);
    } else {
      rep.porPulso[j] = rep.porPulso[j - 1]; rep.editado[j] = true;
      hayCambios(); pintarTodo(); seleccionar(Math.min(cantidad() - 1, j + 1));
    }
  }

  function copiar() {
    if (!rep.sel || rep.modo !== 'pulsos') return;
    rep.portapapeles = rep.porPulso.slice(rep.sel.a, rep.sel.b + 1);
    avisar(`Copiados ${rep.portapapeles.length} pulsos. Selecciona dónde empezar y pulsa Pegar.`);
  }

  function pegar() {
    if (!rep.sel || !rep.portapapeles || rep.modo !== 'pulsos') { avisar('Copia primero unos pulsos y luego toca dónde pegarlos.'); return; }
    recordar();
    const a = rep.sel.a, n = cantidad();
    rep.portapapeles.forEach((acorde, k) => { if (a + k < n) { rep.porPulso[a + k] = acorde; rep.editado[a + k] = true; } });
    hayCambios(); pintarTodo();
    seleccionar(a, Math.min(n - 1, a + rep.portapapeles.length - 1));
  }

  /**
   * Corre todos los acordes de la canción n pulsos (n > 0 = a la derecha, n < 0 = a la izquierda).
   * Los pulsos que quedan libres en un extremo pasan a "Sin acorde".
   */
  function desplazarTodo(n) {
    if (!rep || rep.modo !== 'pulsos') return;
    n = Math.trunc(n);
    const total = cantidad();
    if (!n || !Number.isFinite(n)) { avisar('Escribe cuántos pulsos quieres mover (por ejemplo, 2).'); return; }
    if (Math.abs(n) >= total) { avisar('Son más pulsos de los que tiene la canción.'); return; }
    recordar();
    const antes = rep.porPulso.slice(0, total);
    const libres = Array(Math.abs(n)).fill('N');
    // Cambios de acorde que quedan completos fuera de la canción (para avisar).
    const [desde, hasta] = n > 0 ? [0, total - n] : [-n, total];   // pulsos que se conservan
    let perdidos = 0;
    for (let i = 0; i < total; i++) {
      if (i > 0 && antes[i] === antes[i - 1]) continue;              // no empieza un acorde
      let fin = i; while (fin + 1 < total && antes[fin + 1] === antes[i]) fin++;
      if (antes[i] !== 'N' && (fin < desde || i >= hasta)) perdidos++;
    }
    rep.porPulso = n > 0 ? libres.concat(antes.slice(0, total - n)) : antes.slice(-n).concat(libres);
    rep.editado = rep.porPulso.map(() => true);
    if (rep.sel) {
      const a = Math.max(0, Math.min(total - 1, rep.sel.a + n)), b = Math.max(0, Math.min(total - 1, rep.sel.b + n));
      rep.sel = null; hayCambios(); pintarTodo(); seleccionar(a, b);
    } else { hayCambios(); pintarTodo(); }
    avisar(`Acordes movidos ${Math.abs(n)} ${Math.abs(n) === 1 ? 'pulso' : 'pulsos'} a la ${n > 0 ? 'derecha' : 'izquierda'}.`
      + (perdidos ? ` ${perdidos} ${perdidos === 1 ? 'acorde quedó' : 'acordes quedaron'} fuera de la canción.` : '')
      + ' Ctrl+Z deshace; pulsa Guardar para dejarlo así.');
  }

  function corregirTono(semitonos) {
    recordar();
    const mover = (a) => (a === 'N' ? 'N' : Acordes.normalizar(Acordes.transponer(a, semitonos)));
    if (rep.modo === 'pulsos') { rep.porPulso = rep.porPulso.map(mover); rep.editado = rep.editado.map(() => true); }
    else rep.eventos.forEach(e => { e.acorde = mover(e.acorde); e.origen = 'MANUAL'; });
    if (rep.c.tonalidad) rep.c.tonalidad = mover(rep.c.tonalidad);
    hayCambios(); pintarTodo(); pintarHerramientas();
    avisar(`Todos los acordes ${semitonos > 0 ? 'subieron' : 'bajaron'} medio tono. Pulsa Guardar para dejarlo así.`);
  }

  async function guardar() {
    if (!rep) return;
    const eventos = rep.modo === 'pulsos' ? eventosDesdePulsos() : rep.eventos.map(e => ({ ...e }));
    const r = rep.reproductor;
    try {
      const c = await api(`/api/canciones/${rep.c.id}/acordes`, {
        method: 'PUT',
        json: {
          bpm: rep.c.bpm, tonalidad: rep.c.tonalidad,
          duracionSeg: rep.c.duracionSeg || (r ? r.duracion() : null),
          pulsos: rep.modo === 'pulsos' ? rep.pulsos : null,
          primerTiempo: rep.primerTiempo,
          eventos
        }
      });
      rep.c = c;
      local.guardar('acordia.filas.' + c.id, rep.compasesExtra || 0);
      rep.eventos = c.eventos.map(e => ({ ...e }));
      if (rep.modo === 'pulsos') pulsosDesdeEventos();
      rep.cambios = false;
      $('#e-guardar').disabled = true;
      pintarSub(); pintarDetalles();
      if (c.usarParaAprender) { app.modelo = null; avisar('Cambios guardados. Acordia también actualizó lo que aprende de esta canción.'); }
      else if (c.eventos.some(e => e.origen === 'MANUAL')) avisar('Cambios guardados. Cuando todos los acordes estén bien, pulsa «Enseñar a Acordia» en Detalles para que aprenda de ella.');
      else avisar('Cambios guardados.');
      return true;
    } catch (e) { avisar(e.message, true); return false; }
  }

  // ---------- aprendizaje: las canciones revisadas alimentan el modelo de cambios de acorde
  async function cambiarAprendizaje(activar, silencioso) {
    if (!rep) return false;
    if (activar) {
      if (!confirm('¿Ya revisaste que los acordes de esta canción estén bien?\n\n'
        + 'Acordia va a aprender qué acorde suele venir después de cuál a partir de ella, y lo usará al analizar '
        + 'otras canciones. Si tiene acordes equivocados, aprenderá esos errores.')) return false;
      if (rep.cambios && !(await guardar())) return false;
    }
    try {
      const c = await api(`/api/canciones/${rep.c.id}`, { method: 'PUT', json: { usarParaAprender: activar } });
      rep.c.usarParaAprender = c.usarParaAprender;
      app.modelo = null; // el próximo análisis pide el modelo actualizado
      pintarDetalles();
      if (!silencioso) avisar(activar
        ? 'Listo: Acordia aprende de esta canción. Los próximos análisis ya lo tienen en cuenta.'
        : 'Acordia ya no aprende de esta canción.');
      return true;
    } catch (e) { avisar(e.message, true); return false; }
  }

  // ---------- correcciones del ritmo (se guardan de una vez)
  async function cambiarTempo(factor) {
    if (!rep || rep.modo !== 'pulsos' || rep.pulsos.length < 4) return;
    recordar();
    const eventos = eventosDesdePulsos();
    const p = rep.pulsos;
    let nuevos;
    if (factor === 2) {
      nuevos = [];
      for (let i = 0; i < p.length; i++) {
        nuevos.push(p[i]);
        const sig = i + 1 < p.length ? p[i + 1] : p[i] + (p[i] - p[i - 1]);
        const medio = (p[i] + sig) / 2;
        if (medio < (rep.c.duracionSeg || Infinity)) nuevos.push(Math.round(medio * 1000) / 1000);
      }
      rep.primerTiempo = mod(rep.primerTiempo * 2, 4);
      rep.c.bpm = rep.c.bpm ? rep.c.bpm * 2 : rep.c.bpm;
    } else {
      const paridad = rep.primerTiempo % 2;
      nuevos = p.filter((_, i) => i % 2 === paridad);
      rep.primerTiempo = mod(Math.floor(rep.primerTiempo / 2), 4);
      rep.c.bpm = rep.c.bpm ? rep.c.bpm / 2 : rep.c.bpm;
    }
    rep.pulsos = nuevos;
    // El número que se muestra sale de los pulsos (63,4 → 63), no de multiplicar el anterior (127 / 2 = 63,5).
    const medido = tempoDePulsos(nuevos);
    if (medido) rep.c.bpm = Math.round(medido.bpm);
    rep.eventos = eventos;
    pulsosDesdeEventos();
    pintarTodo();
    if (await guardar()) avisar(factor === 2 ? 'Ahora hay el doble de pulsos.' : 'Ahora hay la mitad de pulsos.');
  }

  /**
   * Rehace los pulsos perfectamente parejos a un tempo exacto (por ejemplo 188 en vez de 189).
   * Se ancla en el pulso elegido (o en el primer acorde) y cada pulso nuevo toma el acorde que
   * sonaba en ese momento, así que los acordes no se mueven de su lugar en la canción.
   */
  /**
   * Tempo promedio de los pulsos actuales (recta de mínimos cuadrados) y si son parejos (rejilla
   * exacta) o siguen los golpes de la canción (se mueven un poco).
   */
  function tempoDePulsos(pulsos) {
    const n = pulsos.length;
    if (n < 8) return null;
    const a = Math.floor(n * 0.05), b = Math.ceil(n * 0.95);
    let mi = 0, mt = 0, c = 0;
    for (let i = a; i < b; i++) { mi += i; mt += pulsos[i]; c++; }
    mi /= c; mt /= c;
    let cov = 0, vari = 0;
    for (let i = a; i < b; i++) { cov += (i - mi) * (pulsos[i] - mt); vari += (i - mi) ** 2; }
    const T = cov / vari, origen = mt - T * mi;
    let maxRes = 0;
    for (let i = a; i < b; i++) maxRes = Math.max(maxRes, Math.abs(pulsos[i] - (origen + T * i)));
    return { bpm: 60 / T, parejos: maxRes < T * 0.04 };
  }

  /**
   * Estira o encoge toda la línea de pulsos para que vaya a otro tempo, dejando fijo el pulso elegido
   * (o donde empieza el primer acorde). Los acordes se quedan en sus pulsos: solo cambia cuándo suena
   * cada pulso. Sirve para el desfase que crece con el tiempo (el tempo real es 63,4 y no 63).
   */
  async function estirarPulsos(bpmNuevo, mensaje) {
    const info = tempoDePulsos(rep.pulsos);
    if (!info) return;
    const k = info.bpm / bpmNuevo;
    let ancla = rep.sel ? rep.sel.a : rep.porPulso.findIndex(a => a !== 'N');
    if (ancla < 0) ancla = 0;
    const t0 = rep.pulsos[ancla];
    const duracion = rep.c.duracionSeg || (rep.reproductor && rep.reproductor.duracion()) || rep.pulsos[rep.pulsos.length - 1] + 1;
    recordar();
    let pulsos = rep.pulsos.map(t => t0 + (t - t0) * k);
    let porPulso = rep.porPulso.slice(), editado = rep.editado.slice(), origen = rep.origenPorPulso.slice();
    // Pulsos que quedaron antes del inicio o después del final: se quitan.
    let quitar = 0;
    while (quitar < pulsos.length - 1 && pulsos[quitar] < 0) quitar++;
    let fin = pulsos.length;
    while (fin > quitar + 1 && pulsos[fin - 1] > duracion - 0.02) fin--;
    pulsos = pulsos.slice(quitar, fin); porPulso = porPulso.slice(quitar, fin);
    editado = editado.slice(quitar, fin); origen = origen.slice(quitar, fin);
    // Si se encogió, faltan pulsos al final: se completan sin acorde.
    const T = 60 / bpmNuevo;
    for (let t = pulsos[pulsos.length - 1] + T; t < duracion - 0.05; t += T) { pulsos.push(t); porPulso.push('N'); editado.push(true); origen.push('MANUAL'); }
    rep.pulsos = pulsos.map(t => Math.round(t * 1000) / 1000);
    rep.porPulso = porPulso; rep.editado = editado; rep.origenPorPulso = origen;
    rep.primerTiempo = mod(rep.primerTiempo - quitar, 4);
    rep.c.bpm = Math.round(bpmNuevo * 100) / 100;
    if (rep.sel) rep.sel = null;
    rep.eventos = eventosDesdePulsos();
    pintarTodo();
    if (await guardar()) avisar(mensaje || `Listo: ahora va a ${rep.c.bpm} BPM. Escucha cerca del final: si los acordes todavía se adelantan o atrasan, usa − / + junto al tempo.`);
  }

  /** − / + junto al tempo: afina 0,1 BPM sin mover el inicio. */
  function afinarTempo(paso) {
    if (!rep || rep.modo !== 'pulsos') return;
    const info = tempoDePulsos(rep.pulsos);
    if (!info) return;
    const nuevo = Math.round((info.bpm + paso) * 100) / 100;
    estirarPulsos(nuevo, `Tempo ${nuevo} BPM (el inicio no se movió). Escucha más adelante en la canción: `
      + (paso > 0 ? 'si los acordes todavía llegan tarde, vuelve a tocar +; si ahora llegan antes, toca −.' : 'si los acordes todavía llegan antes, vuelve a tocar −; si ahora llegan tarde, toca +.'));
  }

  async function fijarTempo(bpm) {
    if (!rep || rep.modo !== 'pulsos' || rep.pulsos.length < 4) return;
    if (!(bpm >= 40 && bpm <= 240)) { avisar('Escribe un tempo entre 40 y 240 BPM.', true); return; }
    // Un tempo parecido al actual: se estiran los pulsos en vez de rehacerlos.
    const info = tempoDePulsos(rep.pulsos);
    if (info && Math.abs(bpm / info.bpm - 1) < 0.03) {
      if (Number.isInteger(bpm) && Math.round(info.bpm) === bpm) {
        // Los pulsos ya van a ese tempo redondeado (Chordify muestra el tempo sin decimales; el real
        // puede ser 63,4). Llevarlos a 63 exacto los haría desfasarse con el tiempo.
        recordar();
        rep.c.bpm = bpm;
        pintarDetalles();
        if (await guardar()) avisar(`Los pulsos ya van a ${Math.round(info.bpm * 10) / 10} BPM, que redondeado es ${bpm}, así que no los cambié (si los hiciera exactos a ${bpm} se irían desfasando). Si aun así se desfasa, usa − / + junto al tempo.`);
        return;
      }
      return estirarPulsos(bpm);
    }
    // Si el tempo cambia mucho (por ejemplo de 94 a 188), los acordes detectados pueden haber quedado
    // medio compás corridos: es mejor volver a analizar el audio con el tempo exacto.
    const razon = rep.c.bpm ? bpm / rep.c.bpm : 1;
    if ((razon < 0.9 || razon > 1.1) && rep.c.fuente === 'MP3'
      && confirm(`El tempo cambia bastante (${Math.round(rep.c.bpm)} → ${bpm}). Lo mejor es volver a analizar el audio con ese tempo exacto: `
        + 'así los acordes quedan bien ubicados en cada pulso.\n\n¿Volver a analizar ahora? (Cancelar = solo rehacer los pulsos)')) {
      await abrirPanelReanalizar();
      $('#bpm-sugerido').value = String(bpm);
      $('#bpm-exacto').checked = true;
      $('#tap-texto').textContent = 'Tempo exacto. Pulsa «Analizar».';
      return;
    }
    const T = 60 / bpm;
    const viejos = rep.pulsos;
    const duracion = rep.c.duracionSeg || (rep.reproductor && rep.reproductor.duracion()) || viejos[viejos.length - 1] + T;
    // Ancla: el pulso elegido; si no hay, donde empieza el primer acorde.
    let ancla = rep.sel ? rep.sel.a : rep.porPulso.findIndex(a => a !== 'N');
    if (ancla < 0) ancla = 0;
    const t0 = viejos[ancla];
    recordar();
    const eventos = eventosDesdePulsos();
    const nuevos = [];
    for (let t = t0 - Math.floor(t0 / T) * T; t < duracion - 0.05; t += T) nuevos.push(Math.round(t * 1000) / 1000);
    // El tiempo 1 del compás queda donde estaba.
    const tiempoUno = viejos[rep.primerTiempo] != null ? viejos[rep.primerTiempo] : t0;
    let cercano = 0;
    nuevos.forEach((t, i) => { if (Math.abs(t - tiempoUno) < Math.abs(nuevos[cercano] - tiempoUno)) cercano = i; });
    // Cada pulso toma el acorde que suena a mitad de su duración (así el cambio cae en el pulso más cercano).
    const porPulso = [], origen = [];
    let j = 0;
    nuevos.forEach((t) => {
      const m = t + T * 0.45;
      while (j < eventos.length - 1 && eventos[j].fin <= m) j++;
      const e = eventos[j];
      porPulso.push(e && e.inicio <= m ? e.acorde : 'N');
      origen.push(e ? e.origen : 'DETECTADO');
    });
    rep.pulsos = nuevos;
    rep.porPulso = porPulso;
    rep.origenPorPulso = origen;
    rep.editado = new Array(nuevos.length).fill(false);
    rep.primerTiempo = mod(cercano, 4);
    rep.c.bpm = bpm;
    rep.sel = null;
    rep.eventos = eventosDesdePulsos();
    pintarTodo();
    if (await guardar()) avisar(`Listo: pulsos parejos a ${bpm} BPM. Si algún acorde quedó un pulso corrido, corrígelo con Mover cambio.`);
  }

  async function moverTiempoUno() {
    if (!rep || rep.modo !== 'pulsos') return;
    recordar();
    rep.primerTiempo = mod(rep.primerTiempo + 1, 4);
    pintarTodo();
    if (await guardar()) avisar('El compás ahora empieza un pulso después.');
  }

  // ---------- selector completo de acorde
  let seleccionSelector = null;
  const CALIDADES_SELECTOR = [['', 'Mayor'], ['m', 'm'], ['7', '7'], ['m7', 'm7'], ['maj7', 'maj7'], ['sus2', 'sus2'], ['sus4', 'sus4'], ['5', '5'], ['dim', 'dim'], ['add9', 'add9']];

  function abrirSelector(ancla) {
    if (!rep.sel) { avisar('Primero toca un pulso.'); return; }
    const actual = acordeDe(rep.sel.a);
    const visible = actual && actual !== 'N' ? Acordes.leer(Acordes.transponer(actual, rep.transposicion)) : null;
    seleccionSelector = { raiz: visible ? visible.raiz : null, calidad: visible && CALIDADES_SELECTOR.some(c => c[0] === visible.calidad) ? visible.calidad : '' };
    const nombres = app.notacion === 'latina' ? Acordes.LATINOS : Acordes.NOMBRES;
    $('#selector-raices').innerHTML = nombres.map((n, k) => `<button type="button" data-raiz="${k}">${esc(bonito(n))}</button>`).join('');
    $('#selector-calidades').innerHTML = CALIDADES_SELECTOR.map(([q, t]) => `<button type="button" data-calidad="${q}">${esc(t)}</button>`).join('');
    $('#selector-actual').textContent = 'Ahora: ' + mostrarAcorde(actual);
    $('#selector-texto').value = '';
    marcarSelector();
    const caja = $('#selector');
    caja.hidden = false;
    const r = ancla.getBoundingClientRect();
    caja.style.left = Math.min(Math.max(12, r.left), window.innerWidth - caja.offsetWidth - 12) + 'px';
    let arriba = r.bottom + 8;
    if (arriba + caja.offsetHeight > window.innerHeight - 12) arriba = Math.max(12, r.top - caja.offsetHeight - 8);
    caja.style.top = arriba + 'px';
  }

  function nombreDelSelector() {
    const escrito = $('#selector-texto').value.trim();
    if (escrito) {
      const v = Acordes.normalizar(escrito.charAt(0).toUpperCase() + escrito.slice(1));
      return v && v !== 'N' ? v : null;
    }
    if (seleccionSelector && seleccionSelector.raiz !== null) return Acordes.escribir({ raiz: seleccionSelector.raiz, calidad: seleccionSelector.calidad, bajo: null });
    return null;
  }

  function marcarSelector() {
    $$('#selector-raices button').forEach(b => b.classList.toggle('elegido', Number(b.dataset.raiz) === seleccionSelector.raiz));
    $$('#selector-calidades button').forEach(b => b.classList.toggle('elegido', b.dataset.calidad === seleccionSelector.calidad));
    const v = nombreDelSelector();
    $('#selector-vista').innerHTML = v ? Acordes.diagramaSVG(app.instrumento === 'piano' ? v : Acordes.transponer(v, -rep.capo), { instrumento: app.instrumento, notacion: app.notacion, titulo: bonito(Acordes.mostrar(v, 0, app.notacion)) }) : '';
  }

  function aplicarSelector() {
    const visible = nombreDelSelector();
    if (!visible) { avisar('Elige una nota o escribe un acorde válido (por ejemplo Am7, F#m, Sol7).', true); return; }
    aplicarAcorde(Acordes.normalizar(Acordes.transponer(visible, -rep.transposicion)));
    cerrarSelector();
  }

  function cerrarSelector() { $('#selector').hidden = true; seleccionSelector = null; }

  // ---------- ajustes finos para eventos (YouTube)
  function abrirSelectorEvento(celda) {
    const i = rep.sel.a;
    $('#sev-titulo').textContent = `${mostrarAcorde(acordeDe(i))} · empieza en ${mmss(tiempoDe(i))}`;
    const caja = $('#selector-evento');
    caja.hidden = false;
    const r = celda.getBoundingClientRect();
    caja.style.left = Math.min(Math.max(12, r.left), window.innerWidth - caja.offsetWidth - 12) + 'px';
    caja.style.top = Math.min(r.bottom + 8, window.innerHeight - caja.offsetHeight - 12) + 'px';
  }
  function cerrarSelectorEvento() { $('#selector-evento').hidden = true; }

  function eventoEmpiezaAqui() {
    const i = rep.sel && rep.sel.a;
    if (i === undefined || i === null) return;
    const t = rep.reproductor.tiempo() - rep.desfase, ev = rep.eventos;
    const min = i > 0 ? ev[i - 1].inicio + 0.1 : 0, max = ev[i].fin - 0.1;
    if (t < min || t > max) { avisar('Pon la canción entre el acorde anterior y el final de este, y vuelve a tocar.', true); return; }
    recordar();
    ev[i].inicio = Math.round(t * 1000) / 1000; ev[i].origen = 'MANUAL';
    if (i > 0) ev[i - 1].fin = ev[i].inicio;
    hayCambios(); pintarTodo(); seleccionar(i); cerrarSelectorEvento();
  }

  function eventoBorrar() {
    const i = rep.sel && rep.sel.a;
    if (!i) { avisar('El primer acorde no se puede borrar; cámbialo por otro.'); return; }
    recordar();
    rep.eventos[i - 1].fin = rep.eventos[i].fin;
    rep.eventos.splice(i, 1);
    hayCambios(); pintarTodo(); seleccionar(i - 1); cerrarSelectorEvento();
  }

  // ---------- volver a analizar
  let selectorReanalizar = null;
  const golpesTap = [];

  async function abrirPanelReanalizar() {
    const panel = $('#panel-reanalizar');
    panel.hidden = false;
    const video = rep.c.fuente === 'YOUTUBE';
    $('#reanalizar-titulo').textContent = video ? 'Analizar los acordes del video' : 'Volver a analizar el audio';
    $('#nota-video').hidden = !video;
    $('#b-detener-captura').hidden = true;
    $('#bpm-sugerido').value = '';
    $('#bpm-exacto').checked = false;
    $('#tap-texto').textContent = 'Opcional: si el analizador se equivoca de tempo.';
    golpesTap.length = 0;
    pintarMotores();
    selectorReanalizar = crearSelectorReferencia($('#selector-referencia-reanalizar'), { modoInicial: rep.c.spotifyId ? 'buscar' : 'ninguna' });
    const pendiente = secuenciasPendientes.get(rep.c.id);
    if (pendiente) {
      secuenciasPendientes.delete(rep.c.id);
      if (pendiente.referencia) { selectorReanalizar.fijar(pendiente.referencia, pendiente.spotifyId, pendiente.spotifyId ? 'De la base de datos' : 'Acordes pegados'); rep.secuenciaParaMarcar = pendiente; }
    } else if (rep.c.spotifyId) {
      try { selectorReanalizar.fijar(await api('/api/referencias/' + encodeURIComponent(rep.c.spotifyId)), rep.c.spotifyId, 'La referencia guardada de esta canción'); }
      catch { /* ya no está en la base */ }
    }
    panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function tocarTempo() {
    const ahora = performance.now();
    if (golpesTap.length && ahora - golpesTap[golpesTap.length - 1] > 2000) golpesTap.length = 0;
    golpesTap.push(ahora);
    if (golpesTap.length > 9) golpesTap.shift();
    if (golpesTap.length < 4) { $('#tap-texto').textContent = `Sigue tocando… (${golpesTap.length})`; return; }
    const difs = golpesTap.slice(1).map((t, k) => t - golpesTap[k]).sort((a, b) => a - b);
    const bpm = Math.round(60000 / difs[Math.floor(difs.length / 2)]);
    $('#bpm-sugerido').value = String(bpm);
    $('#tap-texto').textContent = `≈ ${bpm} BPM`;
  }

  async function reanalizar() {
    if (!rep) return;
    if (rep.cambios && !confirm('Vas a reemplazar los acordes que editaste. ¿Seguir?')) return;
    const referencia = selectorReanalizar ? selectorReanalizar.obtener() : null;
    const spotifyId = selectorReanalizar ? selectorReanalizar.spotifyId() : null;
    const bpm = Number($('#bpm-sugerido').value);
    const bpmValido = bpm >= 40 && bpm <= 240 ? bpm : undefined;
    const opciones = { estabilidad: Number($('#estabilidad').value), bpmSugerido: bpmValido, tempoFijo: !!bpmValido && $('#bpm-exacto').checked };
    const caja = $('#progreso-re');
    const pintar = (f, m) => { $('#progreso-re-relleno').style.transform = `scaleX(${Math.min(1, Math.max(0, f))})`; $('#progreso-re-texto').textContent = m; };
    caja.hidden = false;
    $('#b-reanalizar-ir').disabled = true;
    const repActual = rep;
    const conIa = motorElegido() === 'ia';
    try {
      let resultado;
      if (conIa) {
        resultado = await analizarConIa(opciones, pintar);
      } else if (rep.c.fuente === 'YOUTUBE') {
        const { muestras, sr } = await capturarVideo((f, m) => pintar(0.8 * f, m));
        resultado = await analizarMuestras(muestras, sr, referencia, opciones, (f, m) => pintar(0.8 + 0.2 * f, m));
      } else {
        pintar(0, 'Descargando el audio');
        const respuesta = await fetch(rep.c.urlAudio);
        if (!respuesta.ok) throw new Error('No se pudo descargar el audio de la canción.');
        resultado = await analizarAudio(await respuesta.arrayBuffer(), referencia, opciones, pintar);
      }
      if (rep !== repActual) return;
      const datos = paraGuardar(resultado);
      recordar();
      Object.assign(rep.c, { bpm: datos.bpm, tonalidad: datos.tonalidad, duracionSeg: datos.duracionSeg });
      rep.pulsos = datos.pulsos; rep.eventos = datos.eventos; rep.primerTiempo = datos.primerTiempo; rep.modo = 'pulsos';
      pulsosDesdeEventos();
      if (spotifyId && spotifyId !== rep.c.spotifyId) {
        rep.c.spotifyId = spotifyId;
        api(`/api/canciones/${rep.c.id}`, { method: 'PUT', json: { spotifyId } }).catch(() => {});
      }
      $('#panel-reanalizar').hidden = true;
      // Los acordes nuevos todavía no están revisados: se saca del aprendizaje para no enseñar errores.
      const ensenaba = rep.c.usarParaAprender && await cambiarAprendizaje(false, true);
      pintarTodo(); pintarHerramientas();
      if (await guardar()) {
        if (conIa) avisar(`Analizada con IA: acordes con BTC y pulsos con ${resultado.motorPulsos || 'Beat This!'}${resultado.segundos ? ` (${resultado.segundos} s)` : ''}. Revisa y corrige lo que haga falta.`);
        else avisoResultado(resultado, referencia);
        if (ensenaba) avisar('Como los acordes cambiaron, Acordia dejó de aprender de esta canción. Revísalos y vuelve a pulsar «Enseñar a Acordia».');
      }
    } catch (e) {
      avisar(e.message, true);
    } finally {
      caja.hidden = true;
      $('#b-reanalizar-ir').disabled = false;
      $('#b-detener-captura').hidden = true;
    }
  }

  // ---------- análisis con IA (servicio opcional en Python: Beat This! + BTC)
  let estadoIa = null;

  async function consultarIa() {
    try { estadoIa = await api('/api/ia/estado'); } catch { estadoIa = { disponible: false, mensaje: 'No se pudo consultar el servicio de IA.' }; }
    return estadoIa;
  }

  function motorElegido() {
    const r = document.querySelector('input[name="motor"]:checked');
    return r ? r.value : 'navegador';
  }

  /** Muestra en el panel si la IA está disponible y deja elegir el motor. */
  async function pintarMotores() {
    const radioIa = document.querySelector('input[name="motor"][value="ia"]');
    $('#ia-estado').textContent = 'Revisando si la IA está encendida…';
    const e = await consultarIa();
    radioIa.disabled = !e.disponible;
    if (!e.disponible) {
      document.querySelector('input[name="motor"][value="navegador"]').checked = true;
      $('#ia-estado').innerHTML = esc(e.mensaje || 'La IA no está disponible.') + ' Ver <code>ia/LEEME.md</code>.';
    } else {
      if (local.leer('acordia.motor', 'navegador') === 'ia') radioIa.checked = true;
      $('#ia-estado').textContent = e.mensaje;
    }
    actualizarOpcionesMotor();
  }

  function actualizarOpcionesMotor() {
    const ia = motorElegido() === 'ia';
    // La IA no usa los acordes de referencia ni el tempo "exacto": decide sola.
    $('#selector-referencia-reanalizar').classList.toggle('apagado', ia);
    $('#bpm-exacto').disabled = ia;
    $('#nota-ia').hidden = !ia;
  }

  /** Manda el audio a la IA: el MP3 guardado (lo envía el servidor) o el audio grabado del video. */
  async function analizarConIa(opciones, pintar) {
    const parametros = new URLSearchParams();
    if (opciones.bpmSugerido) parametros.set('bpm', String(opciones.bpmSugerido));
    parametros.set('estabilidad', String(opciones.estabilidad));
    let cuenta = null;
    const esperar = (base, texto) => {
      const inicio = performance.now();
      pintar(base, texto);
      cuenta = setInterval(() => {
        const s = Math.round((performance.now() - inicio) / 1000);
        pintar(Math.min(0.97, base + (1 - base) * (1 - Math.exp(-s / 40))), `${texto} (${s} s)`);
      }, 500);
    };
    try {
      if (rep.c.fuente === 'YOUTUBE') {
        const { muestras, sr } = await capturarVideo((f, m) => pintar(0.7 * f, m), 22050);
        const formulario = new FormData();
        formulario.append('archivo', new Blob([aWav(muestras, sr)], { type: 'audio/wav' }), 'video.wav');
        formulario.append('estabilidad', String(opciones.estabilidad));
        if (opciones.bpmSugerido) formulario.append('bpm', String(opciones.bpmSugerido));
        esperar(0.7, 'La IA está escuchando el audio grabado');
        return await api('/api/ia/analizar', { method: 'POST', cuerpo: formulario });
      }
      esperar(0.02, 'La IA está escuchando la canción (la primera vez tarda más porque carga los modelos)');
      return await api(`/api/ia/canciones/${rep.c.id}/analizar?${parametros}`, { method: 'POST' });
    } finally {
      clearInterval(cuenta);
    }
  }

  /** Audio mono a WAV de 16 bits (para enviar el audio grabado del video a la IA). */
  function aWav(muestras, sr) {
    const n = muestras.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const texto = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    texto(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); texto(8, 'WAVE'); texto(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); texto(36, 'data'); v.setUint32(40, n * 2, true);
    let max = 1e-9;
    for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(muestras[i]));
    const escala = max > 1 ? 32767 / max : 32767;
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(muestras[i] * escala))), true);
    return buf;
  }

  // ---------- grabar el audio del video (YouTube) mientras suena
  let detenerCaptura = null;

  /**
   * El navegador no deja leer el audio de un video de YouTube, pero sí grabar el audio de la pestaña
   * si el usuario lo autoriza (la misma función de "compartir pantalla" de las videollamadas).
   * Se reproduce el video desde el inicio, se graba el audio y cada trozo se ubica en el tiempo del video
   * según lo que dice el reproductor. El audio no se guarda en ninguna parte: solo se analiza.
   * @return { muestras (11.025 Hz, alineadas con el video), sr }
   */
  async function capturarVideo(alProgreso, srSalida = 11025) {
    const r = rep.reproductor;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      throw new Error('Este navegador no puede grabar el audio de la pestaña. Usa Chrome o Edge en un computador.');
    }
    if (app.volumen < 15) avisar('Sube el volumen del video: si está muy bajo, el audio grabado queda casi en silencio.', true);
    alProgreso(0, 'Esperando el permiso para compartir la pestaña…');
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
        preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', systemAudio: 'exclude'
      });
    } catch {
      throw new Error('No se dio permiso para compartir la pestaña, así que no se puede escuchar el video.');
    }
    const pistas = stream.getAudioTracks();
    if (!pistas.length) {
      stream.getTracks().forEach(t => t.stop());
      throw new Error('Se compartió la pestaña pero sin audio. Vuelve a intentar y activa «Compartir también el audio de la pestaña».');
    }
    stream.getVideoTracks().forEach(t => { t.enabled = false; });

    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const fuente = ctx.createMediaStreamSource(new MediaStream(pistas));
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const trozos = [], marcas = [];
    let total = 0;
    proc.onaudioprocess = (ev) => {
      const d = ev.inputBuffer.getChannelData(0);
      trozos.push(new Float32Array(d));
      total += d.length;
      // Al llegar este trozo, el video va en r.tiempo(): así se sabe a qué parte del video corresponde.
      if (r.sonando()) marcas.push({ fin: total, video: r.tiempo() });
      ev.outputBuffer.getChannelData(0).fill(0);
    };
    fuente.connect(proc);
    proc.connect(ctx.destination);

    let detenido = false;
    detenerCaptura = () => { detenido = true; };
    $('#b-detener-captura').hidden = false;
    r.irA(0);
    r.reproducir();
    const duracion = () => r.duracion() || rep.c.duracionSeg || 0;
    await new Promise((resolver) => {
      const inicio = performance.now();
      const vigilar = setInterval(() => {
        const t = r.tiempo(), d = duracion();
        if (d) alProgreso(Math.min(1, t / d), `Escuchando el video: ${mmss(t)} de ${mmss(d)}`);
        const sinArrancar = marcas.length === 0 && performance.now() - inicio > 15000;
        if (detenido || r.terminado() || pistas[0].readyState === 'ended' || sinArrancar) { clearInterval(vigilar); resolver(); }
      }, 250);
    });
    detenerCaptura = null;
    r.pausar();
    proc.disconnect(); fuente.disconnect();
    stream.getTracks().forEach(t => t.stop());
    const srCaptura = ctx.sampleRate;
    ctx.close();

    if (marcas.length < 10) throw new Error('El video no alcanzó a sonar. Revisa que se reproduzca y vuelve a intentar.');
    const todo = new Float32Array(total);
    let pos = 0;
    for (const t of trozos) { todo.set(t, pos); pos += t.length; }
    let energia = 0;
    for (let i = 0; i < todo.length; i += 16) energia += todo[i] * todo[i];
    if (Math.sqrt(energia / (todo.length / 16)) < 1e-4) {
      throw new Error('El audio grabado está en silencio. ¿Activaste «Compartir también el audio de la pestaña» y el video tiene volumen?');
    }

    const alineado = alinearConVideo(todo, srCaptura, marcas, Math.max(duracion(), marcas[marcas.length - 1].video + 1));
    alProgreso(1, 'Preparando el audio grabado');
    // Pasar a 11.025 Hz, igual que con los archivos de audio (22.050 Hz si es para la IA).
    const sr = srSalida;
    const fuera = new OfflineAudioContext(1, Math.ceil(alineado.length / srCaptura * sr), sr);
    const buf = fuera.createBuffer(1, alineado.length, srCaptura);
    buf.copyToChannel(alineado, 0);
    const nodo = fuera.createBufferSource();
    nodo.buffer = buf; nodo.connect(fuera.destination); nodo.start();
    const res = await fuera.startRendering();
    return { muestras: res.getChannelData(0), sr };
  }

  /**
   * Ubica el audio grabado en el tiempo del video. Cada marca dice "hasta la muestra N de la grabación,
   * el video iba en el segundo T". Si el video se detuvo (por carga o un anuncio) hay un salto, así que
   * la grabación se parte en tramos y cada tramo se coloca en su lugar.
   */
  function alinearConVideo(todo, sr, marcas, duracion) {
    const salida = new Float32Array(Math.ceil(duracion * sr));
    const tramos = [];
    for (const m of marcas) {
      const desfase = m.video - m.fin / sr;
      const actual = tramos[tramos.length - 1];
      if (actual && Math.abs(desfase - actual.referencia) < 0.4) { actual.desfases.push(desfase); actual.hasta = m.fin; }
      else tramos.push({ referencia: desfase, desfases: [desfase], desde: Math.max(0, m.fin - 4096), hasta: m.fin });
    }
    for (const tr of tramos) {
      if (tr.desfases.length < 3) continue; // tramos cortísimos (saltos) se ignoran
      // El reproductor informa su tiempo "a saltos" y siempre un poco atrasado, nunca adelantado:
      // por eso el desfase real está cerca del borde superior de las mediciones (percentil 95).
      const orden = tr.desfases.slice().sort((a, b) => a - b);
      const desfase = orden[Math.min(orden.length - 1, Math.floor(orden.length * 0.95))];
      const corrimiento = Math.round(desfase * sr);
      for (let i = tr.desde; i < tr.hasta; i++) {
        const j = i + corrimiento;
        if (j >= 0 && j < salida.length) salida[j] = todo[i];
      }
    }
    return salida;
  }

  // ---------- importar acordes desde una imagen (OCR) o desde texto
  let lectorOcr = null;
  const leerNormal = (t) => { const a = Acordes.leer(t); return a && !a.sinAcorde ? Acordes.normalizar(t) : null; };

  function abrirPanelImportar() {
    if (rep.modo !== 'pulsos') { avisar('Esta canción no tiene pulsos todavía. Analízala primero (Más → Volver a analizar).', true); return; }
    if (!rep.editando) alternarEdicion();
    const panel = $('#panel-importar');
    panel.hidden = false;
    $('#importar-aviso-tempo').innerHTML = `Cada casilla de la imagen se vuelve un pulso, así que el tempo debe ser parecido (no el doble ni la mitad).
      Esta canción va a <strong>${rep.c.bpm ? Math.round(rep.c.bpm * 10) / 10 : '?'} BPM</strong>; si la imagen dice otro, cámbialo primero en Detalles → Tempo.`;
    panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /** Carga Tesseract.js (incluido en vendor/tesseract, funciona sin internet) la primera vez. */
  async function obtenerOcr(estado) {
    if (lectorOcr) return lectorOcr;
    if (!window.Tesseract) {
      await new Promise((ok, mal) => {
        const s = document.createElement('script');
        s.src = 'vendor/tesseract/tesseract.min.js';
        s.onload = ok;
        s.onerror = () => mal(new Error('No se pudo cargar el lector de texto (carpeta vendor/tesseract).'));
        document.head.appendChild(s);
      });
    }
    estado('Preparando el lector de texto (la primera vez tarda unos segundos)…');
    const base = new URL('vendor/tesseract/', location.href).href;
    const worker = await Tesseract.createWorker('eng', 1, { workerPath: base + 'worker.min.js', corePath: base, langPath: base + 'lang', gzip: true });
    // Una línea por recorte y solo las letras que aparecen en nombres de acordes.
    await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: ImportarImagen.LISTA_BLANCA });
    lectorOcr = worker;
    return worker;
  }

  function cargarImagen(archivo) {
    return new Promise((ok, mal) => {
      const url = URL.createObjectURL(archivo);
      const img = new Image();
      img.onload = () => ok({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No pude abrir esa imagen.')); };
      img.src = url;
    });
  }

  async function leerImagenes(archivos) {
    const lista = [...archivos].filter(f => f.type.startsWith('image/'));
    if (!lista.length) { avisar('Elige una imagen (PNG o JPG).', true); return; }
    const estado = (t) => { $('#importar-estado').textContent = t; };
    $('#b-importar-aplicar').disabled = true;
    try {
      const worker = await obtenerOcr(estado);
      for (let n = 0; n < lista.length; n++) {
        const { img, url } = await cargarImagen(lista[n]);
        $('#importar-vista').src = url;
        $('#importar-vista').hidden = false;
        const lienzo = document.createElement('canvas');
        lienzo.width = img.naturalWidth; lienzo.height = img.naturalHeight;
        const ctx = lienzo.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const datos = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
        const leerTexto = async (rec) => {
          const c = document.createElement('canvas');
          c.width = rec.width; c.height = rec.height;
          c.getContext('2d').putImageData(new ImageData(rec.data, rec.width, rec.height), 0, 0);
          return (await worker.recognize(c)).data.text.trim();
        };
        const r = await ImportarImagen.leerParrilla(datos, leerTexto, leerNormal, (hechas, total) =>
          estado(`Leyendo ${lista.length > 1 ? `imagen ${n + 1} de ${lista.length}, ` : ''}casilla ${hechas} de ${total}…`));
        const caja = $('#importar-texto');
        caja.value = (caja.value.trim() ? caja.value.trimEnd() + '\n' : '') + r.texto;
        estado(`Leí ${r.red.filas} fila${r.red.filas > 1 ? 's' : ''} de ${r.red.columnas} pulsos${r.dudas ? `; ${r.dudas} casilla${r.dudas > 1 ? 's' : ''} con «?» para revisar` : ''}. Compara con la imagen y corrige si hace falta.`);
      }
    } catch (e) {
      estado('');
      avisar(e.message, true);
    } finally {
      $('#b-importar-aplicar').disabled = false;
    }
  }

  /**
   * Tonalidad más probable de una lista de acordes por pulso: la que tiene más pulsos con acordes
   * de su escala (I, ii, iii, IV, V, vi), con un extra para su tónica. Menor si su vi suena más que su I.
   */
  function tonalidadDeAcordes(secuencia) {
    const cuenta = new Map();
    for (const a of secuencia) {
      if (!a || a === 'N') continue;
      const x = Acordes.leer(a);
      if (!x || x.sinAcorde) continue;
      const k = x.raiz + (Acordes.esMenor(x.calidad) ? 12 : 0);
      cuenta.set(k, (cuenta.get(k) || 0) + 1);
    }
    const total = [...cuenta.values()].reduce((s, v) => s + v, 0);
    if (total < 16) return null;
    const c = (raiz, menor) => cuenta.get(mod(raiz, 12) + (menor ? 12 : 0)) || 0;
    let mejor = null;
    for (let t = 0; t < 12; t++) {
      const escala = c(t) + c(t + 2, 1) + c(t + 4, 1) + c(t + 5) + c(t + 7) + c(t + 9, 1);
      const puntos = escala + 0.5 * Math.max(c(t), c(t + 9, 1));
      if (!mejor || puntos > mejor.puntos) mejor = { t, puntos };
    }
    const menor = c(mejor.t + 9, 1) > c(mejor.t);
    return Acordes.escribir({ raiz: menor ? mod(mejor.t + 9, 12) : mejor.t, calidad: menor ? 'm' : '', bajo: null });
  }

  async function aplicarImportacion(reintento = false) {
    if (!rep || rep.modo !== 'pulsos') return;
    const texto = $('#importar-texto').value;
    let { pulsos, errores } = ImportarImagen.parsearTexto(texto, leerNormal);
    // Casillas grises "_" (antes del inicio o después del final de la canción): no son pulsos, pero
    // las del principio dicen en qué tiempo del compás empieza la imagen.
    let previas = 0;
    while (pulsos.length && pulsos[0].tipo === 'fuera') { pulsos.shift(); previas++; }
    while (pulsos.length && pulsos[pulsos.length - 1].tipo === 'fuera') pulsos.pop();
    pulsos = pulsos.map(p => (p.tipo === 'fuera' ? { tipo: 'sigue' } : p));
    const conCompases = texto.includes('|');
    if (!pulsos.length) { avisar('No hay acordes para poner. Elige una imagen o escríbelos.', true); return; }
    const malos = errores.filter(t => t !== '?'), dudas = errores.length - malos.length;
    if (errores.length && !confirm(`${malos.length ? `No entendí: ${malos.slice(0, 6).join(', ')}${malos.length > 6 ? '…' : ''}. ` : ''}`
      + `${dudas ? `Hay ${dudas} casilla(s) con «?». ` : ''}Esos pulsos seguirán con el acorde anterior. ¿Poner los acordes de todos modos?`)) return;
    let n = cantidad(), L = pulsos.length;
    if (L > n) {
      const clave = (p) => p.tipo === 'acorde' ? p.acorde : p.tipo;
      const mitad = L / 2;
      // ¿La misma imagen está dos veces en el texto?
      if (L % 2 === 0 && pulsos.slice(0, mitad).every((p, k) => clave(p) === clave(pulsos[mitad + k]))) {
        avisar('El texto tiene la misma imagen dos veces. Pulsa «Limpiar», vuelve a elegir la imagen una sola vez y pulsa «Poner en la canción».', true);
        return;
      }
      // La imagen tiene casi el doble de pulsos: Acordia midió el tempo a la mitad (por ejemplo 94 en vez de 188).
      if (!reintento && L / n >= 1.6 && L / n <= 2.6) {
        const bpm = rep.c.bpm ? Math.round(rep.c.bpm * 10) / 10 : null;
        if (!confirm(`La imagen tiene ${L} casillas y la canción tiene ${n} pulsos: casi el doble. `
          + `Seguramente Acordia midió el tempo a la mitad${bpm ? ` (${bpm} BPM en vez de ${Math.round(bpm * 20) / 10})` : ''}. `
          + '¿Duplicar el tempo (×2) y poner los acordes?')) return;
        await cambiarTempo(2);
        return aplicarImportacion(true);
      }
      // Sobran unas pocas casillas: primero se quitan las del final que no traen un acorde nuevo.
      while (pulsos.length > n && pulsos[pulsos.length - 1].tipo !== 'acorde') pulsos.pop();
      const sobran = pulsos.length - n;
      if (sobran > 0) {
        if (sobran > Math.max(16, n * 0.15)) {
          avisar(`El texto tiene ${L} pulsos y la canción solo ${n}. Revisa que la imagen sea de esta canción y que el tempo sea parecido (Detalles → Tempo).`, true);
          return;
        }
        if (!confirm(`Sobran ${sobran} casillas al final de la imagen (la canción tiene ${n} pulsos). ¿Poner solo las que caben?`)) return;
        pulsos = pulsos.slice(0, n);
      }
      L = pulsos.length;
    }
    const secuencia = ImportarImagen.resolver(pulsos);
    let inicio, nota = '';
    if ($('input[name="importar-donde"]:checked').value === 'sel') {
      if (!rep.sel) { avisar('Toca el pulso donde empieza la primera casilla y vuelve a pulsar «Poner en la canción».', true); return; }
      inicio = rep.sel.a;
      if (inicio + L > n) { avisar('Desde ese pulso no caben todos los acordes.', true); return; }
    } else {
      const u = ImportarImagen.ubicar(secuencia, rep.porPulso, (a, b) => aTriada(a) === aTriada(b), (i) => posicion(i) === 0);
      inicio = u.inicio;
      const pct = Math.round(u.coincidencia * 100);
      if (u.coincidencia < 0.4 && !confirm(`El mejor lugar que encontré es ${mmss(tiempoDe(inicio))}, pero solo coincide en un ${pct} % con lo que detectó Acordia. `
        + '¿Ponerlos ahí? (Si no, cancela, toca el pulso donde empieza la primera casilla y elige «Desde el pulso seleccionado»).')) return;
      nota = ` (coincidía en un ${pct} % con lo detectado)`;
    }
    recordar();
    pulsos.forEach((p, k) => {
      const i = inicio + k;
      if (p.tipo === 'acorde') rep.porPulso[i] = p.acorde;
      else if (p.tipo === 'N') rep.porPulso[i] = 'N';
      else if (k > 0) rep.porPulso[i] = rep.porPulso[i - 1];
      else return; // un punto al principio: sigue lo que ya había
      rep.editado[i] = true;
    });
    // Que se vea igual que la imagen:
    //  - los compases empiezan donde empiezan en la imagen ("|" cada 4 casillas),
    const extras = [];
    if (conCompases) {
      const nuevo = mod(inicio - previas, 4);
      if (nuevo !== rep.primerTiempo) { rep.primerTiempo = nuevo; extras.push('compases como en la imagen'); }
      // Y las filas de la parrilla (4 compases) empiezan en el mismo compás que las filas de la imagen.
      const compasImagen = Math.round((inicio - previas + posicion(0)) / 4);
      rep.compasesExtra = mod(-compasImagen, 4);
    }
    //  - los acordes se escriben con ♭ o ♯ como en la imagen (según la tonalidad de esos acordes),
    const tono = tonalidadDeAcordes(secuencia);
    if (tono && tono !== rep.c.tonalidad && Acordes.alteracionDe(tono) !== Acordes.alteracionDe(rep.c.tonalidad || '')) {
      rep.c.tonalidad = tono; extras.push(`tonalidad ${mostrarAcorde(tono)}`);
    }
    //  - y en Do Re Mi si la imagen está en notación latina.
    const nombres = pulsos.filter(p => p.tipo === 'acorde').length;
    const latinos = (texto.match(/(^|\s)(Do|Re|Mi|Fa|Sol|La|Si)(?=[#bm0-9/\s]|$)/g) || []).length;
    if (nombres && latinos > nombres / 2 && app.notacion !== 'latina') {
      const boton = document.querySelector('#m-mas [data-notacion="latina"]');
      if (boton) { boton.click(); cerrarMenus(); extras.push('notación Do Re Mi'); }
    }
    hayCambios();
    pintarTodo();
    pintarDetalles();
    pintarHerramientas();
    seleccionar(inicio);   // solo la primera casilla: así la parrilla se ve como la imagen
    const celda = rep.celdasTira[inicio];
    if (celda) seguirEnTira(celda, false);
    avisar(`Puse ${L} pulsos desde ${mmss(tiempoDe(inicio))}${nota}${extras.length ? ' (' + extras.join(', ') + ')' : ''}. Revísalo con play y pulsa Guardar.`);
  }

  // ---------- marcar cambios en vivo
  function abrirPanelMarcar() {
    const panel = $('#panel-marcar');
    panel.hidden = false;
    $('#b-marcar-base').hidden = !rep.c.spotifyId;
    const pendiente = secuenciasPendientes.get(rep.c.id) || rep.secuenciaParaMarcar;
    if (pendiente && pendiente.secuencia) { secuenciasPendientes.delete(rep.c.id); rep.secuenciaParaMarcar = null; iniciarMarcado(pendiente.secuencia, pendiente.desdeBase ? 'BASE_DATOS' : 'MANUAL'); }
    else if (!rep.marcado) { $('#marcar-sin-secuencia').hidden = false; $('#marcar-con-secuencia').hidden = true; }
    panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function iniciarMarcado(secuencia, origen) {
    const limpia = secuencia.map(a => Acordes.normalizar(a)).filter(a => a && a !== 'N');
    if (!limpia.length) { avisar('No hay acordes para marcar.', true); return; }
    rep.marcado = { secuencia: limpia, indice: 0, origen, eventos: [] };
    $('#marcar-sin-secuencia').hidden = true;
    $('#marcar-con-secuencia').hidden = false;
    pintarSecuenciaMarcado();
    avisar('Dale play y toca Espacio en cada cambio de acorde.');
  }

  function pintarSecuenciaMarcado() {
    const m = rep.marcado;
    $('#marcar-secuencia').innerHTML = m.secuencia.map((a, k) => `<span class="ficha ${k < m.indice ? 'hecha' : k === m.indice ? 'proxima' : ''}">${esc(mostrarAcorde(a))}</span>`).join('');
    const proxima = $('#marcar-secuencia .proxima');
    if (proxima) proxima.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function tocarCambio() {
    const m = rep && rep.marcado;
    if (!m) return;
    if (m.indice >= m.secuencia.length) { avisar('Ya asignaste todos los acordes de la lista. Pulsa Terminar y guardar.'); return; }
    const t = rep.reproductor.tiempo() - rep.desfase;
    const ultimo = m.eventos[m.eventos.length - 1];
    if (ultimo) { if (t <= ultimo.inicio + 0.05) return; ultimo.fin = t; }
    m.eventos.push({ inicio: t, fin: t + 2, acorde: m.secuencia[m.indice], origen: m.origen });
    m.indice++;
    pintarSecuenciaMarcado();
    if (rep.modo === 'eventos') { rep.eventos = m.eventos; pintarTira(); pintarVista(); }
  }

  function deshacerCambio() {
    const m = rep && rep.marcado;
    if (!m || !m.eventos.length) return;
    m.eventos.pop(); m.indice--;
    const ultimo = m.eventos[m.eventos.length - 1];
    if (ultimo) ultimo.fin = ultimo.inicio + 2;
    pintarSecuenciaMarcado();
    if (rep.modo === 'eventos') { rep.eventos = m.eventos; pintarTira(); pintarVista(); }
  }

  async function terminarMarcado() {
    const m = rep && rep.marcado;
    if (!m || !m.eventos.length) { avisar('Todavía no marcaste ningún cambio.', true); return; }
    const duracion = rep.reproductor.duracion() || m.eventos[m.eventos.length - 1].inicio + 4;
    m.eventos[m.eventos.length - 1].fin = Math.max(duracion, m.eventos[m.eventos.length - 1].inicio + 0.5);
    if (rep.modo === 'eventos') rep.eventos = m.eventos.map(e => ({ ...e }));
    else {
      let j = 0;
      for (let i = 0; i < rep.pulsos.length; i++) {
        const t = rep.pulsos[i] + 0.02;
        while (j < m.eventos.length && m.eventos[j].fin <= t) j++;
        const e = m.eventos[j];
        rep.porPulso[i] = e && e.inicio <= t ? e.acorde : 'N';
        rep.editado[i] = true;
      }
    }
    rep.marcado = null;
    $('#panel-marcar').hidden = true;
    rep.cambios = true;
    pintarTodo();
    await guardar();
  }

  // ============================================================ MENÚS DESPLEGABLES
  let menuAbierto = null;
  function abrirMenu(boton, menu) {
    if (menuAbierto && menuAbierto.menu === menu) { cerrarMenus(); return; }
    cerrarMenus();
    menu.hidden = false;
    boton.setAttribute('aria-expanded', 'true');
    const r = boton.getBoundingClientRect();
    const ancho = menu.offsetWidth;
    let izquierda = menu.classList.contains('menu-derecha') ? r.right - ancho : r.left;
    izquierda = Math.min(Math.max(12, izquierda), window.innerWidth - ancho - 12);
    menu.style.left = izquierda + 'px';
    menu.style.top = Math.min(r.bottom + 6, window.innerHeight - menu.offsetHeight - 12) + 'px';
    menuAbierto = { boton, menu };
  }
  function cerrarMenus() {
    if (!menuAbierto) return;
    menuAbierto.menu.hidden = true;
    menuAbierto.boton.setAttribute('aria-expanded', 'false');
    menuAbierto = null;
  }

  // ============================================================ EVENTOS DE LA PÁGINA
  function iniciar() {
    // --- cabecera
    $('#b-tema').addEventListener('click', () => {
      const nuevo = document.documentElement.dataset.tema === 'oscuro' ? 'claro' : 'oscuro';
      document.documentElement.dataset.tema = nuevo;
      local.guardar('acordia.tema', nuevo);
      const meta = document.getElementById('color-tema');
      if (meta) meta.content = nuevo === 'oscuro' ? '#0c0b18' : '#ffffff';
    });
    $('#buscar').addEventListener('input', (e) => {
      app.filtro = e.target.value;
      if ($('#vista-biblioteca').hidden) { if (location.hash !== '#/' && location.hash !== '') location.hash = '#/'; }
      else pintarBiblioteca();
    });
    $('#filtros').addEventListener('click', (e) => {
      const b = e.target.closest('.filtro'); if (!b) return;
      app.filtroTipo = b.dataset.tipo; pintarBiblioteca();
    });
    $('#frecuentes').addEventListener('click', (e) => {
      const b = e.target.closest('.chip-hero'); if (!b) return;
      app.filtroAcorde = app.filtroAcorde === b.dataset.acorde ? null : b.dataset.acorde;
      pintarFrecuentes(); pintarBiblioteca();
    });
    $('#form-buscar').addEventListener('submit', (e) => { e.preventDefault(); if ($('#vista-biblioteca').hidden) location.hash = '#/'; else pintarBiblioteca(); });

    // --- nueva canción
    $$('#pestanas-fuente button').forEach(b => b.addEventListener('click', () => cambiarFuente(b.dataset.fuente)));
    $('#archivo').addEventListener('change', (e) => elegirArchivo(e.target.files[0]));
    const zona = $('#zona-archivo');
    ['dragenter', 'dragover'].forEach(t => zona.addEventListener(t, (e) => { e.preventDefault(); zona.classList.add('encima'); }));
    ['dragleave', 'drop'].forEach(t => zona.addEventListener(t, (e) => { e.preventDefault(); zona.classList.remove('encima'); }));
    zona.addEventListener('drop', (e) => elegirArchivo(e.dataTransfer.files[0]));
    $('#crear').addEventListener('click', crear);

    // --- reproductor
    $('#b-play').addEventListener('click', alternarReproduccion);
    $('#b-reiniciar').addEventListener('click', () => rep && rep.reproductor && rep.reproductor.irA(rep.bucle ? rep.bucle.a : 0));
    const barra = $('#barra-tiempo');
    barra.addEventListener('input', () => {
      if (!rep || !rep.reproductor) return;
      rep.arrastrando = true;
      if (rep.visto) { rep.visto.ta = null; rep.visto.pos = null; } // al soltar, el cuadro vuelve a escribir tiempo y barra
      $('#t-actual').textContent = mmss(Number(barra.value) / 1000 * rep.reproductor.duracion());
    });
    barra.addEventListener('change', () => {
      if (!rep || !rep.reproductor) return;
      rep.reproductor.irA(Number(barra.value) / 1000 * rep.reproductor.duracion());
      rep.arrastrando = false;
    });

    // --- herramientas
    $('#h-conteo').addEventListener('click', () => { app.conteo = !app.conteo; local.guardar('acordia.conteo', app.conteo); pintarHerramientas(); avisar(app.conteo ? 'Antes de empezar se contará 3, 2, 1 al ritmo de la canción.' : 'Conteo desactivado.'); });
    $('#h-volumen').addEventListener('click', (e) => abrirMenu(e.currentTarget, $('#m-volumen')));
    $('#volumen').addEventListener('input', (e) => { app.volumen = Number(e.target.value); local.guardar('acordia.volumen', app.volumen); if (rep && rep.reproductor) rep.reproductor.volumen(app.volumen / 100); });
    $('#h-instrumento').addEventListener('click', (e) => abrirMenu(e.currentTarget, $('#m-instrumento')));
    $$('#m-instrumento [data-instrumento]').forEach(b => b.addEventListener('click', () => {
      app.instrumento = b.dataset.instrumento; local.guardar('acordia.instrumento', app.instrumento);
      cerrarMenus(); pintarHerramientas(); if (rep) { firmaDiagramas = ''; actualizarDiagramasLaterales(true); pintarDiagramas(true); }
    }));
    $('#h-bucle').addEventListener('click', alternarBucle);
    const cambiarVelocidad = (paso) => {
      if (!rep || !rep.reproductor) return;
      let k = VELOCIDADES.indexOf(rep.velocidad); if (k < 0) k = VELOCIDADES.indexOf(1);
      k = Math.max(0, Math.min(VELOCIDADES.length - 1, k + paso));
      const real = rep.reproductor.velocidad(VELOCIDADES[k]);
      rep.velocidad = VELOCIDADES.includes(real) ? real : VELOCIDADES[k];
      if (real !== VELOCIDADES[k]) avisar(`YouTube solo tiene algunas velocidades: quedó en ${Math.round(real * 100)} %.`);
      pintarHerramientas();
    };
    $('#h-vel-menos').addEventListener('click', () => cambiarVelocidad(-1));
    $('#h-vel-mas').addEventListener('click', () => cambiarVelocidad(1));
    const cambiarCapo = (d) => { if (!rep) return; rep.capo = Math.max(0, Math.min(9, rep.capo + d)); pintarHerramientas(); actualizarDiagramasLaterales(true); pintarDiagramas(true); pintarDetalles(); guardarAjustesLuego(); };
    $('#h-capo-menos').addEventListener('click', () => cambiarCapo(-1));
    $('#h-capo-mas').addEventListener('click', () => cambiarCapo(1));
    const cambiarTono = (d) => { if (!rep) return; rep.transposicion = Math.max(-11, Math.min(11, rep.transposicion + d)); refrescarNombres(); guardarAjustesLuego(); };
    $('#h-tono-menos').addEventListener('click', () => cambiarTono(-1));
    $('#h-tono-mas').addEventListener('click', () => cambiarTono(1));
    $('#h-mas').addEventListener('click', (e) => abrirMenu(e.currentTarget, $('#m-mas')));
    $$('input[name="motor"]').forEach(r => r.addEventListener('change', () => { local.guardar('acordia.motor', motorElegido()); actualizarOpcionesMotor(); }));
    $$('#m-mas [data-nivel]').forEach(b => b.addEventListener('click', () => cambiarNivel(b.dataset.nivel === 'sencillo')));
    $('#practicar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-practica]');
      if (!b || !rep) return;
      if (b.dataset.practica === 'vuelta') practicarVuelta();
      else cambiarNivel(b.dataset.practica === 'sencillo');
    });
    $$('#m-mas [data-notacion]').forEach(b => b.addEventListener('click', () => {
      app.notacion = b.dataset.notacion; local.guardar('acordia.notacion', app.notacion);
      pintarHerramientas(); if (rep) { refrescarNombres(); if (rep.marcado) pintarSecuenciaMarcado(); }
    }));
    const fijarSinc = (ms) => {
      if (!rep) return;
      ms = Math.max(-500, Math.min(500, Math.round(ms / 10) * 10));
      rep.desfase = ms / 1000; $('#sinc').value = String(ms);
      pintarHerramientas(); pintarDetalles(); rep.indice = -2; guardarAjustesLuego();
    };
    $('#sinc').addEventListener('input', (e) => fijarSinc(Number(e.target.value)));
    $('#sinc-menos').addEventListener('click', () => rep && fijarSinc(rep.desfase * 1000 - 50));
    $('#sinc-mas').addEventListener('click', () => rep && fijarSinc(rep.desfase * 1000 + 50));
    $('#sinc-cero').addEventListener('click', () => fijarSinc(0));
    $('#tempo-doble').addEventListener('click', () => { cerrarMenus(); cambiarTempo(2); });
    $('#tempo-mitad').addEventListener('click', () => { cerrarMenus(); cambiarTempo(0.5); });
    $('#compas-mover').addEventListener('click', () => moverTiempoUno());
    $('#m-reanalizar').addEventListener('click', () => { cerrarMenus(); abrirPanelReanalizar(); });
    $('#m-marcar').addEventListener('click', () => { cerrarMenus(); abrirPanelMarcar(); });
    $('#m-importar').addEventListener('click', () => { cerrarMenus(); if (rep) abrirPanelImportar(); });
    $('#importar-archivo').addEventListener('change', (e) => { leerImagenes(e.target.files); e.target.value = ''; });
    $('#b-importar-aplicar').addEventListener('click', () => aplicarImportacion());
    $('#b-importar-limpiar').addEventListener('click', () => { $('#importar-texto').value = ''; $('#importar-vista').hidden = true; $('#importar-estado').textContent = 'O pega la captura con Ctrl+V.'; });
    document.addEventListener('paste', (e) => {
      if (!rep || $('#panel-importar').hidden) return;
      const imagenes = [...((e.clipboardData && e.clipboardData.files) || [])].filter(f => f.type.startsWith('image/'));
      if (imagenes.length) { e.preventDefault(); leerImagenes(imagenes); }
    });
    $('#m-eliminar').addEventListener('click', async () => {
      cerrarMenus();
      if (!rep || !confirm(`¿Eliminar "${rep.c.titulo}" de la biblioteca? No se puede deshacer.`)) return;
      try { await api('/api/canciones/' + rep.c.id, { method: 'DELETE' }); rep.cambios = false; location.hash = '#/'; avisar('Canción eliminada.'); }
      catch (e) { avisar(e.message, true); }
    });
    $('#detalles').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.id === 'bpm-editar') fijarTempo(Number(e.target.value));
      if (e.key === 'Enter' && e.target.id === 'desplazar-n') desplazarTodo(Number(e.target.value));
    });
    $('#detalles').addEventListener('click', (e) => {
      const b = e.target.closest('[data-accion]');
      if (!b) return;
      if (b.dataset.accion === 'doble') cambiarTempo(2);
      else if (b.dataset.accion === 'mitad') cambiarTempo(0.5);
      else if (b.dataset.accion === 'compas') moverTiempoUno();
      else if (b.dataset.accion === 'bpm') fijarTempo(Number($('#bpm-editar').value));
      else if (b.dataset.accion === 'aprender') cambiarAprendizaje(!rep.c.usarParaAprender);
      else if (b.dataset.accion === 'afinar-menos') afinarTempo(-0.1);
      else if (b.dataset.accion === 'afinar-mas') afinarTempo(0.1);
      else if (b.dataset.accion === 'desplazar-der') desplazarTodo(Number($('#desplazar-n').value));
      else if (b.dataset.accion === 'desplazar-izq') desplazarTodo(-Number($('#desplazar-n').value));
    });
    document.addEventListener('mousedown', (e) => {
      if (menuAbierto && !e.target.closest('.menu') && !e.target.closest('[aria-haspopup]')) cerrarMenus();
      if (!$('#selector').hidden && !e.target.closest('#selector') && !e.target.closest('#paleta-otro')) cerrarSelector();
      if (!$('#selector-evento').hidden && !e.target.closest('#selector-evento') && !e.target.closest('.celda, .pulso')) cerrarSelectorEvento();
    });
    window.addEventListener('resize', cerrarMenus);

    // --- vistas
    $$('#tabs-vista [data-vista]').forEach(b => b.addEventListener('click', () => { app.vista = b.dataset.vista; local.guardar('acordia.vista', app.vista); if (rep) { firmaDiagramas = ''; pintarVista(); rep.indice = -2; } }));
    $$('#tabs-modo [data-modo]').forEach(b => b.addEventListener('click', () => { app.modoVista = b.dataset.modo; local.guardar('acordia.modoVista', app.modoVista); if (rep) { firmaDiagramas = ''; pintarVista(); rep.indice = -2; } }));

    // --- clic, arrastre y selección en la tira y la parrilla
    const alPresionar = (e) => {
      const celda = e.target.closest('[data-i]');
      if (!celda || !rep) return;
      const i = Number(celda.dataset.i);
      if (rep.bucleModo) { clicBucle(i); return; }
      if (celda.dataset.resumen) { if (rep.reproductor) rep.reproductor.irA(tiempoDe(i) + rep.desfase + 0.01); return; }
      if (!rep.editando) { if (rep.reproductor) { rep.reproductor.irA(tiempoDe(i) + rep.desfase + 0.01); rep.indice = -2; } return; }
      e.preventDefault();
      if (e.shiftKey && rep.sel) seleccionar(rep.sel.ancla, i, rep.sel.ancla);
      else seleccionar(i);
      rep.arrastre = rep.modo === 'pulsos' ? { ancla: rep.sel.ancla } : null;
      if (rep.modo === 'eventos') abrirSelectorEvento(celda);
    };
    const alMover = (e) => {
      if (!rep || !rep.arrastre) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const celda = el && el.closest('[data-i]');
      if (celda && !celda.dataset.resumen) seleccionar(rep.arrastre.ancla, Number(celda.dataset.i), rep.arrastre.ancla);
    };
    ['#tira', '#cuadricula'].forEach(s => $(s).addEventListener('pointerdown', alPresionar));
    document.addEventListener('pointermove', alMover);
    document.addEventListener('pointerup', () => { if (rep) rep.arrastre = null; });

    // --- edición
    $('#b-editar').addEventListener('click', alternarEdicion);
    $('#paleta').addEventListener('click', (e) => {
      if (e.target.closest('#paleta-otro')) { abrirSelector(e.target.closest('#paleta-otro')); return; }
      if (e.target.closest('#paleta-borrar')) { borrarCambio(); return; }
      const b = e.target.closest('[data-acorde]');
      if (b) aplicarAcorde(b.dataset.acorde);
    });
    $('#e-izq').addEventListener('click', () => moverCambio(-1));
    $('#e-der').addEventListener('click', () => moverCambio(1));
    $('#e-copiar').addEventListener('click', copiar);
    $('#e-pegar').addEventListener('click', pegar);
    $('#e-escuchar').addEventListener('click', () => { if (!rep.sel) { avisar('Selecciona primero los pulsos que quieres escuchar.'); return; } fijarBucle(rep.sel.a, rep.sel.b); });
    $('#e-deshacer').addEventListener('click', deshacer);
    $('#e-rehacer').addEventListener('click', rehacer);
    $('#e-tono-menos').addEventListener('click', () => corregirTono(-1));
    $('#e-tono-mas').addEventListener('click', () => corregirTono(1));
    $('#e-guardar').addEventListener('click', async () => { if (await guardar()) salirEdicion(); });
    $('#e-descartar').addEventListener('click', () => {
      if (rep.cambios && !confirm('¿Descartar los cambios que hiciste?')) return;
      if (rep.cambios) restaurar(rep.alEntrar);
      salirEdicion();
    });
    $('#selector-raices').addEventListener('click', (e) => { const b = e.target.closest('[data-raiz]'); if (!b || !seleccionSelector) return; seleccionSelector.raiz = Number(b.dataset.raiz); $('#selector-texto').value = ''; marcarSelector(); });
    $('#selector-calidades').addEventListener('click', (e) => { const b = e.target.closest('[data-calidad]'); if (!b || !seleccionSelector) return; seleccionSelector.calidad = b.dataset.calidad; $('#selector-texto').value = ''; marcarSelector(); });
    $('#selector-texto').addEventListener('input', () => seleccionSelector && marcarSelector());
    $('#selector-texto').addEventListener('keydown', (e) => { if (e.key === 'Enter') aplicarSelector(); });
    $('#selector-aplicar').addEventListener('click', aplicarSelector);
    $('#selector-cancelar').addEventListener('click', cerrarSelector);
    $('#sev-antes').addEventListener('click', () => moverCambio(-1));
    $('#sev-despues').addEventListener('click', () => moverCambio(1));
    $('#sev-aqui').addEventListener('click', eventoEmpiezaAqui);
    $('#sev-borrar').addEventListener('click', eventoBorrar);

    // --- paneles
    $('#b-reanalizar-ir').addEventListener('click', reanalizar);
    $('#b-detener-captura').addEventListener('click', () => { if (detenerCaptura) detenerCaptura(); });
    $('#b-tap').addEventListener('click', tocarTempo);
    $('#b-marcar-tap').addEventListener('click', tocarCambio);
    $('#b-marcar-deshacer').addEventListener('click', deshacerCambio);
    $('#b-marcar-reiniciar').addEventListener('click', () => {
      if (!rep || !rep.marcado) return;
      iniciarMarcado(rep.marcado.secuencia, rep.marcado.origen);
      if (rep.modo === 'eventos') { rep.eventos = rep.c.eventos.map(e => ({ ...e })); pintarTira(); pintarVista(); }
    });
    $('#b-marcar-terminar').addEventListener('click', terminarMarcado);
    $('#b-marcar-cargar').addEventListener('click', async () => {
      const texto = $('#marcar-texto').value.trim();
      if (!texto) { avisar('Pega primero los acordes.', true); return; }
      try { iniciarMarcado((await api('/api/referencias/convertir', { method: 'POST', texto })).secuencia, 'MANUAL'); }
      catch (e) { avisar(e.message, true); }
    });
    $('#b-marcar-base').addEventListener('click', async () => {
      try { iniciarMarcado((await api('/api/referencias/' + encodeURIComponent(rep.c.spotifyId))).secuencia, 'BASE_DATOS'); }
      catch (e) { avisar(e.message, true); }
    });
    $$('[data-cerrar]').forEach(b => b.addEventListener('click', () => { $('#' + b.dataset.cerrar).hidden = true; }));

    // --- teclado
    document.addEventListener('keydown', (e) => {
      if (!rep || !rep.reproductor || $('#vista-reproductor').hidden) return;
      if (e.target.closest('input, textarea, select, [contenteditable]')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') { cerrarSelector(); cerrarSelectorEvento(); cerrarMenus(); if (rep.bucleModo || rep.bucle) alternarBucle(); else if (rep.editando) { rep.sel = null; pintarSeleccion(); } return; }
      if (e.code === 'Space') {
        e.preventDefault();
        if (rep.marcado && !$('#panel-marcar').hidden) tocarCambio(); else alternarReproduccion();
        return;
      }
      // Deshacer / rehacer también fuera del modo edición (por ejemplo, tras Desplazar o Corregir tono).
      if (ctrl && e.key.toLowerCase() === 'z' && (rep.editando || rep.deshacer.length || rep.rehacer.length)) { e.preventDefault(); if (e.shiftKey) rehacer(); else deshacer(); return; }
      if (ctrl && e.key.toLowerCase() === 'y' && (rep.editando || rep.rehacer.length)) { e.preventDefault(); rehacer(); return; }
      if (rep.editando) {
        if (ctrl && e.key.toLowerCase() === 'c') { copiar(); return; }
        if (ctrl && e.key.toLowerCase() === 'v') { pegar(); return; }
        if (/^[1-9]$/.test(e.key) && rep.paleta && rep.paleta[Number(e.key) - 1]) { aplicarAcorde(rep.paleta[Number(e.key) - 1]); return; }
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); borrarCambio(); return; }
        if (e.key === '0') { aplicarAcorde('N'); return; }
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && rep.sel) {
          e.preventDefault();
          const d = e.key === 'ArrowLeft' ? -1 : 1;
          if (e.shiftKey) { const extremo = rep.sel.ancla === rep.sel.a ? rep.sel.b : rep.sel.a; seleccionar(rep.sel.ancla, extremo + d, rep.sel.ancla); }
          else seleccionar(rep.sel.a + d);
          const el = rep.celdasTira[rep.sel.a]; if (el) seguirEnTira(el, true); // teclado: salto inmediato, sin animación
          return;
        }
      }
      if (e.key === 'ArrowLeft') rep.reproductor.irA(rep.reproductor.tiempo() - 5);
      else if (e.key === 'ArrowRight') rep.reproductor.irA(rep.reproductor.tiempo() + 5);
    });

    pintarHerramientas();
    enrutar();
  }

  iniciar();
})();
