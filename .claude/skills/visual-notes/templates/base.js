const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const hex=(n,w=8)=>'0x'+(n>>>0).toString(16).toUpperCase().padStart(w,'0');
// tabs: buttons with data-tab="id" show the .panel with that id
function initTabs(start=window.__START||0){const btns=$$('.tabs button');const show=id=>{btns.forEach(b=>{const on=b.dataset.tab===id;b.classList.toggle('on',on);b.setAttribute('aria-selected',on)});$$('.panel').forEach(p=>p.hidden=p.id!==id)};btns.forEach(b=>b.addEventListener('click',()=>show(b.dataset.tab)));if(btns[start])show(btns[start].dataset.tab);return show}
// player: generic step controller. steps = count; render(i) draws step i; returns controls
function player({count,render,prev,next,play,reset,delay=1800}){let i=0,timer=null;const set=n=>{i=Math.max(0,Math.min(count-1,n));render(i);if(prev)prev.disabled=i===0;if(next)next.disabled=i===count-1;};const stop=()=>{clearInterval(timer);timer=null;if(play)play.textContent='▶ Play'};const go=()=>{if(i>=count-1){stop();return}set(i+1)};
if(next)next.onclick=()=>{stop();set(i+1)};if(prev)prev.onclick=()=>{stop();set(i-1)};if(reset)reset.onclick=()=>{stop();set(0)};
if(play)play.onclick=()=>{if(timer){stop();return}if(i>=count-1)set(0);play.textContent='❚❚ Pause';timer=setInterval(go,delay)};
addEventListener('keydown',e=>{if(e.target.closest('input,select,textarea'))return;if(e.key==='ArrowRight'){stop();set(i+1)}if(e.key==='ArrowLeft'){stop();set(i-1)}});
set(0);return{set,stop,get i(){return i}}}
