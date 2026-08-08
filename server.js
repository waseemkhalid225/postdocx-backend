// PostDocX server.js with Google OAuth Drive support
require('dotenv').config();
const express=require('express'),path=require('path'),cron=require('node-cron'),crypto=require('crypto'),multer=require('multer');
const {google}=require('googleapis');
const db=require('./lib/sheets'),gdrive=require('./lib/drive');
const {hashPassword,verifyPassword,signToken,verifyToken,encrypt}=require('./lib/crypt');
const {testEmailCreds}=require('./lib/mailer');
const mammoth=require('mammoth');
const {claude,parseJSON}=require('./lib/anthropic');
const {runCycle,cfg,draftProposal,interviewBrief,coupleDossier,weeklyReview,draftRefereeRequests,tailoredCV}=require('./lib/agent');

const app=express();
app.use(express.json({limit:'1mb'}));
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:15*1024*1024}});

const GOOGLE_OAUTH_CLIENT_ID=process.env.GOOGLE_OAUTH_CLIENT_ID||'';
const GOOGLE_OAUTH_CLIENT_SECRET=process.env.GOOGLE_OAUTH_CLIENT_SECRET||'';
const GOOGLE_OAUTH_REDIRECT_URI=process.env.GOOGLE_OAUTH_REDIRECT_URI||'https://postdocx-backend-production.up.railway.app/auth/google/callback';

function googleOAuthClient(){
  if(!GOOGLE_OAUTH_CLIENT_ID||!GOOGLE_OAUTH_CLIENT_SECRET) throw new Error('Google OAuth client ID/secret are missing in Railway Variables.');
  return new google.auth.OAuth2(GOOGLE_OAUTH_CLIENT_ID,GOOGLE_OAUTH_CLIENT_SECRET,GOOGLE_OAUTH_REDIRECT_URI);
}

app.get('/auth/google',(req,res)=>{
  try{
    const oauth=googleOAuthClient();
    res.redirect(oauth.generateAuthUrl({
      access_type:'offline',
      prompt:'consent',
      scope:['https://www.googleapis.com/auth/drive']
    }));
  }catch(e){
    res.status(500).send('Google Drive connection setup error: '+e.message);
  }
});

app.get('/auth/google/callback',async(req,res)=>{
  try{
    if(!req.query.code)return res.status(400).send('Google authorization code is missing.');
    const {tokens}=await googleOAuthClient().getToken(req.query.code);

    if(!tokens.refresh_token){
      return res.status(400).send('Google did not return a refresh token. Open /auth/google again and authorize with consent.');
    }

    const token=String(tokens.refresh_token)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;');

    res.send(`
      <!doctype html>
      <html>
      <body style="font-family:Arial;max-width:900px;margin:40px auto;padding:20px">
      <h2>Google Drive connected successfully</h2>
      <p>Add this value to Railway as <b>GOOGLE_OAUTH_REFRESH_TOKEN</b>.</p>
      <p style="color:#b00020"><b>Do not share this token.</b></p>
      <textarea readonly style="width:100%;height:150px">${token}</textarea>
      <p>Then redeploy Railway and test one document upload.</p>
      </body>
      </html>
    `);
  }catch(e){
    console.error('Google OAuth callback error:',e);
    res.status(500).send('Google Drive authorization failed: '+e.message);
  }
});

app.get('/auth/google/status',(_req,res)=>{
  res.json({
    oauthConfigured:!!(GOOGLE_OAUTH_CLIENT_ID&&GOOGLE_OAUTH_CLIENT_SECRET),
    refreshTokenConfigured:!!process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
    redirectUri:GOOGLE_OAUTH_REDIRECT_URI
  });
});

const hits=new Map();

app.use((req,res,next)=>{
  res.set('X-Content-Type-Options','nosniff');
  res.set('X-Frame-Options','DENY');
  res.set('Referrer-Policy','no-referrer');

  const ip=req.headers['x-forwarded-for']||req.ip||'?';
  const now=Date.now();
  const arr=(hits.get(ip)||[]).filter(t=>now-t<60000);

  arr.push(now);
  hits.set(ip,arr);

  if(arr.length>120)return res.status(429).json({error:'Too many requests'});
  next();
});

const KEY=process.env.APPROVE_KEY||'change-me';

function safeEqual(a,b){
  const A=Buffer.from(String(a||''));
  const B=Buffer.from(String(b||''));
  return A.length===B.length&&crypto.timingSafeEqual(A,B);
}

const keyGuard=(req,res)=>{
  if(!safeEqual(req.query.key||req.headers['x-key'],KEY)){
    res.status(403).send('Forbidden');
    return false;
  }
  return true;
};

function auth(req,res,next){
  const t=(req.headers.authorization||'').replace('Bearer ','');
  const p=verifyToken(t);

  if(!p)return res.status(401).json({error:'Please sign in again'});

  req.userId=p.id;
  req.userRole=p.role;
  next();
}

function adminOnly(req,res,next){
  if(req.userRole!=='admin')return res.status(403).json({error:'Admin only'});
  next();
}

async function getUser(id){
  return(await db.all('Users')).find(u=>u.id===id);
}

function publicUser(u){
  const{passHash,encPass,_row,...rest}=u;
  rest.emailConnected=u.emailConnected==='yes'||u.emailConnected==='imap';
  rest.emailMode=u.emailConnected||'no';
  return rest;
}

const uid=()=>Math.random().toString(36).slice(2,10);
const today=()=>new Date().toISOString().slice(0,10);

app.post('/api/register',async(req,res)=>{
  try{
    const{name,email,password,title,field,methods,pubs,prefs,links,orcid,nationality,phone}=req.body||{};

    if(!name||!email||!password)
      return res.status(400).json({error:'Name, email and password are required'});

    if(String(password).length<8)
      return res.status(400).json({error:'Password must be at least 8 characters'});

    const users=await db.all('Users');

    if(users.some(u=>u.email.toLowerCase()===String(email).toLowerCase()))
      return res.status(400).json({error:'An account with this email already exists'});

    const role=users.length===0?'admin':'member';

    const u={
      id:uid(),
      name,
      email,
      passHash:hashPassword(password),
      role,
      title:title||'',
      field:field||'',
      methods:methods||'',
      pubs:pubs||'',
      prefs:prefs||'',
      links:links||'',
      orcid:orcid||'',
      nationality:nationality||'Pakistani',
      phone:phone||'',
      smtpEmail:'',
      encPass:'',
      emailConnected:'no',
      partnerId:'',
      active:'yes',
      createdOn:today()
    };

    await db.add('Users',u);
    await db.log('REGISTER',name+' <'+email+'> as '+role);

    res.json({
      token:signToken({id:u.id,role}),
      user:publicUser(u)
    });
  }catch(e){
    res.status(500).json({error:e.message});
  }
});

app.post('/api/login',async(req,res)=>{
  try{
    const{email,password}=req.body||{};

    const u=(await db.all('Users'))
      .find(x=>x.email.toLowerCase()===String(email||'').toLowerCase());

    if(!u||!verifyPassword(password,u.passHash))
      return res.status(401).json({error:'Wrong email or password'});

    if(u.active==='no')
      return res.status(403).json({error:'Account disabled'});

    res.json({
      token:signToken({id:u.id,role:u.role}),
      user:publicUser(u)
    });
  }catch(e){
    res.status(500).json({error:e.message});
  }
});

app.get('/api/me',auth,async(req,res)=>{
  const u=await getUser(req.userId);

  if(!u)return res.status(401).json({error:'Account not found'});

  res.json({user:publicUser(u)});
});

app.put('/api/profile',auth,async(req,res)=>{
  try{
    const u=await getUser(req.userId);
    const allowed=['name','title','field','methods','pubs','prefs','links','orcid','nationality','phone'];

    for(const k of allowed){
      if(req.body[k]!==undefined)
        u._row.set(k,String(req.body[k]).slice(0,2000));
    }

    await u._row.save();

    res.json({
      user:publicUser(await getUser(req.userId))
    });
  }catch(e){
    res.status(500).json({error:e.message});
  }
});

app.post('/api/email-connect',auth,async(req,res)=>{
  try{
    const{gmail,appPassword}=req.body||{};

    if(!gmail||!appPassword)
      return res.status(400).json({error:'Gmail address and app password are required'});

    const pass=String(appPassword).replace(/\s+/g,'');

    if(pass.length!==16)
      return res.status(400).json({
        error:'A Gmail app password is exactly 16 characters.'
      });

    const t=await testEmailCreds({user:gmail,pass});

    if(!t.smtp&&!t.imap){
      const authFail=/auth|credential|password|535|Invalid/i.test(
        t.smtpError+t.imapError
      );

      return res.status(400).json({
        error:authFail
          ?'Gmail rejected the sign-in. Check the 16-character app password, Gmail address and 2-Step Verification.'
          :'This server could not reach Gmail. '+(t.smtpError||t.imapError)
      });
    }

    const mode=t.smtp?'yes':'imap';
    const u=await getUser(req.userId);

    u._row.set('smtpEmail',gmail);
    u._row.set('encPass',encrypt(pass));
    u._row.set('emailConnected',mode);

    await u._row.save();

    await db.log('EMAIL_CONNECTED',u.name+' -> '+gmail+' ('+mode+')');

    res.json({
      ok:true,
      mode,
      message:t.smtp?'Connected fully.':'Connected for reading.'
    });
  }catch(e){
    res.status(500).json({error:e.message});
  }
});

app.post('/api/email-disconnect',auth,async(req,res)=>{
  const u=await getUser(req.userId);

  u._row.set('smtpEmail','');
  u._row.set('encPass','');
  u._row.set('emailConnected','no');

  await u._row.save();

  res.json({ok:true});
});

app.post('/api/documents',auth,upload.single('file'),async(req,res)=>{
  try{
    const{type,name,attach}=req.body||{};

    if(!req.file)
      return res.status(400).json({error:'No file received'});

    if(!type)
      return res.status(400).json({error:'Document type is required'});

    const ok=[
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword'
    ];

    if(!ok.includes(req.file.mimetype))
      return res.status(400).json({
        error:'Only PDF, Word or image files are accepted'
      });

    const u=await getUser(req.userId);
    const stamp=today().replace(/-/g,'');

    const fname=
      `${u.name.replace(/\s+/g,'_')}_${type.replace(/[^A-Za-z]/g,'')}_${stamp}_${req.file.originalname}`
      .slice(0,120);

    const f=await gdrive.uploadBuffer(
      fname,
      req.file.mimetype,
      req.file.buffer
    );

    await db.add('Documents',{
      id:uid(),
      resId:req.userId,
      type,
      name:name||req.file.originalname,
      url:'',
      attach:attach==='yes'?'yes':'no',
      version:'',
      updatedOn:today(),
      note:'',
      driveId:f.id,
      mime:req.file.mimetype,
      size:String(f.size||req.file.size)
    });

    res.json({
      ok:true,
      fileId:f.id
    });
  }catch(e){
    console.error('Upload failed:',e);

    res.status(500).json({
      error:'Upload failed: '+e.message
    });
  }
});

app.get('/api/documents',auth,async(req,res)=>{
  res.json({
    documents:(await db.all('Documents'))
      .filter(d=>d.resId===req.userId)
      .map(({_row,...d})=>d)
  });
});

app.get('/api/documents/:id/download',auth,async(req,res)=>{
  try{
    const d=(await db.all('Documents'))
      .find(x=>x.id===req.params.id);

    if(!d||d.resId!==req.userId)
      return res.status(404).send('Not found');

    if(!d.driveId)
      return res.status(404).send('No file stored');

    const buf=await gdrive.getBuffer(d.driveId);

    res.set('Content-Type',d.mime||'application/octet-stream');

    res.set(
      'Content-Disposition',
      'inline; filename="'+(d.name||'document').replace(/"/g,'')+'"'
    );

    res.send(buf);
  }catch(e){
    res.status(500).send('Download failed: '+e.message);
  }
});

app.delete('/api/documents/:id',auth,async(req,res)=>{
  const d=(await db.all('Documents'))
    .find(x=>x.id===req.params.id&&x.resId===req.userId);

  if(!d)
    return res.status(404).json({error:'Not found'});

  if(d.driveId)
    await gdrive.remove(d.driveId);

  await d._row.delete();

  res.json({ok:true});
});

async function extractProfile(userId){
  const docs=(await db.all('Documents'))
    .filter(d=>d.resId===userId&&d.driveId);

  if(!docs.length)
    throw new Error('Upload your CV first, then the profile can fill itself.');

  const order=t=>
    /cv/i.test(t)?0:
    /statement/i.test(t)?1:
    /publication/i.test(t)?2:3;

  const picked=docs
    .sort((a,b)=>order(a.type)-order(b.type))
    .slice(0,3);

  const blocks=[];
  let budget=9*1024*1024;

  for(const d of picked){
    try{
      const buf=await gdrive.getBuffer(d.driveId);

      if(buf.length>budget)continue;

      budget-=buf.length;

      if(d.mime==='application/pdf'){
        blocks.push({
          type:'document',
          source:{
            type:'base64',
            media_type:'application/pdf',
            data:buf.toString('base64')
          }
        });
      }else if(/wordprocessingml|msword/.test(d.mime)){
        const r=await mammoth.extractRawText({buffer:buf});

        if(r.value){
          blocks.push({
            type:'text',
            text:'Content of '+d.type+' ('+d.name+'):\n'+r.value.slice(0,30000)
          });
        }
      }else if(/^image\//.test(d.mime)){
        blocks.push({
          type:'image',
          source:{
            type:'base64',
            media_type:d.mime,
            data:buf.toString('base64')
          }
        });
      }
    }catch(e){
      console.error('Profile document read failed:',e.message);
    }
  }

  if(!blocks.length)
    throw new Error('Could not read the uploaded files.');

  blocks.push({
    type:'text',
    text:
      'Extract this researcher academic profile from the document(s) above. '+
      'Use ONLY what is actually written there, never invent or embellish. '+
      'Respond ONLY with JSON: '+
      '{"title":"credentials and current role in one line","field":"research field and identity, 2-3 sentences","methods":"all methods and technical skills found, comma separated","pubs":"key publications: title, journal, year, role; one per line","orcid":"ORCID id if present else empty","links":"Scholar/ResearchGate/LinkedIn URLs found, else empty","phone":"phone if present else empty","nationality":"if stated else empty","prefs":""}'
  });

  return parseJSON(
    await claude(blocks,{
      search:false,
      maxTokens:1800
    })
  );
}

app.post('/api/profile/autofill',auth,async(req,res)=>{
  try{
    const v=await extractProfile(req.userId);
    const u=await getUser(req.userId);

    const fields=[
      'title',
      'field',
      'methods',
      'pubs',
      'orcid',
      'links',
      'phone',
      'nationality'
    ];

    const force=!!(req.body||{}).force;
    const filled=[];

    for(const k of fields){
      const val=String(v[k]||'').trim();

      if(val&&(force||!String(u[k]||'').trim())){
        u._row.set(k,val.slice(0,2000));
        filled.push(k);
      }
    }

    if(filled.length)
      await u._row.save();

    await db.log(
      'AUTOFILL',
      u.name+': '+(filled.join(', ')||'nothing new')
    );

    res.json({
      ok:true,
      filled,
      user:publicUser(await getUser(req.userId))
    });
  }catch(e){
    res.status(400).json({error:e.message});
  }
});

app.get('/api/referees',auth,async(req,res)=>{
  res.json({
    referees:(await db.all('Referees'))
      .filter(r=>r.resId===req.userId)
      .map(({_row,...r})=>r)
  });
});

app.post('/api/referees',auth,async(req,res)=>{
  const{name,email,relationship}=req.body||{};

  if(!name||!email)
    return res.status(400).json({error:'Name and email required'});

  await db.add('Referees',{
    id:uid(),
    resId:req.userId,
    name,
    email,
    relationship:relationship||'',
    status:'pending',
    note:''
  });

  res.json({ok:true});
});

app.post('/api/referees/request-all',auth,async(req,res)=>{
  try{
    res.json({
      ok:true,
      drafted:await draftRefereeRequests(req.userId)
    });
  }catch(e){
    res.status(500).json({error:e.message});
  }
});

app.delete('/api/referees/:id',auth,async(req,res)=>{
  const r=(await db.all('Referees'))
    .find(x=>x.id===req.params.id&&x.resId===req.userId);

  if(!r)
    return res.status(404).json({error:'Not found'});

  await r._row.delete();

  res.json({ok:true});
});

app.get('/api/bundle',auth,async(req,res)=>{
  try{
    const me=await getUser(req.userId);
    const strip=a=>a.map(({_row,...o})=>o);

    const[
      opps,
      outbox,
      proposals,
      users,
      cases,
      threads
    ]=await Promise.all([
      db.all('Opportunities'),
      db.all('Outbox'),
      db.all('Proposals'),
      db.all('Users'),
      db.all('Cases'),
      db.all('Threads')
    ]);

    const mineOpp=opps.filter(o=>o.resId===req.userId);

    const keys=new Set(
      mineOpp
        .filter(o=>o.coupleKey)
        .map(o=>o.coupleKey)
    );

    const partnerOpp=opps.filter(
      o=>o.coupleKey&&
      keys.has(o.coupleKey)&&
      o.resId!==req.userId
    );

    res.json({
      me:publicUser(me),

      partner:me.partnerId
        ?(u=>u?{id:u.id,name:u.name}:null)(
          users.find(x=>x.id===me.partnerId)
        )
        :null,

      opportunities:strip(mineOpp),
      coupleOpportunities:strip(partnerOpp),

      outbox:strip(
        outbox.filter(m=>m.resId===req.userId)
      ),

      proposals:strip(
        proposals.filter(p=>p.resId===req.userId)
      ).map(p=>({
        id:p.id,
        title:p.title,
        status:p.status,
        createdOn:p.createdOn
      })),

      cases:strip(
        cases.filter(c=>c.resId===req.userId)
      ),

      threads:strip(
        threads.filter(t=>t.resId===req.userId)
      ).map(t=>({
        id:t.id,
        oppId:t.oppId,
        outboxId:t.outboxId,
        fromEmail:t.fromEmail,
        subject:t.subject,
        body:t.body,
        intent:t.intent,
        receivedOn:t.receivedOn
      }))
    });
  }catch(e){
    res.status(500).json({error:e.message});
  }
});

app.get('/api/proposals/:id',auth,async(req,res)=>{
  const p=(await db.all('Proposals'))
    .find(x=>x.id===req.params.id&&x.resId===req.userId);

  if(!p)
    return res.status(404).json({error:'Not found'});

  res.json({
    title:p.title,
    content:p.content,
    createdOn:p.createdOn
  });
});

app.post('/api/outbox/:id/:action',auth,async(req,res)=>{
  const{id,action}=req.params;

  if(!['approve','reject'].includes(action))
    return res.status(400).json({error:'Bad action'});

  const m=(await db.all('Outbox'))
    .find(x=>x.id===id&&x.resId===req.userId);

  if(!m)
    return res.status(404).json({error:'Not found'});

  if(m.status!=='PENDING')
    return res.status(400).json({
      error:'Already '+m.status.toLowerCase()
    });

  m._row.set(
    'status',
    action==='approve'?'APPROVED':'REJECTED'
  );

  await m._row.save();

  await db.log(
    action.toUpperCase()+'D',
    m.subject
  );

  res.json({
    ok:true,
    status:action==='approve'?'APPROVED':'REJECTED'
  });
});

app.post('/api/generate/:kind/:oppId',auth,async(req,res)=>{
  const{kind,oppId}=req.params;

  const opp=(await db.all('Opportunities'))
    .find(o=>o.id===oppId);

  if(!opp||opp.resId!==req.userId)
    return res.status(404).json({
      error:'Opportunity not found'
    });

  const fns={
    proposal:draftProposal,
    interview:interviewBrief,
    dossier:coupleDossier,
    cv:tailoredCV
  };

  if(!fns[kind])
    return res.status(400).json({
      error:'Unknown generator'
    });

  res.json({
    ok:true,
    message:'Writing now. It will appear under Proposals and in your email in 1 to 3 minutes.'
  });

  fns[kind](oppId)
    .catch(e=>console.error(kind,e.message));
});

app.get('/api/admin/users',auth,adminOnly,async(req,res)=>{
  res.json({
    users:(await db.all('Users')).map(publicUser)
  });
});

app.post('/api/admin/link-couple',auth,adminOnly,async(req,res)=>{
  try{
    const{a,b}=req.body||{};
    const users=await db.all('Users');

    const A=users.find(u=>u.id===a);
    const B=users.find(u=>u.id===b);

    if(!A||!B||A.id===B.id)
      return res.status(400).json({
        error:'Pick two different users'
      });

    A._row.set('partnerId',B.id);
    await A._row.save();

    B._row.set('partnerId',A.id);
    await B._row.save();

    await db.log(
      'COUPLE_LINKED',
      A.name+' <-> '+B.name
    );

    res.json({ok:true});
  }catch(e){
    res.status(500).json({error:e.message});
  }
});

app.post('/api/admin/unlink-couple',auth,adminOnly,async(req,res)=>{
  const users=await db.all('Users');

  const A=users.find(
    u=>u.id===(req.body||{}).a
  );

  if(!A)
    return res.status(400).json({
      error:'User not found'
    });

  const B=users.find(
    u=>u.id===A.partnerId
  );

  A._row.set('partnerId','');
  await A._row.save();

  if(B){
    B._row.set('partnerId','');
    await B._row.save();
  }

  res.json({ok:true});
});

app.post('/api/admin/run',auth,adminOnly,async(req,res)=>{
  res.json({
    ok:true,
    message:'Full cycle started. Reports go out when it finishes.'
  });

  runCycle().catch(console.error);
});

app.post('/api/admin/weekly',auth,adminOnly,async(req,res)=>{
  res.json({
    ok:true,
    message:'Weekly review is being written.'
  });

  weeklyReview().catch(console.error);
});

app.get('/health',(_req,res)=>{
  res.json({
    ok:true,
    mode:cfg().autoSend?'auto':'approval',
    v:2,
    driveOAuthConfigured:!!process.env.GOOGLE_OAUTH_REFRESH_TOKEN
  });
});

app.get('/run',(req,res)=>{
  if(!keyGuard(req,res))return;

  res.send('Cycle started');

  runCycle().catch(console.error);
});

app.use(
  express.static(
    path.join(__dirname,'public'),
    {
      setHeaders:(res,fp)=>{
        if(fp.endsWith('.html'))
          res.set('Cache-Control','no-store');
      }
    }
  )
);

app.get('*',(_req,res)=>{
  res.set('Cache-Control','no-store');
  res.sendFile(
    path.join(__dirname,'public','index.html')
  );
});

const TZ=process.env.TZ_NAME||'Asia/Karachi';

cron.schedule(
  process.env.CRON_MAIN||'0 6 * * *',
  ()=>runCycle().catch(console.error),
  {timezone:TZ}
);

cron.schedule(
  process.env.CRON_EVENING||'0 18 * * *',
  ()=>runCycle({light:true}).catch(console.error),
  {timezone:TZ}
);

cron.schedule(
  process.env.CRON_WEEKLY||'0 9 * * 0',
  ()=>weeklyReview().catch(console.error),
  {timezone:TZ}
);

const PORT=process.env.PORT||3000;

app.listen(PORT,()=>{
  console.log(
    `PostDocX v2 on :${PORT} | mode=${cfg().autoSend?'auto':'approval'} | tz=${TZ}`
  );
});
