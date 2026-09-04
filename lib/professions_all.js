// lib/professions_all.js — every ISCO-08 sub-major profession group × every destination: is the profession regulated,
// who recognises the qualification, and what a foreign-trained professional must do before working. Health professions
// keep their named regulators (professions.js, visa_seed3/5); the rest use the national recognition authority as the
// sourced entry point (ENIC-NARIC network members, WES/IQAS-type assessors, ECCTIS, ANABIN/ZAB, DoE Australia).
const { PORTALS } = require('./visa_portals');
const RECOG = { GB: ['https://www.enic.org.uk/', 'UK ENIC'], IE: ['https://www.qqi.ie/what-we-do/qualifications-recognition', 'QQI NARIC Ireland'], DE: ['https://anabin.kmk.org/anabin.html', 'ANABIN / ZAB'], AT: ['https://www.enic-naric.net/page-Austria', 'ENIC NARIC Austria'], CH: ['https://www.sbfi.admin.ch/sbfi/en/home/education/recognition-of-foreign-qualifications.html', 'SERI Switzerland'], NL: ['https://www.nuffic.nl/en/subjects/diploma-recognition', 'Nuffic'], BE: ['https://www.naricvlaanderen.be/en', 'NARIC Vlaanderen'], LU: ['https://guichet.public.lu/en/citoyens/enseignement-formation/reconnaissance-diplomes.html', 'Luxembourg recognition'], FR: ['https://www.france-education-international.fr/en/enic-naric', 'ENIC-NARIC France'], ES: ['https://www.universidades.gob.es/homologacion-y-equivalencia/', 'Spain homologación'], PT: ['https://www.dges.gov.pt/en/pagina/recognition-foreign-degrees', 'DGES Portugal'], IT: ['https://www.cimea.it/EN/', 'CIMEA'], MT: ['https://mfhea.mt/mqric/', 'MQRIC Malta'], CY: ['http://www.kysats.ac.cy/', 'KYSATS Cyprus'], GR: ['https://www.doatap.gr/en/', 'DOATAP'], PL: ['https://nawa.gov.pl/en/recognition', 'NAWA Poland'], CZ: ['https://www.msmt.cz/eu-and-international-affairs/recognition-of-foreign-higher-education', 'MŠMT Czechia'], SK: ['https://www.minedu.sk/recognition-of-foreign-diplomas/', 'Slovak Ministry of Education'], HU: ['https://www.oktatas.hu/felsooktatas/kepesites_elismertetes/eng', 'Hungarian Equivalence Centre'], SI: ['https://www.enic-naric.net/page-Slovenia', 'ENIC-NARIC Slovenia'], HR: ['https://www.azvo.hr/en/enic-naric', 'ENIC-NARIC Croatia'], BG: ['https://www.nacid.bg/en', 'NACID Bulgaria'], RO: ['https://www.cnred.edu.ro/en', 'CNRED Romania'], EE: ['https://harno.ee/en/enic-naric', 'ENIC-NARIC Estonia'], LV: ['https://www.aic.lv/portal/en', 'AIC Latvia'], LT: ['https://www.skvc.lt/default/en/', 'SKVC Lithuania'], FI: ['https://www.oph.fi/en/services/recognition-and-international-comparability-qualifications', 'Finnish National Agency for Education'], SE: ['https://www.uhr.se/en/start/recognition-of-foreign-qualifications/', 'UHR Sweden'], NO: ['https://hkdir.no/en/foreign-education', 'HK-dir Norway'], DK: ['https://ufm.dk/en/education/recognition-and-transparency', 'Danish Agency for Higher Education'], US: ['https://www.wes.org/', 'WES (credential evaluation)'], CA: ['https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/documents/education-assessed.html', 'IRCC - ECA'], AU: ['https://www.education.gov.au/international-education/international-qualifications-assessment', 'Australian Department of Education'], NZ: ['https://www2.nzqa.govt.nz/qualifications/international-qualifications/', 'NZQA'], AE: ['https://www.moe.gov.ae/En/EServices/ServiceCard/Pages/Equivalency.aspx', 'UAE MOE equivalency'], SA: ['https://www.moe.gov.sa/', 'Saudi MOE equivalency'], QA: ['https://www.edu.gov.qa/', 'Qatar MOEHE'], OM: ['https://www.moe.gov.om/', 'Oman MOHERI'], BH: ['https://www.moe.gov.bh/', 'Bahrain HEC'], KW: ['https://www.moe.edu.kw/', 'Kuwait MOE'], TR: ['https://www.yok.gov.tr/', 'YÖK denklik'], AZ: ['https://edu.gov.az/', 'Azerbaijan MoE'], GE: ['https://eqe.ge/en', 'NCEQE Georgia'], KZ: ['https://enic-kazakhstan.edu.kz/en', 'ENIC Kazakhstan'], UZ: ['https://edu.uz/', 'Uzbekistan MoHE'], MY: ['https://www.mqa.gov.my/', 'MQA Malaysia'], SG: ['https://www.mom.gov.sg/', 'MOM (recognition by employer/pass)'], JP: ['https://www.nic-japan.niad.ac.jp/en/', 'NIC-Japan'], KR: ['https://www.kcue.or.kr/eng/', 'Korea NIC'], CN: ['http://www.cscse.edu.cn/', 'CSCSE China'], HK: ['https://www.hkcaavq.edu.hk/', 'HKCAAVQ'], TW: ['https://www.edu.tw/', 'Taiwan MoE'], TH: ['https://www.mhesi.go.th/', 'Thailand MHESI'], BN: ['https://www.moe.gov.bn/', 'Brunei MoE'] };
const PROFS = [
  ['teacher', '23', true, 'School teachers are regulated: qualified-teacher registration with the education authority (state/provincial in federal systems) after qualification recognition; language of instruction required.'],
  ['engineer', '214', false, 'Engineers: title or practice protection varies (licensed in Canada P.Eng, US PE, Saudi/UAE councils); most employment needs only degree recognition; migration streams need a skills assessment.'],
  ['architect', '2161', true, 'Architects: registration with the national architects\' board after recognition; EU directive routes for EU-qualified only.'],
  ['lawyer', '261', true, 'Lawyers: requalification through the bar or law society of the destination; foreign-law consultant registration in some jurisdictions.'],
  ['accountant', '2411', false, 'Accountants: employment usually needs no licence; audit signing rights and the local designation (CPA/CA) require the national body\'s route.'],
  ['veterinarian', '2250', true, 'Veterinarians: registration with the national veterinary council after recognition and, in most countries, an examination.'],
  ['psychologist', '2634', true, 'Psychologists: registration with the national board; supervised practice may be required.'],
  ['social_worker', '2635', true, 'Social workers: registration with the national regulator in many destinations; language required.'],
  ['software_developer', '2512', false, 'ICT professionals: not licensed; degree recognition or experience-based routes for permits (e.g. Germany IT specialist).'],
  ['data_scientist', '2511', false, 'Data and systems professionals: not licensed; degree recognition for permits.'],
  ['finance_professional', '241', false, 'Finance professionals: not licensed for employment; regulated activities (advice, securities) need the financial regulator\'s certification.'],
  ['marketing_sales', '243', false, 'Marketing and sales professionals: not licensed.'],
  ['hr_professional', '2423', false, 'HR professionals: not licensed.'],
  ['manager', '12', false, 'Managers: not licensed; senior roles use intra-company or executive permit streams.'],
  ['scientist_researcher', '21', false, 'Scientists and researchers: not licensed; researcher permits (EU Directive 2016/801, hosting agreements) apply.'],
  ['biologist_chemist', '213', false, 'Life and physical scientists: not licensed outside clinical laboratory roles.'],
  ['lab_technologist', '3212', true, 'Medical laboratory scientists: regulated in most destinations (HCPC, NHRA, DHA, AIMS…) with registration and exams.'],
  ['radiographer', '3211', true, 'Radiographers: regulated; registration with the health regulator after recognition.'],
  ['paramedic', '3258', true, 'Paramedics: regulated; registration with the health regulator.'],
  ['midwife', '2222', true, 'Midwives: regulated; registration with the nursing and midwifery regulator.'],
  ['optometrist', '2267', true, 'Optometrists: regulated; national optical board registration.'],
  ['dietitian', '2265', true, 'Dietitians: regulated in most destinations; registration after recognition.'],
  ['chef', '3434', false, 'Chefs: not licensed; food-safety certificate on arrival.'],
  ['electrician', '741', true, 'Electricians: licensed trade in most destinations; trade recognition or local certification (e.g. Australia OTSR, Canada Red Seal, UK ECS card).'],
  ['plumber', '712', true, 'Plumbers: licensed trade in most destinations; local certification required.'],
  ['welder', '7212', false, 'Welders: not licensed generally; coded welder certificates (ISO 9606) recognised by employers.'],
  ['mechanic', '723', false, 'Mechanics: not licensed generally; trade recognition for migration streams.'],
  ['driver', '832', true, 'Professional drivers: local licence conversion or test; heavy vehicle categories need local certification.'],
  ['pilot', '3153', true, 'Pilots: licence conversion with the civil aviation authority (EASA, FAA, CASA…); type ratings and language proficiency.'],
  ['seafarer', '315', true, 'Seafarers: STCW certificates recognised through the flag state\'s maritime authority endorsement.'],
  ['care_worker', '5322', false, 'Care workers: not licensed but background checks and care certificates apply; visa routes are specific (UK care worker, Japan SSW).'],
  ['hospitality', '5', false, 'Hospitality and service staff: not licensed; sector-specific work visas (seasonal, SSW, hospitality streams).'],
  ['construction', '7', false, 'Construction trades: mostly not licensed except electrical/plumbing/gas; safety cards on site.'],
  ['agriculture', '6', false, 'Agricultural workers: not licensed; seasonal worker schemes.'],
  ['journalist', '264', false, 'Journalists and writers: not licensed; press accreditation where required.'],
  ['designer', '216', false, 'Designers and creative professionals: not licensed; portfolio-based hiring.'],
  ['librarian_archivist', '262', false, 'Librarians and archivists: not licensed; qualification recognition.'],
  ['sports_coach', '342', false, 'Coaches and fitness professionals: federation certification; not state-licensed in most destinations.'],
  ['security', '541', true, 'Security staff: licensed in most destinations; local licence and background check.']
];
function rules() {
  const out = [];
  for (const cc of Object.keys(PORTALS)) { const R = RECOG[cc] || [PORTALS[cc][0], PORTALS[cc][1]];
    for (const [key, isco, regulated, text] of PROFS) out.push({ country_code: cc, route_key: cc.toLowerCase() + '_licence_' + key, route_name: 'Licence: ' + key.replace(/_/g, ' ') + ' in ' + cc, lane: 'work', rule_type: 'licence', text: text + ' In ' + cc + ', start with qualification recognition through ' + R[1] + '; the competent authority for the regulated profession is listed there.', value: { profession: key, isco, regulated }, source_url: R[0], source_title: R[1] }); }
  return out;
}
module.exports = { PROFS, RECOG, rules };
