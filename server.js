/* ELZYN: سيرفر المتجر ولوحة الإدارة. بدون أي مكتبات خارجية (Node 18 أو أحدث).
   التشغيل: node server.js
   التخزين:
   - لو UPSTASH_REDIS_REST_URL و UPSTASH_REDIS_REST_TOKEN موجودين: كل البيانات والصور بتتخزن في Upstash (مجاني ودائم).
   - غير كده: بتتخزن في مجلد data على نفس الجهاز، وعلى Vercel في /tmp (مؤقت).
   نسخة Vercel المضبوطة (الحل الجذري لخطأ 500 FUNCTION_INVOCATION_FAILED):
   - لو Upstash مش موجود أو متغيراته غلط أو واقع مؤقتًا: الموقع مش بيقع، بيشتغل بآخر نسخة محفوظة (مرآة /tmp) أو البيانات الافتراضية، والحفظ بيرجع يشتغل لوحده أول ما الاتصال يرجع.
   - أي خطأ غير متوقع بيترد عليه بـ JSON بدل ما الدالة تنهار.
   متغيرات اختيارية: PORT, ADMIN_PASSWORD, TRUST_PROXY=1, DATA_DIR */
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=+process.env.PORT||3000,ROOT=__dirname,VERCEL=!!process.env.VERCEL,DATA=process.env.DATA_DIR||(VERCEL?'/tmp/elzyn-data':path.join(ROOT,'data')),UP=path.join(DATA,'uploads'),DBF=path.join(DATA,'db.json');
const RU=(process.env.UPSTASH_REDIS_REST_URL||'').replace(/\/$/,''),RT=process.env.UPSTASH_REDIS_REST_TOKEN||'';
try{fs.mkdirSync(UP,{recursive:true})}catch(e){console.error('mkdir failed:',e.message)}
process.on('unhandledRejection',e=>console.error('unhandled:',e&&e.message));

/* ===== التخزين ===== */
let REDIS_OK=false,lastFail=0;
const rcmd=async a=>{
 const r=await fetch(RU,{method:'POST',signal:AbortSignal.timeout(8000),headers:{Authorization:'Bearer '+RT,'Content-Type':'application/json'},body:JSON.stringify(a)}),j=await r.json().catch(()=>({}));
 if(!r.ok||j.error)throw new Error(j.error||'redis '+r.status);return j.result;
};
const mirror=snap=>{try{fs.writeFileSync(DBF+'.tmp',snap);fs.renameSync(DBF+'.tmp',DBF)}catch(e){}}; /* نسخة احتياطية محلية دايمًا */
const write=async snap=>{
 if(!RU)return mirror(snap);
 if(!REDIS_OK&&Date.now()-lastFail<10000)throw Object.assign(new Error('تعذّر الحفظ، جرّب تاني'),{code:503}); /* فشل سريع وقت القطع من غير ما الطلب يعلق */
 try{await rcmd(['SET','elzyn:db',snap]);REDIS_OK=true}
 catch(e){lastFail=Date.now();REDIS_OK=false;mirror(snap);throw Object.assign(new Error('تعذّر الحفظ، جرّب تاني'),{code:503})}
 mirror(snap);
};
let DB,q=Promise.resolve();
const save=()=>{
 const p=q.then(()=>write(JSON.stringify(DB)));q=p.catch(()=>{});
 return p.catch(e=>{console.error('save failed:',e.message);throw Object.assign(new Error('تعذّر الحفظ، جرّب تاني'),{code:503})});
};
const imgs=new Map();
async function putImg(name,buf,mime){
 if(RU){await rcmd(['SET','elzyn:img:'+name,mime+'|'+buf.toString('base64')]);if(imgs.size>60)imgs.clear();imgs.set(name,{buf,mime})}
 else fs.writeFileSync(path.join(UP,name),buf);
}
async function getImg(name){
 if(imgs.has(name))return imgs.get(name);
 if(!RU){try{return{buf:fs.readFileSync(path.join(UP,name)),mime:MIME[path.extname(name)]}}catch(e){return null}}
 try{
  const v=await rcmd(['GET','elzyn:img:'+name]);if(!v)return null;
  const i=v.indexOf('|'),o={mime:v.slice(0,i),buf:Buffer.from(v.slice(i+1),'base64')};imgs.set(name,o);return o;
 }catch(e){lastFail=Date.now();REDIS_OK=false;return null}
}

/* ===== البيانات الافتراضية ===== */
const CATS=['tees','hoodies','shirts','jackets','pants'],ST=['جديد','مؤكد','تم الشحن','تم التسليم','ملغي'];
const sizes=c=>c==='pants'?['30','32','34','36']:['S','M','L','XL'];
const U=id=>`https://images.unsplash.com/photo-${id}?w=600&q=80&auto=format&fit=crop`;
const SEED=[['tees','تيشيرت أوفر سايز Basic',350,0,1,'1521572163474-6864f9cf17ab'],['tees','تيشيرت Graphic Print',420,520,0,'1576566588028-4147f3842f27'],['tees','تيشيرت Polo Essential',480,0,0,'1618354691373-d851c5c3a990'],['hoodies','هودي Oversize Heavy',890,1100,0,'1556821840-3a63f95609a7'],['hoodies','هودي Zip Black',950,0,1,'1556821840-3a63f95609a7'],['hoodies','هودي Washed Grey',820,0,0,'1556821840-3a63f95609a7'],['shirts','قميص كتان Cuban',640,0,1,'1602810318383-e386cc2a3ccf'],['shirts','قميص Oxford كلاسيك',720,850,0,'1602810318383-e386cc2a3ccf'],['jackets','جاكيت Bomber',1450,0,1,'1551028719-00167b16eac5'],['jackets','جاكيت Denim',1290,1600,0,'1551028719-00167b16eac5'],['pants','بنطلون Cargo',780,0,0,'1542272604-787c3835535d'],['pants','بنطلون Jeans Straight',690,850,0,'1542272604-787c3835535d']];
const newDB=()=>{
 const d={secret:crypto.randomBytes(32).toString('hex'),pass:'',n:0,
  settings:{ship:60,free:1500,code:'ELZYN20',pct:20,wa:'201210204011',phone:'012 1020 4011',bar:['خصم 20% بكود ELZYN20','شحن مجاني فوق 1500 ج.م','اتصل بنا: 012 1020 4011']},
  products:SEED.map(([c,n,p,o,nw,i],k)=>({id:'p'+(k+1),c,n,p,o,nw:!!nw,img:U(i),sizes:sizes(c),out:false,on:true})),orders:[]};
 Object.assign(d.products[3],{img:'/hoodie-front.webp',back:'/hoodie-back.webp',cut:true,rack:true});
 return d;
};
const adoptDB=raw=>{try{const d=JSON.parse(raw);if(d&&d.products&&d.settings&&d.orders)return d}catch(e){}return null};

/* ===== كلمة السر والجلسات ===== */
const hash=(pw,salt=crypto.randomBytes(16).toString('hex'))=>salt+':'+crypto.scryptSync(pw,salt,32).toString('hex');
const check=(pw,h)=>{const[s,x]=h.split(':'),y=hash(pw,s).split(':')[1];return x.length===y.length&&crypto.timingSafeEqual(Buffer.from(x),Buffer.from(y))};
const sign=v=>crypto.createHmac('sha256',DB.secret).update(v).digest('hex');
const mk=()=>{const e=Date.now()+7*864e5;return e+'.'+sign(String(e))};
const authed=req=>{const m=/(?:^|; )ez=(\d+)\.([a-f0-9]+)/.exec(req.headers.cookie||'');return !!m&&+m[1]>Date.now()&&m[2].length===64&&crypto.timingSafeEqual(Buffer.from(m[2]),Buffer.from(sign(m[1])))};
const ck=(req,v,age)=>`ez=${v}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${req.headers['x-forwarded-proto']==='https'?'; Secure':''}`;

/* ===== أدوات ===== */
const hits=new Map();
const limited=(k,max,ms)=>{const t=Date.now(),a=(hits.get(k)||[]).filter(x=>t-x<ms);a.push(t);hits.set(k,a);return a.length>max};
if(!VERCEL)setInterval(()=>hits.clear(),36e5).unref();
/* على Vercel الـ IP الحقيقي بتيجي في x-forwarded-for (مش من السوكيت)، فبيتفضل تلقائيًا */
const ip=req=>(process.env.TRUST_PROXY||VERCEL)?String(req.headers['x-forwarded-for']||'').split(',')[0].trim()||req.socket.remoteAddress:req.socket.remoteAddress;
const J=(res,c,o,h={})=>{res.writeHead(c,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...h});res.end(JSON.stringify(o))};
const body=(req,max=1e5)=>new Promise((ok,no)=>{let b='',n=0;req.setEncoding('utf8');req.on('data',d=>{n+=d.length;if(n>max){no(new Error('big'));req.destroy()}else b+=d});req.on('end',()=>{try{ok(b?JSON.parse(b):{})}catch(e){no(e)}})});
const t=(v,l)=>String(v==null?'':v).trim().slice(0,l),num=v=>Math.max(0,+v||0);
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Cairo'});
const pubData=()=>({settings:DB.settings,products:DB.products.filter(p=>p.on)});

/* ===== طلب جديد من الموقع (الأسعار بتتحسب هنا مش من المتصفح) ===== */
async function newOrder(req,res){
 if(limited('o'+ip(req),8,36e5))return J(res,429,{error:'طلبات كتير، جرّب بعد شوية'});
 const b=await body(req),s=DB.settings;
 const name=t(b.name,80),phone=t(b.phone,20).replace(/[\s-]/g,''),city=t(b.city,60),address=t(b.address,200);
 if(name.length<2||!/^\+?\d{10,15}$/.test(phone)||!city||!address)return J(res,400,{error:'راجع الاسم ورقم الموبايل والعنوان'});
 if(!Array.isArray(b.items)||!b.items.length||b.items.length>30)return J(res,400,{error:'السلة فاضية'});
 const items=[];
 for(const i of b.items){
  const p=DB.products.find(x=>x.id===i.id&&x.on),q=Math.floor(+i.q);
  if(!p||p.out)return J(res,400,{error:'منتج غير متاح'+(p?': '+p.n:'')});
  if(!p.sizes.includes(String(i.s))||!(q>=1&&q<=20))return J(res,400,{error:'راجع المقاس والكمية'});
  items.push({n:p.n,s:String(i.s),q,p:p.p});
 }
 const sub=items.reduce((a,i)=>a+i.p*i.q,0),disc=s.code&&String(b.code||'').toUpperCase()===s.code?Math.round(sub*s.pct/100):0,ship=sub>=s.free?0:s.ship;
 const o={n:++DB.n,date:today(),t:Date.now(),name,phone,city,address,items,sub,disc,ship,total:sub-disc+ship,st:'جديد',src:'site'};
 DB.orders.unshift(o);
 try{await save()}catch(e){DB.orders=DB.orders.filter(x=>x!==o);DB.n--;throw e} /* لو الحفظ فشل بنشيل الطلب من الذاكرة عشان ميتسجّلش مرتين */
 J(res,200,{ok:true,n:o.n,total:o.total});
}

/* ===== واجهة الإدارة (محمية بتسجيل الدخول) ===== */
async function adminApi(req,res,p,m){
 if(!authed(req))return J(res,401,{error:'سجّل دخول الأول'});
 if(m!=='GET'&&req.headers['x-requested-with']!=='ez')return J(res,403,{error:'forbidden'});
 if(p==='/api/admin/state')return J(res,200,{settings:DB.settings,products:DB.products,orders:DB.orders});
 if(p==='/api/admin/catalog'&&m==='PUT'){
  const b=await body(req,2e6),S=b.settings||{};
  DB.settings={ship:num(S.ship),free:num(S.free),code:t(S.code,20).toUpperCase(),pct:Math.min(90,num(S.pct)),wa:t(S.wa,20).replace(/\D/g,''),phone:t(S.phone,30),bar:(Array.isArray(S.bar)?S.bar:[]).slice(0,8).map(x=>t(x,120)).filter(Boolean)};
  DB.products=(Array.isArray(b.products)?b.products:[]).slice(0,500).map(x=>({id:t(x.id,40),c:CATS.includes(x.c)?x.c:'tees',n:t(x.n,120),p:num(x.p),o:num(x.o),nw:!!x.nw,img:t(x.img,300),back:t(x.back,300),cut:!!x.cut,rack:!!x.rack,sizes:(Array.isArray(x.sizes)?x.sizes:[]).map(z=>t(z,10)).filter(Boolean).slice(0,12),out:!!x.out,on:x.on!==false})).filter(x=>x.id&&x.n);
  await save();return J(res,200,{ok:true});
 }
 if(p==='/api/admin/orders'&&m==='POST'){
  const b=await body(req),items=(Array.isArray(b.items)?b.items:[]).slice(0,30).map(i=>({n:t(i.n,120),s:t(i.s,10),q:Math.max(1,Math.floor(+i.q)||1),p:num(i.p)}));
  if(!t(b.name,80)||!items.length)return J(res,400,{error:'بيانات ناقصة'});
 const o={n:++DB.n,date:today(),t:Date.now(),name:t(b.name,80),phone:t(b.phone,20),city:t(b.city,60),address:'',items,sub:num(b.sub),disc:num(b.disc),ship:num(b.ship),total:num(b.total),st:'جديد',src:'admin'};
 DB.orders.unshift(o);
 try{await save()}catch(e){DB.orders=DB.orders.filter(x=>x!==o);DB.n--;throw e}
 return J(res,200,{orders:DB.orders});
 }
 const om=/^\/api\/admin\/orders\/(\d+)$/.exec(p);
 if(om){
  const o=DB.orders.find(x=>x.n===+om[1]);if(!o)return J(res,404,{error:'الطلب مش موجود'});
  if(m==='PATCH'){const b=await body(req);if(!ST.includes(b.st))return J(res,400,{error:'حالة غير صالحة'});o.st=b.st}
  else if(m==='DELETE')DB.orders=DB.orders.filter(x=>x!==o);
  else return J(res,405,{error:'method'});
  await save();return J(res,200,{ok:true});
 }
 if(p==='/api/admin/upload'&&m==='POST'){
  const b=await body(req,8e6),x=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(b.data||'');
  if(!x)return J(res,400,{error:'صورة غير صالحة'});
  const f=crypto.randomBytes(8).toString('hex')+'.'+(x[1]==='jpeg'?'jpg':x[1]);
  try{await putImg(f,Buffer.from(x[2],'base64'),'image/'+x[1])}catch(e){return J(res,503,{error:'تعذّر رفع الصورة دلوقتي، جرّب تاني'})}
  return J(res,200,{url:'/uploads/'+f});
 }
 if(p==='/api/admin/password'&&m==='POST'){
  const b=await body(req);
  if(!check(String(b.old||''),DB.pass))return J(res,400,{error:'كلمة السر الحالية غلط'});
  if(String(b.new||'').length<8)return J(res,400,{error:'كلمة السر لازم تكون 8 حروف على الأقل'});
  DB.pass=hash(String(b.new));DB.secret=crypto.randomBytes(32).toString('hex');await save();
  return J(res,200,{ok:true},{'Set-Cookie':ck(req,mk(),604800)});
 }
 return J(res,404,{error:'not found'});
}

/* ===== الملفات الثابتة (كلها في نفس المجلد) ===== */
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon'};
const STATIC_OK=/^[\w-]+\.(html|webp|png|jpg|svg|ico)$/;
const file=(res,fp,cache)=>fs.readFile(fp,(e,d)=>{
 if(e){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Not found')}
 res.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':cache||'no-cache'});res.end(d);
});

const handler=async(req,res)=>{
 try{
  const p=decodeURIComponent(new URL(req.url,'http://x').pathname),m=req.method;
  res.setHeader('Referrer-Policy','same-origin');
  if(p==='/ping'||p==='/api/ping'){res.writeHead(200,{'Content-Type':'text/plain'});return res.end('ok')}
  if(p==='/health'||p==='/api/health')return J(res,200,{ok:true,storage:RU?(REDIS_OK?'upstash':'redis-down'):(VERCEL?'tmp':'local')});
  if(p==='/data.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});return res.end('window.ELZYN_DATA='+JSON.stringify(pubData())+';')}
  if(p==='/api/orders'&&m==='POST')return await newOrder(req,res);
  if(p==='/api/login'&&m==='POST'){
   if(limited('l'+ip(req),6,9e5))return J(res,429,{error:'محاولات كتير، استنى 15 دقيقة'});
   const b=await body(req);if(!check(String(b.password||''),DB.pass))return J(res,401,{error:'كلمة السر غلط'});
   return J(res,200,{ok:true},{'Set-Cookie':ck(req,mk(),604800)});
  }
  if(p==='/api/logout'&&m==='POST')return J(res,200,{ok:true},{'Set-Cookie':ck(req,'',0)});
  if(p.startsWith('/api/admin/'))return await adminApi(req,res,p,m);
  if(p==='/admin'){
   /* على Vercel الملفات الثابتة بتتقدم من الـ CDN: بنحوّل /admin لـ /admin.html (وموجود rewrite ليها في vercel.json) */
   if(VERCEL){res.writeHead(302,{Location:'/admin.html'});return res.end()}
   res.setHeader('X-Frame-Options','DENY');return file(res,path.join(ROOT,'admin.html'));
  }
  if(p.startsWith('/uploads/')){
   const n=path.basename(p);if(!/^[a-f0-9]{16}\.(jpg|png|webp)$/.test(n))return J(res,404,{error:'not found'});
   const o=await getImg(n);if(!o)return J(res,404,{error:'not found'});
   res.writeHead(200,{'Content-Type':o.mime,'Cache-Control':'public, max-age=604800','X-Content-Type-Options':'nosniff'});return res.end(o.buf);
  }
  const n=p==='/'?'index.html':p.slice(1);
  if(n!=='admin.html'&&STATIC_OK.test(n))return file(res,path.join(ROOT,n));
  return J(res,404,{error:'not found'});
 }catch(e){
  console.error('handler error:',e&&e.message);
  if(!res.headersSent)J(res,e.code||500,{error:e.code?e.message:'طلب غير صالح'});
  else if(!res.writableEnded)res.end();
 }
};

/* ===== التهيئة والتشغيل ===== */
async function initialize(){
 let raw=null;
 if(!RU){try{raw=fs.readFileSync(DBF,'utf8')}catch(e){}}
 else{
  try{raw=await rcmd(['GET','elzyn:db']);REDIS_OK=true}
  catch(e){ /* الحل الجذري: لو Upstash واقع أو متغيراته غلط، الموقع يفضل شغال بالمرآة المحلية أو البيانات الافتراضية بدل ما يقع كله */
   REDIS_OK=false;lastFail=Date.now();
   console.error('Upstash مش متاح دلوقتي، الموقع هيشتغل بالبيانات المحفوظة/الافتراضية:',e.message);
   try{raw=fs.readFileSync(DBF,'utf8')}catch(e2){}
  }
 }
 DB=(raw&&adoptDB(raw))||newDB();
 if(!DB.pass){
  const pw=process.env.ADMIN_PASSWORD||crypto.randomBytes(5).toString('hex');DB.pass=hash(pw);
  save().catch(()=>{}); /* لو الحفظ فشل دلوقتي هيتحفظ تلقائيًا أول ما الاتصال يرجع */
  if(!process.env.ADMIN_PASSWORD)console.log('\n  كلمة سر لوحة الإدارة: '+pw+'\n  (غيّرها من تبويب الحساب)\n');
 }
}
/* ready عمره ما بيرفض: عشان الدالة على Vercel ما ترجعش 500 FUNCTION_INVOCATION_FAILED تاني */
const ready=initialize().catch(e=>{console.error('init error:',e&&e.message)});
/* لو Upstash كان واقع: كل طلب بيحاول يعود الاتصال (مش أكتر من مرة كل 30 ثانية)؛
   أول ما يرجع بنشيل نسخة Upstash لأنها الأحدث (أي حفظ فشل وقت القطع كان بلّغ العميل برسالة خطأ واضحة) */
function redisUp(){
 if(!RU||REDIS_OK||Date.now()-lastFail<30000)return q;
 const p=q.then(async()=>{
  const raw=await rcmd(['GET','elzyn:db']);REDIS_OK=true;lastFail=0;
  const d=adoptDB(raw||'');if(d)DB=d;
 });q=p.catch(()=>{});
 return p;
}
const vercelHandler=async(req,res)=>{redisUp();await ready;return handler(req,res)};
if(!VERCEL){
 ready.then(()=>http.createServer(handler).listen(PORT,()=>console.log('  ELZYN شغال: http://localhost:'+PORT+'  |  الإدارة: /admin  |  التخزين: '+(RU?(REDIS_OK?'Upstash':'Upstash واقع - تشغيل بالبيانات المحفوظة'):'ملفات محلية'))).on('error',e=>{console.error(e);process.exit(1)}))
      .catch(e=>{console.error(e);process.exit(1)});
}
module.exports={handler:vercelHandler};
