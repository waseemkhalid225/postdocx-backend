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
console.log('lockdown: '+passed+' assertions passed'+(process.exitCode?' WITH FAILURES':''));
