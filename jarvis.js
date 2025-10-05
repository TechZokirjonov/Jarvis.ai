/* JARVIS — Futuristic assistant
   - SpeechRecognition (microphone)
   - speechSynthesis (voice)
   - offline fallback answers (Uzbek)
   - optional OpenAI (if API key entered)
   - open Google/YouTube/Telegram, wttr.in weather
   - prevents echo by stopping mic while speaking
*/

(() => {
  // UI
  const btnTalk = document.getElementById('btnTalk');
  const btnStop = document.getElementById('btnStop');
  const btnTest = document.getElementById('btnTest');
  const viz = document.getElementById('viz');
  const transcript = document.getElementById('transcript');
  const status = document.getElementById('status');
  const apiKeyInput = document.getElementById('apiKey');
  const manualInput = document.getElementById('manualInput');
  const sendBtn = document.getElementById('sendBtn');
  const avatarWrap = document.getElementById('avatarWrap');
  const face = document.getElementById('face');
  const mouth = document.getElementById('mouth');
  const pupilL = document.getElementById('pupilL');
  const pupilR = document.getElementById('pupilR');
  const weatherBtn = document.getElementById('weatherBtn');
  const quickActions = document.querySelectorAll('.quick-actions button');

  // speech
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = window.speechSynthesis;
  const recognition = SpeechRecognition ? new SpeechRecognition() : null;
  if(recognition) {
    recognition.lang = 'uz-UZ';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;
  }

  // visual bars
  const BAR_COUNT = 16;
  for(let i=0;i<BAR_COUNT;i++){ const b=document.createElement('div'); b.className='bar'; b.style.height='6px'; viz.appendChild(b) }
  const bars = Array.from(document.querySelectorAll('.bar'));

  let listening = false;
  let isSpeaking = false;
  let audioContext=null, analyser=null, micStream=null, rafId=null;

  // offline knowledge base (Uzbek)
  const FALLBACK = [
    {p:/\b(salom|assalomu|hello)\b/i, a: "Va alaykum assalom! Men JARVISman. Sizga qanday yordam berishim mumkin?"},
    {p:/\bhtml nima\b/i, a: "HTML — veb-sahifalarning tuzilishini belgilovchi til. U orqali sarlavha, paragraflar va rasm kabi elementlar yaratiladi."},
    {p:/\bcss nima\b/i, a: "CSS — veb-sahifaning ko’rinishi uchun ishlatiladi: ranglar, joylashuv va dizayn elementlari."},
    {p:/\bjavascript nima\b/i, a: "JavaScript — veb-sahifalarga interaktivlik qo’shuvchi dasturlash tili."},
    {p:/\bpython nima\b/i, a: "Python — o’rganish uchun qulay va keng qo’llaniladigan dasturlash tili."},
    {p:/\bsoat|vaqt\b/i, a: ()=>{ const d=new Date(); return `Hozir soat ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}` }},
    {p:/\brahmat|tashakkur\b/i, a: "Marhamat! Yana savolingiz bo‘lsa so‘rang."},
    {p:/\bkim yaratgan\b/i, a: "Men — Muhammadzohid tomonidan yaratilgan JARVIS misolim."},
    // add more patterns as you like
  ];

  function findFallback(text){
    for(const it of FALLBACK){
      const m = text.match(it.p);
      if(m) return typeof it.a === 'function' ? it.a(m) : it.a;
    }
    return null;
  }

  function logUser(txt){
    const el = document.createElement('div'); el.className='log-item';
    el.innerHTML = `<div class="log-user"><strong>Siz:</strong> ${escapeHtml(txt)}</div>`;
    transcript.prepend(el);
  }
  function logJarvis(txt){
    const el = document.createElement('div'); el.className='log-item';
    el.innerHTML = `<div class="log-jarvis"><strong>JARVIS:</strong> ${escapeHtml(txt)}</div>`;
    transcript.prepend(el);
  }
  function escapeHtml(s){ return s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;') }

  // speak: stop mic to avoid echo
  function speak(text){
    if(!text) return;
    // stop mic & viz
    stopViz();
    try{ recognition?.abort(); }catch(e){}
    isSpeaking = true;
    face.classList.add('speaking');
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'uz-UZ';
    // pick preferred voice if exists
    const voices = synth.getVoices();
    if(voices && voices.length){
      // prefer uz or ru or en
      for(const v of voices){
        if(v.lang.toLowerCase().startsWith('uz') || v.lang.toLowerCase().startsWith('ru') || v.lang.toLowerCase().startsWith('en')){
          u.voice = v; break;
        }
      }
    }
    u.onend = () => {
      isSpeaking = false;
      face.classList.remove('speaking');
      // resume listening if needed
      if(listening) setTimeout(()=> startRecognition(), 350);
      startViz(); // restart audio viz
    };
    synth.cancel();
    synth.speak(u);
    logJarvis(text);
  }

  // open helpers
  function openGoogle(q){ window.open('https://www.google.com/search?q='+encodeURIComponent(q),'_blank') }
  function openYoutube(q){ window.open('https://www.youtube.com/results?search_query='+encodeURIComponent(q),'_blank') }
  function openTelegram(username){ window.open('https://t.me/'+encodeURIComponent(username.replace(/\s/g,'')),'_blank') }

  // weather via wttr.in (no API key)
  async function getWeather(city){
    try{
      const q = city ? city : 'Tashkent';
      const res = await fetch(`https://wttr.in/${encodeURIComponent(q)}?format=3`);
      if(!res.ok) return null;
      const txt = await res.text();
      return txt;
    }catch(e){
      return null;
    }
  }

  // OpenAI optional (client-side) — use only if you understand CORS & exposing key risks
  async function askOpenAI(prompt){
    const key = apiKeyInput.value.trim();
    if(!key) return null;
    try{
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'Authorization': 'Bearer '+key },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages:[
            {role:'system', content:'Siz JARVIS yordamchisiz. Javoblarni qisqa va tushunarli qilib bering (uzbekcha).'},
            {role:'user', content: prompt}
          ],
          max_tokens: 600
        })
      });
      if(!res.ok) {
        console.error('OpenAI error', res.status);
        return null;
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content?.trim() ?? null;
    }catch(e){ console.error(e); return null; }
  }

  // main handler
  async function handleText(text){
    if(!text) return;
    logUser(text);

    // commands parsing (open google/youtube/telegram/weather)
    const t = text.toLowerCase();

    // open google: "google python" or "qidir python"
    if(/\bgoogle\b/.test(t) || /\bqidir\b/.test(t)){
      const q = t.replace(/\bgoogle\b/,'').replace(/\bqidir\b/,'').trim() || text;
      openGoogle(q);
      speak(`Google da ${q} uchun qidiruv ochildi.`);
      return;
    }
    if(/\byoutube\b/.test(t)){
      const q = t.replace(/\byoutube\b/,'').trim() || text;
      openYoutube(q);
      speak(`YouTube da ${q} qidirildi.`);
      return;
    }
    if(/\btelegram\b/.test(t)){
      // "telegram username" yoki "telegram och channelname"
      const parts = text.split(/\s+/);
      const idx = parts.findIndex(p => /telegram/i.test(p));
      const username = parts.slice(idx+1).join(' ') || 'dev';
      openTelegram(username);
      speak(`Telegram ${username} ochildi.`);
      return;
    }
    if(/\bob-?havo\b/.test(t) || /\bweather\b/.test(t)){
      // try extract city
      const m = t.match(/\bob-?havo\s*(?:for|:)?\s*(.*)/i) || t.match(/\bweather\s*(.*)/i);
      const city = m && m[1] ? m[1].trim() : '';
      const info = await getWeather(city);
      if(info){ speak(info); } else speak('Kechirasiz, ob-havo topilmadi.');
      return;
    }

    // fallback offline answers
    const fb = findFallback(text);
    if(fb){
      speak(fb);
      return;
    }

    // if OpenAI key provided, ask it
    if(apiKeyInput.value.trim()){
      status.textContent = 'Mic: ON • AI: OpenAI';
      const reply = await askOpenAI(text);
      if(reply){ speak(reply); return; }
      // else continue to fallback
    }

    // final polite fallback
    speak("Kechirasiz, men buni toʻliq tushunmadim. Iltimos boshqa shaklda soʻrab koʻring yoki OpenAI API qoʻshing.");
  }

  // recognition handling
  function startRecognition(){
    if(!recognition) { speak("Sizning brauzeringiz speech recognition ni qoʻllab quvvatlamaydi."); return; }
    if(isSpeaking) return;
    try{
      recognition.start();
      status.textContent = 'Mic: LISTENING';
    }catch(e){}
  }
  function stopRecognition(){
    if(!recognition) return;
    try{ recognition.stop(); }catch(e){}
    status.textContent = 'Mic: OFF';
  }

  if(recognition){
    recognition.onresult = (e) => {
      const text = e.results[e.results.length-1][0].transcript.trim();
      // if speaking, ignore (safety)
      if(isSpeaking) return;
      // stop recognition (prevent double)
      try{ recognition.abort(); }catch(e){}
      handleText(text);
    };
    recognition.onerror = (e) => { console.warn('recog err', e); status.textContent = 'Mic: ERROR'; };
    recognition.onend = () => { if(listening && !isSpeaking) status.textContent = 'Mic: IDLE'; };
  }

  // Manual input
  if(sendBtn){
    sendBtn.addEventListener('click', ()=>{ const v = manualInput.value.trim(); manualInput.value=''; handleText(v); });
  }
  manualInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ sendBtn.click(); } });

  // quick action buttons
  quickActions.forEach(btn => {
    btn.addEventListener('click', ()=> {
      const act = btn.getAttribute('data-act');
      const q = prompt('Nimani qidiray? (masalan: Python tutorial)') || '';
      if(act==='google') { openGoogle(q); speak(`Googleda ${q} qidirildi.`); }
      if(act==='youtube') { openYoutube(q); speak(`YouTubeda ${q} qidirildi.`); }
      if(act==='telegram') { openTelegram(q || 'dev'); speak(`Telegram ${q} ochildi.`); }
    });
  });

  // weather button
  weatherBtn.addEventListener('click', async ()=>{
    const city = prompt('Qaysi shahar ob-havosi kerak? (masalan: Tashkent)') || '';
    const info = await getWeather(city);
    if(info) speak(info); else speak('Ob-havo topilmadi.');
  });

  // UI buttons
  btnTalk.addEventListener('click', ()=>{
    listening = !listening;
    if(listening){
      btnTalk.textContent = '🎤 Endi gapiring...';
      startViz();
      startRecognition();
    } else {
      btnTalk.textContent = '🎤 Gapir (Ctrl+M)';
      stopRecognition();
      stopViz();
    }
  });
  btnStop.addEventListener('click', ()=>{
    listening = false; btnTalk.textContent = '🎤 Gapir (Ctrl+M)'; stopRecognition(); stopViz();
  });
  btnTest.addEventListener('click', ()=> speak('Salom, men JARVISman. Test muvaffaqiyatli.'));

  // Ctrl+M toggle
  window.addEventListener('keydown', (e)=>{ if(e.ctrlKey && e.key.toLowerCase()==='m'){ btnTalk.click(); } });

  // Audio visualizer
  async function startViz(){
    if(audioContext) return;
    try{
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      micStream = await navigator.mediaDevices.getUserMedia({ audio:true, video:false });
      const src = audioContext.createMediaStreamSource(micStream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 128;
      src.connect(analyser);
      drawViz();
    }catch(e){
      console.warn('Mic denied or error', e);
    }
  }
  function drawViz(){
    const data = new Uint8Array(analyser.frequencyBinCount);
    function frame(){
      analyser.getByteFrequencyData(data);
      for(let i=0;i<bars.length;i++){
        const v = data[i] || 0;
        const h = Math.max(6, Math.min(64, (v/255)*64));
        bars[i].style.height = h + 'px';
      }
      // subtle pupil move
      const dx = (Math.random()-0.5)*2;
      pupilL.style.transform = `translate(${dx}px, ${Math.random()*2}px)`;
      pupilR.style.transform = `translate(${dx}px, ${Math.random()*2}px)`;
      rafId = requestAnimationFrame(frame);
    }
    frame();
  }
  function stopViz(){
    if(rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if(micStream){
      micStream.getTracks().forEach(t=>t.stop());
      micStream = null;
    }
    if(audioContext){ try{ audioContext.close(); }catch(e){} audioContext = null; analyser = null; }
    bars.forEach(b => b.style.height = '6px');
    pupilL.style.transform = 'translateY(0)'; pupilR.style.transform = 'translateY(0)';
  }

  // helper to expose for debug
  window.JARVIS = { handleText, speak };

  // friendly intro
  setTimeout(()=> speak('Salom! Men JARVISman. Gapiring yoki yozing. Agar OpenAI kalitini kiritsangiz, men murakkab savollarga ham javob beraman.'), 700);

})();
