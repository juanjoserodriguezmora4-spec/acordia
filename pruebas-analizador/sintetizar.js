/* Genera audio de prueba: una progresión inventada tocada con notas con armónicos, bajo, bombo y platillo. */
// Genera audio de prueba: progresión inventada, piano/guitarra simple con armónicos + bombo en cada pulso.
const NOTAS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
function notasAcorde(nombre){ const m=/^([A-G]#?)(m?)$/.exec(nombre); const r=NOTAS.indexOf(m[1]); return [r, r+(m[2]?3:4), r+7]; }
function sintetizar({ progresion, bpm, pulsosPorAcorde, sr=11025, desafinacionCents=0, ruido=0.02, transponer=0, semilla=1 }){
  let s=semilla; const azar=()=>{ s=(s*16807)%2147483647; return s/2147483647; };
  const dur = 60/bpm, totalPulsos = progresion.length*pulsosPorAcorde;
  const intro = 0.7; // silencio inicial
  const n = Math.ceil((intro + totalPulsos*dur + 0.5)*sr);
  const x = new Float32Array(n); const verdad=[];
  const factor = Math.pow(2, desafinacionCents/1200);
  for (let p=0;p<totalPulsos;p++){
    const t0 = intro + p*dur; const acorde = progresion[Math.floor(p/pulsosPorAcorde)];
    const notas = notasAcorde(acorde).map(v=>v+transponer);
    const tr = (()=>{ const m=/^([A-G]#?)(m?)$/.exec(acorde); return NOTAS[(NOTAS.indexOf(m[1])+transponer+120)%12]+m[2]; })();
    verdad.push({ t:t0, acorde: tr });
    const i0=Math.floor(t0*sr), largo=Math.floor(dur*sr);
    // bajo (raíz una octava abajo) + acorde en octava media + una nota alta
    const voces = [ {midi:36+notas[0]%12+12, a:0.5}, ...notas.map(v=>({midi:48+v, a:0.35})), {midi:60+notas[2], a:0.15} ];
    for (const v of voces){
      const f = 440*Math.pow(2,(v.midi-69)/12)*factor;
      for (let i=0;i<largo && i0+i<n;i++){
        const t=i/sr, env=Math.exp(-2.2*t)*0.9+0.1;
        let y=0; for (let h=1;h<=6;h++) y += Math.sin(2*Math.PI*f*h*t)/(h*h*0.8);
        x[i0+i] += v.a*env*y*0.25;
      }
    }
    // bombo
    for (let i=0;i<Math.floor(0.12*sr);i++){ const t=i/sr; x[i0+i]+=0.6*Math.sin(2*Math.PI*(60+60*Math.exp(-30*t))*t)*Math.exp(-25*t); }
    // hi-hat en contratiempo
    const ih=Math.floor((t0+dur/2)*sr); for (let i=0;i<Math.floor(0.03*sr);i++){ x[ih+i]+=0.05*(azar()*2-1)*Math.exp(-150*i/sr); }
  }
  for (let i=0;i<n;i++) x[i]+= ruido*(azar()*2-1)*0.3;
  return { muestras:x, sr, verdad, duracion:n/sr };
}
module.exports = { sintetizar };
