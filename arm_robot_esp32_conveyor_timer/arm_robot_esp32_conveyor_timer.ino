#include <WiFi.h>
#include <WebServer.h>
#include <ESP32Servo.h>
#include <Preferences.h>
#include <ESPmDNS.h>

// ================= PENGATURAN =================
// Hotspot HP (ESP32 dan laptop sama-sama menyambung ke hotspot ini)
const char* STA_SSID  = "modaldikitlah";
const char* STA_PASS  = "12345678";
const char* NAMA_HOST = "armrobot";    // alamat cadangan: http://armrobot.local

// Urutan: [0]=BASE [1]=SIKU [2]=LENGAN ATAS [3]=CAPIT
const int PIN_SERVO[4] = { 27, 26, 25, 32 };
const int MAX_SUDUT[4] = { 180, 180, 180, 180 };  // batas atas tiap servo (mis. capit 65)

// ---- Conveyor (driver L298N) ----
const int PIN_ENA = 18;   // ENA (kecepatan, PWM)
const int PIN_IN1 = 19;   // IN1
const int PIN_IN2 = 21;   // IN2

// ---- Sensor IR di ujung conveyor ----
const int  PIN_SENSOR       = 34;     // pin OUT sensor (34 = input saja, aman)
const bool SENSOR_AKTIF_LOW = true;   // modul IR umumnya OUT = LOW saat ada barang
                                      // kalau terbalik (conveyor berhenti padahal kosong), ubah ke false
const bool KONVEYOR_MULAI_OTOMATIS = false;  // true = conveyor langsung jalan saat ESP32 menyala
// =============================================

// 1 langkah = 1 servo bergerak ke 1 sudut
//   s = nomor servo (0-3), a = sudut, v = kecepatan (ms/derajat, 0 = ikut kecepatan global),
//   j = jeda sesudah langkah selesai (ms)
struct Step { uint8_t s; uint8_t a; uint8_t v; uint16_t j; };

const int MAXSTEP = 40;
Step steps[MAXSTEP];
int nSteps = 0;

Servo sv[4];
int pos[4]    = { 0, 0, 0, 0 };   // posisi sekarang
int target[4] = { 0, 0, 0, 0 };   // posisi tujuan

int  jedaPerDerajat = 35;   // kecepatan global (ms per derajat, makin besar makin pelan)
int  jedaAktif      = 35;   // kecepatan yang sedang dipakai
bool playing = false, loopPlay = false, holding = false;
int  idxPlay = 0;
unsigned long tMove = 0, tHold = 0;

// ---- status conveyor ----
ESP32PWM pwmEna;
bool konvOn     = false;    // tombol Jalan (keinginan pengguna)
bool motorJalan = false;    // motor benar-benar berputar
bool sensorRaw  = false;    // bacaan sensor mentah
bool sensorStab = false;    // bacaan sensor yang sudah stabil (ada barang)
int  holdDetik  = 5;        // lama conveyor berhenti saat barang terdeteksi (detik, 0 = berhenti terus)
bool arahBalik  = false;    // balik arah putaran
int  kecKonv    = 70;       // kecepatan conveyor (persen)
unsigned long tSensor = 0;

// status conveyor: jalan -> tahan (berhenti sebentar) -> lewat (jalan, abaikan sensor sampai barang pergi)
enum KState { K_JALAN, K_TAHAN, K_LEWAT };
KState kState = K_JALAN;
unsigned long tTahan = 0;

WebServer server(80);
Preferences prefs;

// ---------- simpan / muat ----------
void simpanSemua() {
  prefs.putInt("n", nSteps);
  prefs.putBytes("stp2", steps, sizeof(steps));
  prefs.putInt("spd", jedaPerDerajat);
}
void simpanKonv() {
  prefs.putInt("kp", kecKonv);
  prefs.putBool("kb", arahBalik);
  prefs.putInt("kh", holdDetik);
}
void muatSemua() {
  nSteps = 0;
  if (prefs.getBytesLength("stp2") == sizeof(steps)) {
    prefs.getBytes("stp2", steps, sizeof(steps));
    nSteps = prefs.getInt("n", 0);
    if (nSteps < 0 || nSteps > MAXSTEP) nSteps = 0;
  }
  jedaPerDerajat = prefs.getInt("spd", 35);
  jedaAktif = jedaPerDerajat;
  kecKonv    = constrain(prefs.getInt("kp", 70), 30, 100);
  arahBalik  = prefs.getBool("kb", false);
  holdDetik  = constrain(prefs.getInt("kh", 5), 0, 120);
}

// ---------- conveyor ----------
bool bacaSensor() {
  int v = digitalRead(PIN_SENSOR);
  return SENSOR_AKTIF_LOW ? (v == LOW) : (v == HIGH);
}
void terapkanMotor() {
  if (motorJalan) {
    bool maju = !arahBalik;
    digitalWrite(PIN_IN1, maju ? HIGH : LOW);
    digitalWrite(PIN_IN2, maju ? LOW : HIGH);
    pwmEna.write(map(kecKonv, 0, 100, 0, 255));
  } else {
    pwmEna.write(0);
    digitalWrite(PIN_IN1, LOW);
    digitalWrite(PIN_IN2, LOW);
  }
}
void sensorTick() {
  bool r = bacaSensor();
  if (r != sensorRaw) { sensorRaw = r; tSensor = millis(); }
  // barang terdeteksi harus stabil 80 ms, kosong harus stabil 300 ms (anti noise)
  unsigned long perlu = r ? 80 : 300;
  if (sensorStab != r && millis() - tSensor >= perlu) {
    sensorStab = r;
  }
}
void konveyorTick() {
  unsigned long now = millis();

  switch (kState) {
    case K_JALAN:
      if (konvOn && sensorStab) {                 // barang sampai di ujung
        if (holdDetik > 0) { kState = K_TAHAN; tTahan = now; }
        else konvOn = false;                      // 0 detik = berhenti terus sampai ditekan Jalan
      }
      break;
    case K_TAHAN:
      if (!konvOn) kState = K_JALAN;              // dihentikan manual
      else if (now - tTahan >= (unsigned long)holdDetik * 1000UL) kState = K_LEWAT;
      break;
    case K_LEWAT:
      if (!konvOn || !sensorStab) kState = K_JALAN;   // barang sudah pergi / diambil
      break;
  }

  bool jalan = konvOn && kState != K_TAHAN && !(kState == K_JALAN && sensorStab);
  if (jalan != motorJalan) {
    motorJalan = jalan;
    terapkanMotor();
  }
}

// ---------- gerak ----------
bool sampai() {
  for (int i = 0; i < 4; i++) if (pos[i] != target[i]) return false;
  return true;
}
void jalankanStep(int n) {
  Step &st = steps[n];
  int i = constrain((int)st.s, 0, 3);
  target[i] = constrain((int)st.a, 0, MAX_SUDUT[i]);
  jedaAktif = st.v > 0 ? st.v : jedaPerDerajat;
}
void engine() {
  unsigned long now = millis();
  if (now - tMove < (unsigned long)jedaAktif) return;
  tMove = now;
  for (int i = 0; i < 4; i++) {
    if (pos[i] != target[i]) {
      pos[i] += (target[i] > pos[i]) ? 1 : -1;
      sv[i].write(pos[i]);
    }
  }
}
void playTick() {
  if (!playing) return;
  if (!sampai()) { holding = false; return; }
  if (!holding) { holding = true; tHold = millis(); return; }
  if (millis() - tHold < (unsigned long)steps[idxPlay].j) return;
  idxPlay++;
  if (idxPlay >= nSteps) {
    if (loopPlay) idxPlay = 0;
    else { playing = false; idxPlay = 0; jedaAktif = jedaPerDerajat; return; }
  }
  jalankanStep(idxPlay);
  holding = false;
}

// ---------- web ----------
void sendState() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "*");
  String j = "{\"pos\":[";
  for (int i = 0; i < 4; i++) { j += pos[i]; if (i < 3) j += ","; }
  j += "],\"tgt\":[";
  for (int i = 0; i < 4; i++) { j += target[i]; if (i < 3) j += ","; }
  j += "],\"max\":[";
  for (int i = 0; i < 4; i++) { j += MAX_SUDUT[i]; if (i < 3) j += ","; }
  j += "],\"spd\":"; j += jedaPerDerajat;
  j += ",\"play\":"; j += (playing ? 1 : 0);
  j += ",\"loop\":"; j += (loopPlay ? 1 : 0);
  j += ",\"idx\":"; j += idxPlay;
  j += ",\"kv\":"; j += (konvOn ? 1 : 0);
  j += ",\"kr\":"; j += (motorJalan ? 1 : 0);
  j += ",\"ks\":"; j += (sensorStab ? 1 : 0);
  j += ",\"kp\":"; j += kecKonv;
  j += ",\"kb\":"; j += (arahBalik ? 1 : 0);
  j += ",\"kh\":"; j += holdDetik;
  j += ",\"ksn\":"; j += (int)kState;
  long sisa = 0;
  if (kState == K_TAHAN) {
    sisa = (long)holdDetik * 1000 - (long)(millis() - tTahan);
    if (sisa < 0) sisa = 0;
  }
  j += ",\"kt\":"; j += (sisa + 999) / 1000;
  j += ",\"steps\":[";
  for (int k = 0; k < nSteps; k++) {
    j += "["; j += steps[k].s; j += ",";
    j += steps[k].a; j += ",";
    j += steps[k].v; j += ",";
    j += steps[k].j; j += "]";
    if (k < nSteps - 1) j += ",";
  }
  j += "]}";
  server.send(200, "application/json", j);
}

Step bacaStep() {
  Step st;
  st.s = constrain(server.arg("s").toInt(), 0, 3);
  st.a = constrain(server.arg("a").toInt(), 0, MAX_SUDUT[st.s]);
  st.v = constrain(server.arg("v").toInt(), 0, 200);
  st.j = constrain(server.arg("j").toInt(), 0, 20000);
  return st;
}

const char HALAMAN[] PROGMEM = R"rawliteral(
<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Arm Robot Control</title>
<style>
:root{--bg:#0c0f16;--card:#151a25;--line:#252c3b;--tx:#e8ecf5;--mut:#8b94a9;--pri:#4f8cff;--ok:#2ecc9a;--bad:#ff5d73}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:radial-gradient(1200px 600px at 50% -200px,#1a2340,var(--bg));color:var(--tx);min-height:100vh}
.wrap{max-width:760px;margin:auto;padding:14px 14px 80px}
header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:6px 0 14px}
h1{font-size:20px;margin:0}h1 small{display:block;font-size:12px;color:var(--mut);font-weight:400}
.chip{display:inline-block;padding:4px 10px;border-radius:99px;background:#222a3b;color:var(--mut);font-size:12px;font-weight:600}
.chip.on{background:#1d4d3b;color:#6ff0c0}.chip.warn{background:#4a3a12;color:#ffd770}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;margin:12px 0}
.card h3{margin:0 0 10px;font-size:14px;letter-spacing:.3px;color:#c9d2e6;display:flex;justify-content:space-between;align-items:center}
.card h3 span{font-weight:400;font-size:12px;color:var(--mut)}
#live{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
@media(min-width:620px){#live{grid-template-columns:repeat(4,1fr)}}
.lv{background:#10141d;border:2px solid var(--line);border-radius:14px;padding:10px;cursor:pointer;transition:.15s}
.lv.sel{border-color:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 22%,transparent)}
.lt{font-size:11px;color:var(--c);font-weight:700;letter-spacing:.5px}
.lg{font-size:28px;font-weight:700;margin:2px 0 6px}.lg span{font-variant-numeric:tabular-nums}
.bar{height:6px;border-radius:9px;background:#222a3b;overflow:hidden}
.bar i{display:block;height:100%;width:0;background:var(--c);transition:width .25s}
.lm{font-size:11px;color:var(--mut);margin-top:6px}
#seg{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:12px}
@media(min-width:620px){#seg{grid-template-columns:repeat(4,1fr)}}
#seg button{background:#10141d;color:var(--tx);border:2px solid var(--line);border-radius:12px;padding:10px 6px;font-size:13px;font-weight:600;cursor:pointer}
#seg button.sel{border-color:var(--c);background:color-mix(in srgb,var(--c) 18%,#10141d);color:#fff}
label.f{display:block;font-size:12px;color:var(--mut);margin:10px 0 4px}
.row{display:flex;gap:10px;align-items:center}
.row>*{flex:1}
input[type=range]{width:100%;accent-color:var(--pri);height:28px}
input[type=number]{width:100%;background:#10141d;border:1px solid var(--line);color:var(--tx);border-radius:10px;padding:10px;font-size:15px}
.big{font-size:30px;font-weight:700;min-width:70px;text-align:right;flex:0 0 auto}
.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
button.b{background:var(--pri);color:#fff;border:0;border-radius:11px;padding:11px 14px;font-size:14px;font-weight:600;cursor:pointer}
button.b:active{transform:scale(.97)}
button.b.g{background:#1f9d72}button.b.r{background:#c8435a}button.b.n{background:#2a3347;color:var(--tx)}
.btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.btns .b{flex:1 1 auto}
.chk{font-size:13px;color:var(--mut);display:flex;gap:6px;align-items:center}
#edbar{display:none;background:#3a2f12;border:1px solid #6b5416;color:#ffd770;padding:8px 12px;border-radius:10px;font-size:13px;margin-bottom:10px}
#list{display:flex;flex-direction:column;gap:8px}
.st{display:flex;align-items:center;gap:10px;background:#10141d;border:2px solid var(--line);border-radius:14px;padding:10px}
.st.on{border-color:var(--ok);background:#12261f}.st.ed{border-color:#e0a82e}
.no{width:30px;height:30px;border-radius:50%;background:#222a3b;display:grid;place-items:center;font-weight:700;font-size:13px;flex:0 0 auto}
.bd{flex:1;min-width:0}
.tag{display:inline-block;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:700;color:#0c0f16;margin-right:6px}
.bd b{font-size:17px}.sub{font-size:11px;color:var(--mut);margin-top:3px}
.ac{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end;max-width:150px}
.ac button{background:#222a3b;border:0;color:var(--tx);border-radius:9px;width:32px;height:32px;font-size:14px;cursor:pointer}
.ac button.x{background:#4a2330;color:#ff9fb0}
.empty{text-align:center;color:var(--mut);padding:22px;font-size:13px}
#toast{position:fixed;left:50%;bottom:22px;transform:translate(-50%,40px);background:#1f9d72;color:#fff;padding:10px 18px;border-radius:99px;font-size:13px;font-weight:600;opacity:0;transition:.25s;pointer-events:none}
#toast.show{opacity:1;transform:translate(-50%,0)}#toast.bad{background:#c8435a}
</style></head><body><div class="wrap">

<header>
 <h1>Arm Robot<small>ESP32 &bull; hotspot HP</small></h1>
 <span class="chip" id="stat">Siaga</span>
</header>

<div class="card"><h3>Posisi servo <span>ketuk untuk memilih</span></h3><div id="live"></div></div>

<div class="card">
 <h3>Editor langkah <span>1 langkah = 1 servo</span></h3>
 <div id="edbar"></div>
 <label class="f">Servo</label>
 <div id="seg"></div>

 <label class="f">Sudut</label>
 <div class="row">
  <input type="range" id="ang" min="0" max="180" value="0" oninput="onAng(this.value)">
  <div class="big"><span id="angv">0</span>&deg;</div>
 </div>
 <div class="two">
  <div><label class="f">Ketik sudut (&deg;)</label><input type="number" id="angn" min="0" max="180" value="0" oninput="onAng(this.value)"></div>
  <div><label class="f">Jeda sesudahnya (ms)</label><input type="number" id="jeda" min="0" max="20000" step="100" value="800"></div>
 </div>
 <label class="f">Kecepatan langkah ini (ms/derajat, 0 = ikut global)</label>
 <input type="number" id="spdl" min="0" max="200" value="0">

 <div class="btns">
  <label class="chk"><input type="checkbox" id="prev" checked> Servo ikut bergerak saat slider digeser</label>
 </div>
 <div class="btns">
  <button class="b n" onclick="ambil()">Ambil sudut sekarang</button>
  <button class="b g" id="btnSimpan" onclick="simpan()">+ Tambah Langkah</button>
  <button class="b r" id="btnBatal" style="display:none" onclick="batal()">Batal</button>
 </div>
</div>

<div class="card">
 <h3>Kontrol <span>urutan langkah</span></h3>
 <div class="btns" style="margin-top:0">
  <button class="b g" onclick="main()">&#9654; Main</button>
  <button class="b r" onclick="api('/stop')">&#9632; Stop</button>
  <button class="b n" onclick="api('/home')">Home (0&deg;)</button>
 </div>
 <div class="btns"><label class="chk"><input type="checkbox" id="loop" onchange="main(1)"> Ulang terus</label></div>
 <label class="f">Kecepatan global: <b id="spdv">35</b> ms/derajat (besar = pelan)</label>
 <input type="range" id="spd" min="5" max="100" value="35" oninput="$('spdv').textContent=this.value" onchange="api('/cfg?spd='+this.value)">
</div>

<div class="card">
 <h3>Conveyor <span id="kst">Berhenti</span></h3>
 <div class="btns" style="margin-top:0">
  <button class="b g" onclick="api('/kv?on=1')">&#9654; Jalan</button>
  <button class="b r" onclick="api('/kv?on=0')">&#9632; Stop</button>
  <span class="chip" id="ksen" style="align-self:center">Sensor: kosong</span>
 </div>
 <label class="f">Kecepatan conveyor: <b id="kpv">70</b>%</label>
 <input type="range" id="kp" min="30" max="100" value="70" oninput="$('kpv').textContent=this.value" onchange="kcfg()">
 <label class="f">Waktu berhenti saat barang terdeteksi (detik)</label>
 <input type="number" id="kh" min="0" max="120" step="1" value="5" onchange="kcfg()">
 <div class="lm" style="font-size:11px;color:var(--mut);margin-top:4px">Setelah waktu habis conveyor jalan lagi. Isi 0 = berhenti terus sampai tombol Jalan ditekan.</div>
 <div class="btns" style="margin-top:4px">
  <label class="chk"><input type="checkbox" id="kb" onchange="kcfg()"> Balik arah putaran</label>
 </div>
</div>

<div class="card">
 <h3>Daftar langkah <span id="cnt">0 langkah</span></h3>
 <div id="list"></div>
 <div class="btns"><button class="b r" onclick="if(confirm('Hapus SEMUA langkah?'))api('/clear')">Hapus semua</button></div>
</div>

</div><div id="toast"></div>

<script>
const N=["BASE","SIKU","LENGAN ATAS","CAPIT"],C=["#4f8cff","#2ecc9a","#ffb020","#ff5d73"];
const $=id=>document.getElementById(id);
let S={pos:[0,0,0,0],tgt:[0,0,0,0],max:[180,180,180,180],steps:[],play:0,idx:0,spd:35,loop:0,kv:0,kr:0,ks:0,kp:70,kb:0,kh:5,ksn:0,kt:0};
let sel=0,editIdx=-1,tm=null,sig='',first=true;

function toast(t,bad){const e=$('toast');e.textContent=t;e.className='show'+(bad?' bad':'');clearTimeout(e._t);e._t=setTimeout(()=>{e.className='';},1800);}
function api(u){return fetch(u).then(r=>r.json()).then(r=>{S=r;paint();return r;}).catch(()=>{toast('Tidak tersambung ke ESP32',1);});}

function build(){
 $('live').innerHTML=N.map((n,i)=>`<div class="lv" id="lv${i}" onclick="pick(${i})" style="--c:${C[i]}"><div class="lt">${n}</div><div class="lg"><span id="p${i}">0</span>&deg;</div><div class="bar"><i id="b${i}"></i></div><div class="lm">target <span id="t${i}">0</span>&deg;</div></div>`).join('');
 $('seg').innerHTML=N.map((n,i)=>`<button id="sg${i}" style="--c:${C[i]}" onclick="pick(${i})">${i+1}. ${n}</button>`).join('');
}
function mark(){for(let i=0;i<4;i++){$('lv'+i).classList.toggle('sel',i==sel);$('sg'+i).classList.toggle('sel',i==sel);}}
function setAng(v){$('ang').value=v;$('angn').value=v;$('angv').textContent=v;}
function pick(i){sel=i;mark();const mx=S.max[i];$('ang').max=mx;$('angn').max=mx;setAng(Math.min(S.tgt[i],mx));}
function onAng(v){
 v=Math.max(0,Math.min(S.max[sel],parseInt(v)||0));setAng(v);
 if($('prev').checked){clearTimeout(tm);tm=setTimeout(()=>api('/set?i='+sel+'&a='+v),60);}
}
function ambil(){setAng(S.pos[sel]);toast('Sudut diambil: '+S.pos[sel]+'\u00b0');}

function qs(){return 's='+sel+'&a='+$('ang').value+'&v='+(parseInt($('spdl').value)||0)+'&j='+(parseInt($('jeda').value)||0);}
function simpan(){
 if(editIdx>=0){const k=editIdx;api('/edit?n='+k+'&'+qs()).then(()=>{toast('Langkah '+(k+1)+' diperbarui');batal();});}
 else api('/add?'+qs()).then(()=>toast('Langkah ditambahkan'));
}
function edit(k){
 const st=S.steps[k];if(!st)return;
 editIdx=k;sel=st[0];mark();
 $('ang').max=S.max[sel];$('angn').max=S.max[sel];setAng(st[1]);
 $('spdl').value=st[2];$('jeda').value=st[3];
 $('edbar').style.display='block';$('edbar').textContent='Mengedit langkah #'+(k+1)+' ('+N[sel]+')';
 $('btnSimpan').textContent='Simpan Perubahan';$('btnBatal').style.display='';
 sig='';paint();window.scrollTo({top:0,behavior:'smooth'});
}
function batal(){
 editIdx=-1;$('edbar').style.display='none';
 $('btnSimpan').textContent='+ Tambah Langkah';$('btnBatal').style.display='none';
 sig='';paint();
}
function hapus(k){if(confirm('Hapus langkah #'+(k+1)+'?')){if(editIdx==k)batal();api('/del?n='+k);}}
function geser(k,d){api('/mv?n='+k+'&d='+d);}
function tes(k){api('/ke?n='+k);}
function main(only){
 if(only){ if(S.play)api('/play?loop='+($('loop').checked?1:0)); else api('/loopset?loop='+($('loop').checked?1:0)); return; }
 api('/play?loop='+($('loop').checked?1:0));
}
function kcfg(){const h=Math.max(0,Math.min(120,parseInt($('kh').value)||0));$('kh').value=h;api('/kcfg?p='+$('kp').value+'&b='+($('kb').checked?1:0)+'&h='+h);}

function paint(){
 for(let i=0;i<4;i++){
  $('p'+i).textContent=S.pos[i];$('t'+i).textContent=S.tgt[i];
  $('b'+i).style.width=(S.pos[i]/180*100)+'%';
 }
 const st=$('stat');
 if(S.play){st.textContent='Memutar langkah '+(S.idx+1)+' / '+S.steps.length;st.className='chip on';}
 else{st.textContent='Siaga';st.className='chip';}
 $('cnt').textContent=S.steps.length+' langkah';

 const kst=$('kst');
 if(S.ksn==1){kst.textContent='Barang di ujung: berhenti '+S.kt+' dtk lagi';}
 else if(S.kr){kst.textContent='Berjalan';}
 else if(S.kv&&S.ks){kst.textContent='Berhenti: ada barang di ujung';}
 else{kst.textContent='Berhenti';}
 const se=$('ksen');
 se.textContent=S.ks?'Sensor: ADA barang':'Sensor: kosong';
 se.className='chip'+(S.ks?' warn':'');

 if(first){
  first=false;
  $('spd').value=S.spd;$('spdv').textContent=S.spd;$('loop').checked=!!S.loop;
  $('kp').value=S.kp;$('kpv').textContent=S.kp;$('kb').checked=!!S.kb;$('kh').value=S.kh;
  pick(0);
 }
 const ns=JSON.stringify([S.steps,S.play?S.idx:-1,editIdx]);
 if(ns!==sig){sig=ns;drawList();}
}
function drawList(){
 if(!S.steps.length){$('list').innerHTML='<div class="empty">Belum ada langkah.<br>Pilih servo, atur sudut, lalu tekan <b>+ Tambah Langkah</b>.</div>';return;}
 $('list').innerHTML=S.steps.map((s,k)=>{
  const cls='st'+(S.play&&S.idx==k?' on':'')+(editIdx==k?' ed':'');
  return `<div class="${cls}"><div class="no">${k+1}</div>
  <div class="bd"><span class="tag" style="background:${C[s[0]]}">${N[s[0]]}</span><b>${s[1]}&deg;</b>
  <div class="sub">kecepatan ${s[2]?s[2]+' ms/&deg;':'global'} &bull; jeda ${s[3]} ms</div></div>
  <div class="ac"><button title="Tes langkah ini" onclick="tes(${k})">&#9654;</button><button title="Edit" onclick="edit(${k})">&#9998;</button><button title="Naik" onclick="geser(${k},-1)">&uarr;</button><button title="Turun" onclick="geser(${k},1)">&darr;</button><button class="x" title="Hapus" onclick="hapus(${k})">&#10005;</button></div></div>`;
 }).join('');
}

build();
api('/api');
setInterval(()=>api('/api'),700);
</script></body></html>
)rawliteral";

void setupRoutes() {
  server.enableCORS(true);
  server.on("/", []() { server.send_P(200, "text/html", HALAMAN); });
  server.on("/api", sendState);

  // geser servo langsung (preview)
  server.on("/set", []() {
    int i = server.arg("i").toInt();
    int a = server.arg("a").toInt();
    if (i >= 0 && i < 4) {
      playing = false;
      jedaAktif = jedaPerDerajat;
      target[i] = constrain(a, 0, MAX_SUDUT[i]);
    }
    sendState();
  });

  // CREATE
  server.on("/add", []() {
    if (nSteps < MAXSTEP) {
      steps[nSteps++] = bacaStep();
      simpanSemua();
    }
    sendState();
  });
  // UPDATE
  server.on("/edit", []() {
    int n = server.arg("n").toInt();
    if (n >= 0 && n < nSteps) {
      steps[n] = bacaStep();
      simpanSemua();
    }
    sendState();
  });
  // DELETE
  server.on("/del", []() {
    int n = server.arg("n").toInt();
    if (n >= 0 && n < nSteps) {
      for (int k = n; k < nSteps - 1; k++) steps[k] = steps[k + 1];
      nSteps--;
      simpanSemua();
    }
    sendState();
  });
  server.on("/clear", []() { playing = false; nSteps = 0; simpanSemua(); sendState(); });

  // urutan naik / turun
  server.on("/mv", []() {
    int n = server.arg("n").toInt();
    int d = server.arg("d").toInt() < 0 ? -1 : 1;
    int m = n + d;
    if (n >= 0 && n < nSteps && m >= 0 && m < nSteps) {
      Step t = steps[n]; steps[n] = steps[m]; steps[m] = t;
      simpanSemua();
    }
    sendState();
  });

  // tes 1 langkah
  server.on("/ke", []() {
    int n = server.arg("n").toInt();
    if (n >= 0 && n < nSteps) { playing = false; jalankanStep(n); }
    sendState();
  });

  server.on("/cfg", []() {
    jedaPerDerajat = constrain(server.arg("spd").toInt(), 5, 200);
    if (!playing) jedaAktif = jedaPerDerajat;
    simpanSemua();
    sendState();
  });
  server.on("/loopset", []() {
    loopPlay = server.arg("loop").toInt() == 1;
    sendState();
  });
  server.on("/play", []() {
    loopPlay = server.arg("loop").toInt() == 1;
    if (nSteps > 0) {
      idxPlay = 0; holding = false; playing = true;
      jalankanStep(0);
    }
    sendState();
  });
  server.on("/stop", []() {
    playing = false;
    jedaAktif = jedaPerDerajat;
    for (int i = 0; i < 4; i++) target[i] = pos[i];   // berhenti di tempat
    sendState();
  });
  server.on("/home", []() {
    playing = false;
    jedaAktif = jedaPerDerajat;
    for (int i = 0; i < 4; i++) target[i] = 0;
    sendState();
  });

  // ---- conveyor ----
  server.on("/kv", []() {
    konvOn = server.arg("on").toInt() == 1;
    sendState();
  });
  server.on("/kcfg", []() {
    kecKonv    = constrain(server.arg("p").toInt(), 30, 100);
    arahBalik  = server.arg("b").toInt() == 1;
    holdDetik  = constrain(server.arg("h").toInt(), 0, 120);
    simpanKonv();
    if (motorJalan) terapkanMotor();    // terapkan kecepatan / arah baru saat berjalan
    sendState();
  });
}

const char* statusText(wl_status_t st) {
  switch (st) {
    case WL_IDLE_STATUS:     return "IDLE";
    case WL_NO_SSID_AVAIL:   return "SSID TIDAK TERLIHAT (cek nama / band 2.4GHz / hotspot nyala)";
    case WL_CONNECTED:       return "TERHUBUNG";
    case WL_CONNECT_FAILED:  return "GAGAL (password salah / keamanan WPA3?)";
    case WL_CONNECTION_LOST: return "KONEKSI PUTUS";
    case WL_DISCONNECTED:    return "TERPUTUS / belum nyambung";
    default:                 return "LAINNYA";
  }
}

void scanWiFi() {
  Serial.println("Scan WiFi di sekitar...");
  int n = WiFi.scanNetworks();
  bool ketemu = false;
  for (int i = 0; i < n; i++) {
    Serial.printf("  %d. %s  (sinyal %d dBm, channel %d)\n",
                  i + 1, WiFi.SSID(i).c_str(), WiFi.RSSI(i), WiFi.channel(i));
    if (WiFi.SSID(i) == STA_SSID) ketemu = true;
  }
  if (n == 0) Serial.println("  (tidak ada WiFi terdeteksi)");
  Serial.println(ketemu ? ">> Hotspot TERLIHAT oleh ESP32"
                        : ">> Hotspot TIDAK terlihat. Pastikan hotspot nyala & band 2.4GHz");
  WiFi.scanDelete();
}

// Hanya mode hotspot HP: terus mencoba sampai berhasil
void sambungHotspot() {
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.setHostname(NAMA_HOST);
  WiFi.disconnect(true);
  delay(200);

  scanWiFi();

  int percobaan = 0;
  while (WiFi.status() != WL_CONNECTED) {
    percobaan++;
    Serial.printf("Percobaan %d: menyambung ke \"%s\" ...\n", percobaan, STA_SSID);
    WiFi.begin(STA_SSID, STA_PASS);
    unsigned long t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < 12000) {
      delay(500);
      Serial.print(".");
    }
    Serial.println();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.print("Status: ");
      Serial.println(statusText(WiFi.status()));
      WiFi.disconnect(true);
      delay(1000);
      if (percobaan % 3 == 0) scanWiFi();
    }
  }

  if (MDNS.begin(NAMA_HOST)) MDNS.addService("http", "tcp", 80);

  Serial.println("=====================================");
  Serial.print("Terhubung ke hotspot: "); Serial.println(STA_SSID);
  Serial.print("Buka di browser laptop: http://");
  Serial.println(WiFi.localIP());
  Serial.printf("Alamat cadangan: http://%s.local\n", NAMA_HOST);
  Serial.println("=====================================");
}

unsigned long tCek = 0;
void infoKlien() {
  if (millis() - tCek < 10000) return;
  tCek = millis();
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi putus, menyambung ulang...");
    WiFi.reconnect();
    return;
  }
  Serial.printf("IP: %s | Conveyor: %s | Sensor: %s\n",
                WiFi.localIP().toString().c_str(),
                motorJalan ? "jalan" : "berhenti",
                sensorStab ? "ADA barang" : "kosong");
}

void setup() {
  Serial.begin(115200);
  prefs.begin("arm", false);
  muatSemua();

  // pin conveyor dan sensor: pastikan motor mati sejak awal
  pinMode(PIN_IN1, OUTPUT);
  pinMode(PIN_IN2, OUTPUT);
  digitalWrite(PIN_IN1, LOW);
  digitalWrite(PIN_IN2, LOW);
  pinMode(PIN_SENSOR, INPUT);

  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);
  for (int i = 0; i < 4; i++) {
    sv[i].setPeriodHertz(50);
    sv[i].attach(PIN_SERVO[i], 500, 2400);
    sv[i].write(0);                     // semua mulai dari 0 derajat
    delay(200);
  }

  // PWM untuk ENA (1 kHz, 8 bit), dipasang SETELAH servo
  pwmEna.attachPin(PIN_ENA, 1000, 8);
  pwmEna.write(0);

  sensorRaw = bacaSensor();
  sensorStab = sensorRaw;
  konvOn = KONVEYOR_MULAI_OTOMATIS;

  sambungHotspot();                     // sambung ke hotspot HP

  setupRoutes();
  server.begin();
}

void loop() {
  server.handleClient();
  engine();
  playTick();
  sensorTick();
  konveyorTick();
  infoKlien();
}
