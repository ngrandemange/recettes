// Audit de mise en page (6 formats : iPhone vertical/horizontal, iPad vertical/horizontal, portable, petit portable).
// Vérifie : pas de défilement horizontal, cibles tactiles ≥ 44 px, recherche utilisable, barres fixes sans chevauchement,
// formulaire / tiroir de filtres / mode cuisine entièrement visibles. Nécessite Playwright (pas une dépendance du projet).
// Usage : (cd server && node server.js &) puis  node tools/ui-audit.js http://localhost:3000/
const {chromium}=require('playwright'),U=process.argv[2]||'http://localhost:3140/';
const DEV={'iphone-v':{w:393,h:852,t:1},'iphone-h':{w:852,h:393,t:1},'ipad-v':{w:820,h:1180,t:1},'ipad-h':{w:1180,h:820,t:1},'laptop':{w:1440,h:900,t:0},'laptop-petit':{w:1280,h:720,t:0}};
let fails=0;const bad=(d,pg,m)=>{fails++;console.log(`  ✗ [${d} · ${pg}] ${m}`)};
(async()=>{const b=await chromium.launch();
for(const [name,d] of Object.entries(DEV)){let issues0=fails;
 const ctx=await b.newContext({viewport:{width:d.w,height:d.h},hasTouch:!!d.t,isMobile:!!d.t});
 await ctx.addInitScript(()=>{try{localStorage.setItem('rec.theme','"light"');localStorage.setItem('rec.fridge','["pois chiche","tomate"]');localStorage.setItem('rec.timers','[]');}catch{}});
 const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
 const pages=[['liste',''],['fiche','#/r/omelette-pois-chiches'],['courses','#/courses'],['planning','#/planning'],['frigo','#/frigo'],['fiche-base','#/r/quiche-poireaux-tofu']];
 for(const [pg,h] of pages){await p.goto(U+h);await p.waitForTimeout(300);
  // 1. débordement horizontal
  const ov=await p.evaluate(()=>({sw:document.documentElement.scrollWidth,iw:innerWidth}));if(ov.sw>ov.iw+1)bad(name,pg,`défilement horizontal : contenu ${ov.sw}px pour ${ov.iw}px`);
  // 2. recherche
  const sw=await p.evaluate(()=>{const e=document.querySelector('#q');const r=e.getBoundingClientRect();return r.width});if(sw<140)bad(name,pg,`champ de recherche trop étroit (${Math.round(sw)}px)`);
  // 3. cibles tactiles
  if(d.t){const off=await p.evaluate(()=>{const out=[];document.querySelectorAll('button,a.btn,select,summary,input:not([type=hidden]):not([type=checkbox]),label.btn,.tabbar a,.topnav a').forEach(el=>{const r=el.getBoundingClientRect();if(!r.width||!r.height||getComputedStyle(el).visibility==='hidden')return;if(el.closest('[hidden]'))return;const min=el.classList.contains('chip')?40:44;const isText=el.tagName==='INPUT'&&/text|search|url|number/.test(el.type);if(el.tagName==='SUMMARY'&&!el.classList.contains('btn'))return;if(r.height<min-.5||(!isText&&r.width<min-.5))out.push(`${el.tagName.toLowerCase()}${el.id?'#'+el.id:''}${el.className&&typeof el.className==='string'?'.'+el.className.split(' ')[0]:''} ${Math.round(r.width)}×${Math.round(r.height)}`)});return [...new Set(out)].slice(0,6)});off.forEach(o=>bad(name,pg,'cible tactile trop petite : '+o));}
  // 4. le bas de page n'est pas masqué par une barre fixe
  const hid=await p.evaluate(()=>{window.scrollTo(0,document.body.scrollHeight);const bars=[...document.querySelectorAll('.tabbar,.detail-actions')].filter(e=>{const s=getComputedStyle(e);return s.display!=='none'&&s.position==='fixed'}).map(e=>e.getBoundingClientRect());if(!bars.length)return null;const top=Math.min(...bars.filter(r=>r.width>innerWidth*.5).map(r=>r.top));const last=document.querySelector('#main').lastElementChild;const lr=last.getBoundingClientRect();return lr.bottom>top+1?`dernier élément (bas ${Math.round(lr.bottom)}) sous la barre fixe (haut ${Math.round(top)})`:null});if(hid)bad(name,pg,hid);
 }
 // fenêtres et tiroir
 await p.goto(U);await p.waitForTimeout(250);await p.evaluate(()=>window.scrollTo(0,0));
 if(d.w<=1000){await p.click('#btnFilters');await p.waitForTimeout(350);const fb=await p.evaluate(()=>{const f=document.querySelector('#filters').getBoundingClientRect(),a=document.querySelector('#fApply').getBoundingClientRect();return{fr:f.right,iw:innerWidth,ab:a.bottom,ih:innerHeight}});if(fb.ab>fb.ih+1)bad(name,'tiroir',`bouton « Voir » hors écran (${Math.round(fb.ab)}/${fb.ih})`);await p.click('#fClose');await p.waitForTimeout(250);}
 await p.click('#btnNew');await p.waitForTimeout(300);const mf=await p.evaluate(()=>{const f=document.querySelector('.mfoot').getBoundingClientRect(),h=document.querySelector('.mhead').getBoundingClientRect(),m=document.querySelector('#nf').getBoundingClientRect();return{fb:f.bottom,ft:f.top,ht:h.top,mb:m.bottom,mt:m.top,ih:innerHeight}});
 if(mf.fb>mf.ih+1||mf.ht<mf.mt-1||Math.abs(mf.fb-mf.mb)>2)bad(name,'formulaire',`en-tête/pied non visibles (pied ${Math.round(mf.fb)} / boîte ${Math.round(mf.mb)} / écran ${mf.ih})`);
 await p.click('#cancel');
 // cuisine
 await p.goto(U+'#/r/hachis-lentilles');await p.waitForTimeout(250);await p.click('#cookmode');await p.waitForSelector('.cooktext');const ck=await p.evaluate(()=>{const n=document.querySelector('.cooknav').getBoundingClientRect(),t=document.querySelector('.cookbody').getBoundingClientRect();return{nb:n.bottom,ih:innerHeight,ov:document.querySelector('.cookbody').scrollHeight>document.querySelector('.cookbody').clientHeight+2,nbtn:[...document.querySelectorAll('.cooknav .btn')].map(b=>Math.round(b.getBoundingClientRect().height))}});
 if(ck.nb>ck.ih+1)bad(name,'cuisine',`navigation hors écran (${Math.round(ck.nb)}/${ck.ih})`);if(d.t&&ck.nbtn.some(h=>h<56))bad(name,'cuisine',`boutons Précédent/Suivant trop bas (${ck.nbtn})`);
 if(errs.length)bad(name,'js',errs[0]);
 console.log(`${fails===issues0?'✓':'✗'} ${name} (${d.w}×${d.h}${d.t?', tactile':''})`);await ctx.close();}
await b.close();console.log(fails?`\n${fails} PROBLÈME(S)`:'\nAUDIT OK : aucun débordement, cibles tactiles conformes, barres fixes sans chevauchement');process.exit(fails?1:0)})()
