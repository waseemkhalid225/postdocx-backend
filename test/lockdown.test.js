// test/lockdown.test.js - DISCOVERY MODE must not leak a searchable identity.
const assert=require('assert');const fs=require('fs');
const sv=fs.readFileSync(__dirname+'/../server.js','utf8');
let passed=0;
const t=(n,f)=>{try{f();passed++}catch(e){console.error('FAIL: '+n+' -> '+e.message);process.exitCode=1}};

// Rebuild lockTease in isolation from the source, then prove what it emits.
const src=sv.slice(sv.indexOf('function hintLabel(o)'), sv.indexOf('app.get(\'/api/credits\''));
const generalTitle=o=>String(o.title||'').split(',')[0];
const remoteScope=()=>null;
const mod={};(new Function('generalTitle','remoteScope','module',src+';module.exports={hintLabel,relevanceLine,complexity,lockTease};'))(generalTitle,remoteScope,mod);
const {hintLabel,relevanceLine,complexity,lockTease}=mod.exports;

const SECRET={id:'a1',kind:'study',level:'phd',title:'PhD Position in Molecular Biology, Karolinska Institutet',
  institution:'Karolinska Institutet',url:'https://ki.se/jobs/12345',apply_url:'https://ki.se/apply/12345',
  contact_emails:['pi@ki.se'],contact_name:'Prof Anna Lind',reference:'REF-99',country_code:'SE',city:'Stockholm',
  req_field:'molecular biology',funding_type:'fully',deadline:'2026-12-01',description:'Karolinska Institutet seeks...',
  search_blob:'karolinska institutet phd molecular biology'};

t('locked payload contains no institution, url or contact',()=>{
  const out=JSON.stringify(lockTease(SECRET)).toLowerCase();
  ['karolinska','ki.se','pi@ki.se','anna lind','ref-99','/apply/'].forEach(s=>
    assert.ok(!out.includes(s),'LEAKED: '+s));
});
t('locked payload keeps what the applicant is entitled to see',()=>{
  const o=lockTease(SECRET);
  assert.strictEqual(o.country_code,'SE');
  assert.strictEqual(o.locked,true);
  assert.ok(o.hint&&o.deadline&&o.funding_type!==undefined);
});
t('the hint names level and subject without the programme title',()=>{
  const h=hintLabel(SECRET);
  assert.ok(/Doctoral research/.test(h),h);
  assert.ok(/Molecular Biology/i.test(h),h);
  assert.ok(!/karolinska/i.test(h),h);
});
t('a work posting is hinted as a role, not a degree',()=>{
  assert.ok(/Professional role/.test(hintLabel({kind:'work',title:'Senior Pharmacist, Hamad Medical',req_field:'pharmacy'})));
});
t('relevance lines differ with the match evidence',()=>{
  const a=relevanceLine({match:{pct:92,dims:{field:90,level:90}}});
  const b=relevanceLine({match:{pct:78,dims:{experience:88}}});
  assert.notStrictEqual(a,b);
});
t('complexity rises with what the advert demands',()=>{
  assert.strictEqual(complexity({req_documents:[]}),'Low');
  assert.strictEqual(complexity({req_documents:['a','b','c','d','e','f'],req_language:'IELTS'}),'High');
});
/* THE LEVEL LABEL MUST NEVER FALL BELOW THE EVIDENCE. A postdoc with an empty level
   column and a "Research Associate" title was being labelled "Graduate opportunity" and
   shown to a PhD holder who had filtered for postdocs. */
t('a salaried research associate post is labelled postdoctoral, not graduate',()=>{
  const h=hintLabel({level:null,kind:'study',title:'Research Associate in Molecular Biology',
    salary_note:'\u00a339,906 to \u00a346,049 per annum',description:'molecular biology group'});
  assert.ok(/Postdoctoral/.test(h),h);
  assert.ok(!/Graduate/.test(h),h);
});
t('a research fellow post is not called a graduate opportunity',()=>{
  const h=hintLabel({level:null,kind:'study',title:'Research Fellow',description:'the postholder will lead immunology projects'});
  assert.ok(/Postdoctoral/.test(h),h);
});
t('a German doctoral post is read as doctoral',()=>{
  assert.ok(/Doctoral/.test(hintLabel({level:null,kind:'study',title:'Promotionsstelle',description:'doctoral position in chemistry'})));
});
t('an unclassifiable academic post claims no level at all',()=>{
  const h=hintLabel({level:null,kind:'study',title:'Opening in the department',description:'we are recruiting'});
  assert.ok(/Research position/.test(h),h);
  assert.ok(!/Graduate|Master|Undergraduate/.test(h),h);
});
/* NO VAGUE LABEL MAY RETURN. Each of these phrases described our own ignorance as if it
   were a property of the position, and each one reached a paying customer's screen. */
t('no vague deadline or placeholder wording survives in the interface',()=>{
  const fe=fs.readFileSync(__dirname+'/../public/index.html','utf8');
  ['Rolling, no fixed date','Rolling or open','Verified position',
   'Terms on the official page','Stated on page'].forEach(p=>{
    assert.ok(!fe.includes("'"+p+"'")&&!fe.includes('>'+p+'<'),'vague label back in the UI: '+p);
  });
});
t('a missing deadline is stated as a fact about the advert',()=>{
  const fe=fs.readFileSync(__dirname+'/../public/index.html','utf8');
  assert.ok(fe.includes('No closing date stated'),'the honest phrase is missing');
});
/* NO ROUTE MAY HANG. Every async handler must be wrapped so a thrown error answers 500
   instead of leaving the request open until the browser gives up. */
t('every route handler is wrapped against unhandled rejections',()=>{
  assert.ok(sv.includes('NO REQUEST MAY HANG')&&sv.includes("app[m] = function (path, ...handlers)"),'route wrapper missing');
});
t('the owner account is not re-checked on every request',()=>{
  assert.ok(sv.includes('_ownerChecked.has(u.id)'),'per-request owner check is back');
});
/* THE ADJACENCY CAPABILITY TEST (item 14 of the fifteen). A different title is not a
   different job when the applicant's stated skills cover what the posting asks for; a
   licensed practitioner title the applicant does not hold is never crossed. */
const M=require('../lib/match');
const PH={_profile:{field:'pharmacy',professions:['Pharmacist'],skills_verbatim:['pharmacovigilance','signal detection','regulatory affairs','SOP writing','internal audit','ISO 9001'],methods:''},_wantCountries:['IE']};
const ev=(title,desc)=>M.evaluate({kind:'work',title,country_code:'IE',description:desc},PH);
t('a covering skill set makes a different title ADJACENT, with evidence',()=>{
  const r=ev('Compliance Officer','Own the SOP writing programme, run internal audit cycles against ISO 9001, lead regulatory affairs submissions');
  assert.strictEqual(r.adjacentRole,true); assert.strictEqual(r.fieldMismatch,false);
  assert.ok(r.adjacentEvidence.length>=3,'evidence missing');
});
t('a licensed practitioner title is never crossed, whatever the overlap',()=>{
  ['Consultant Physician','Solicitor','Staff Nurse'].forEach(ti=>{
    const r=ev(ti,'pharmacovigilance signal detection regulatory affairs SOP writing internal audit ISO 9001');
    assert.strictEqual(r.adjacentRole,false,ti); assert.strictEqual(r.fieldMismatch,true,ti);
  });
});
t('one incidental overlapping word does not make a role adjacent',()=>{
  const r=ev('Marketing Manager','campaigns, brand strategy, an ISO 9001 mention');
  assert.strictEqual(r.adjacentRole,false); assert.strictEqual(r.fieldMismatch,true);
});
t('a case cannot start on a closed or dead position and no credit is spent',()=>{
  assert.ok(sv.includes('RE-VERIFY BEFORE A CREDIT IS SPENT')&&sv.includes("OPP_DEAD_ON_OPEN")&&sv.includes('No credit was spent'));
});
console.log('lockdown: '+passed+' assertions passed'+(process.exitCode?' WITH FAILURES':''));
