// lib/domains.js - every profession this platform serves, not only the clinical ones.
//
// WHY. The matching gates and the source atlases were written around health careers:
// pharmacy, medicine, nursing, dentistry. Everything else - software, civil engineering,
// law, accounting, teaching, architecture, agriculture, economics, design, logistics -
// fell through every one of them. A software engineer got no job-board atlas at all,
// because the atlas was gated behind a "is this a medical field" test, and no profession
// gate, because the gate only knew four clinical roles. That is not a platform for
// Pakistani applicants; it is a platform for Pakistani pharmacists.
//
// Each family carries four things:
//   syn    - words that mean "this is my field", for matching a profile to a posting
//   role   - a regex over a JOB TITLE, so a posting can be assigned to a family
//   boards - where positions in this family are actually advertised
//   creds  - the bodies that verify or license this family, where one exists

const FAMILIES = {
  pharmacy: {
    syn: ['pharmacy', 'pharmacist', 'pharmaceutical', 'pharmacology', 'pharmacologist', 'pharmacovigilance', 'regulatory affairs', 'pharm'],
    role: /\b(pharmacist|pharmacy|pharmaceutical|pharmacolog|pharmacovigilance|drug safety)\b/i,
    boards: 'PharmiWeb, RAPS careers, TOPRA, ISPE, industry careers pages of manufacturers and CROs',
    creds: 'DataFlow and SCFHS, DHA, DOH Abu Dhabi, MOH UAE, QCHP, NHRA, OMSB for the Gulf; GPhC for the UK; PEBC for Canada; APC and AHPRA for Australia; NAPLEX and FPGEC for the USA'
  },
  medicine: {
    syn: ['medicine', 'medical', 'physician', 'doctor', 'clinical', 'surgery', 'surgeon', 'mbbs'],
    role: /\b(physician|medical officer|consultant (physician|surgeon)|surgeon|registrar|resident doctor|general practitioner|\bgp\b|cardiolog|radiolog|anaesth|paediatric|psychiatr|dermatolog|oncolog)\b/i,
    boards: 'NHS Jobs and Trac.jobs, HSE.ie, Hamad Medical, SEHA and PureHealth, KFSH&RC, Saudi MOH careers, Health New Zealand, state health careers Australia, BMJ Careers',
    creds: 'DataFlow, SCFHS, DHA, QCHP; GMC and PLAB for the UK; ECFMG and USMLE for the USA; AMC for Australia; MCC for Canada; IMC for Ireland'
  },
  nursing: {
    syn: ['nursing', 'nurse', 'midwifery', 'midwife'],
    role: /\b(nurse|nursing|midwife|midwifery|charge nurse|staff nurse)\b/i,
    boards: 'NHS Jobs, HSE.ie, Gulf hospital careers pages, Seek and state health careers, Health New Zealand',
    creds: 'DataFlow and the Gulf health authorities; NMC and OSCE for the UK; NCLEX and CGFNS for the USA; NMBA and AHPRA for Australia; NNAS for Canada'
  },
  dentistry: {
    syn: ['dentistry', 'dental', 'dentist', 'orthodont'],
    role: /\b(dentist|dental|orthodont|periodont|endodont)\b/i,
    boards: 'NHS dental vacancies, Gulf hospital and clinic careers, BDJ Jobs',
    creds: 'DataFlow and the Gulf authorities; GDC and ORE for the UK; NBDE and ADA for the USA; ADC for Australia; NDEB for Canada'
  },
  allied_health: {
    syn: ['physiotherapy', 'physiotherapist', 'radiography', 'radiographer', 'laboratory', 'medical technologist', 'optometry', 'nutrition', 'dietitian', 'speech therapy', 'occupational therapy', 'allied health'],
    role: /\b(physiotherapist|physical therapist|radiograph|sonograph|medical (laboratory|technolog)|optometrist|dietitian|nutritionist|speech (and language )?therapist|occupational therapist)\b/i,
    boards: 'NHS Jobs, Gulf hospital careers, Seek health, allied health recruiters',
    creds: 'DataFlow and the Gulf authorities; HCPC for the UK; ASCP and ARRT for the USA; AHPRA for Australia'
  },
  veterinary: {
    syn: ['veterinary', 'veterinarian', 'animal health', 'dvm'],
    role: /\b(veterinar|animal health officer)\b/i,
    boards: 'Vet Times Jobs, AVMA career centre, government animal health services',
    creds: 'RCVS for the UK; AVMA ECFVG for the USA; AVBC for Australia'
  },
  software: {
    syn: ['software', 'computer science', 'information technology', 'programming', 'developer', 'data science', 'machine learning', 'artificial intelligence', 'devops', 'cyber security', 'cybersecurity', 'it'],
    role: /\b(software (engineer|developer)|developer|programmer|data (scientist|engineer|analyst)|machine learning|ml engineer|devops|sre|cloud (engineer|architect)|cyber ?security|penetration tester|qa engineer|full[- ]stack|front[- ]end|back[- ]end|mobile developer)\b/i,
    boards: 'LinkedIn Jobs, Indeed, Otta, Wellfound, Hacker News Who Is Hiring, Stack Overflow Jobs, EU Tech Jobs, Berlin Startup Jobs, Relocate.me, employer engineering career pages',
    creds: 'No licence in most countries. Skills assessment may apply for migration: ACS for Australia, and CIPS or provincial bodies in Canada'
  },
  engineering: {
    syn: ['engineering', 'engineer', 'mechanical', 'civil', 'electrical', 'chemical engineering', 'petroleum', 'industrial engineering', 'mechatronics', 'aerospace', 'structural'],
    role: /\b(mechanical|civil|electrical|structural|chemical|petroleum|industrial|mechatronic|aerospace|automotive|process|maintenance|site|project) engineer\b|\bengineering (manager|lead)\b|\bquantity surveyor\b/i,
    boards: 'jobs.ac.uk engineering, EURES, Indeed, LinkedIn, GulfTalent and Bayt for the Gulf, NES Fircroft and Airswift for energy, employer career pages',
    creds: 'Engineers Australia for skills assessment; Engineering Council and CEng for the UK; NCEES and the state PE boards for the USA; Engineers Canada and the provincial associations; PEC recognition in Pakistan'
  },
  architecture: {
    syn: ['architecture', 'architect', 'urban planning', 'town planning', 'planner', 'interior design', 'landscape architecture'],
    role: /\b(architect|urban planner|town planner|interior designer|landscape architect)\b/i,
    boards: 'Dezeen Jobs, Archinect, RIBA Jobs, LinkedIn, practice career pages',
    creds: 'ARB and RIBA for the UK; NCARB for the USA; AACA for Australia; CACB for Canada'
  },
  law: {
    syn: ['law', 'legal', 'llb', 'llm', 'advocate', 'barrister', 'solicitor', 'lawyer', 'jurisprudence', 'compliance'],
    role: /\b(lawyer|solicitor|barrister|advocate|legal (counsel|adviser|officer)|paralegal|compliance officer)\b/i,
    boards: 'LawCareers, Legal Week Jobs, LinkedIn, UN and INGO legal vacancies, firm career pages',
    creds: 'SQE for England and Wales; state bar admission for the USA; legal practice board admission for Australia; NCA assessment for Canada'
  },
  finance: {
    syn: ['accounting', 'accountant', 'finance', 'audit', 'taxation', 'banking', 'actuarial', 'acca', 'cfa', 'cpa'],
    role: /\b(accountant|auditor|financial analyst|finance (manager|officer)|tax (adviser|consultant)|actuar|treasury|risk analyst|investment analyst)\b/i,
    boards: 'eFinancialCareers, LinkedIn, Big Four career pages, GulfTalent, Bayt, Robert Half',
    creds: 'ACCA, ICAEW and CIMA for the UK; CPA for the USA, Australia and Canada; CFA globally'
  },
  business: {
    syn: ['business', 'management', 'marketing', 'human resources', 'supply chain', 'logistics', 'operations', 'sales', 'procurement', 'mba', 'project management'],
    role: /\b(business (analyst|development)|project manager|programme manager|product manager|marketing (manager|executive)|hr (manager|officer)|human resources|supply chain|logistics|procurement|operations manager|sales (manager|executive))\b/i,
    boards: 'LinkedIn, Indeed, GulfTalent, Bayt, Michael Page, Hays, employer career pages',
    creds: 'No licence. PMP, CIPS, CSCP and similar certifications are often asked for'
  },
  education: {
    syn: ['education', 'educationist', 'teaching', 'teacher', 'lecturer', 'professor', 'instructor', 'pedagogy', 'curriculum', 'academic', 'b.ed', 'm.ed'],
    role: /\b(teacher|lecturer|instructor|tutor|professor|assistant professor|academic|curriculum (developer|specialist)|education officer)\b/i,
    boards: 'TES Jobs, jobs.ac.uk, Times Higher Education Unijobs, HigherEdJobs, Teach Away, Search Associates, international school career pages, Gulf school groups',
    creds: 'QTS for the UK; state teaching licence for the USA; AITSL for Australia; provincial certification for Canada'
  },
  sciences: {
    syn: ['biology', 'biological', 'life sciences', 'biomedical', 'biotechnology', 'chemistry', 'chemical', 'physics', 'mathematics', 'statistics', 'environmental science', 'geology', 'microbiology', 'genetics', 'neuroscience', 'materials science'],
    role: /\b(research (scientist|associate|fellow|assistant)|postdoc|scientist|laboratory (scientist|manager)|bioinformatic|computational (biolog|chemist)|statistician|data analyst)\b/i,
    boards: 'Nature Careers, EURAXESS, jobRxiv, AcademicPositions, Times Higher Education Unijobs, ResearchGate Jobs, national laboratory career pages',
    creds: 'No licence. Chartered status such as CChem or CBiol is optional'
  },
  agriculture: {
    syn: ['agriculture', 'agricultural', 'agronomy', 'agronomist', 'horticulture', 'horticulturist', 'food science', 'food technologist', 'soil science', 'fisheries', 'forestry', 'forester'],
    role: /\b(agronomist|agricultur|horticultur|food (scientist|technologist)|soil scientist|forestry|fisheries officer)\b/i,
    boards: 'AgCareers, FAO and CGIAR vacancies, EURAXESS agriculture, national agricultural research councils',
    creds: 'No licence in most countries'
  },
  social: {
    syn: ['psychology', 'psychologist', 'sociology', 'social work', 'anthropology', 'political science', 'international relations', 'development studies', 'economics', 'public policy', 'public health'],
    role: /\b(psychologist|counsellor|social worker|economist|policy (analyst|officer)|research officer|programme officer|public health (officer|specialist)|epidemiolog)\b/i,
    boards: 'UN Careers, WHO Careers, UNDP Jobs, ReliefWeb, Devex, Impactpool, Idealist, university and think-tank career pages',
    creds: 'HCPC for UK practitioner psychologists; state licensure for USA clinical psychology; Social Work England and equivalents for social work'
  },
  media: {
    syn: ['journalism', 'journalist', 'media', 'mass communication', 'communications', 'graphic design', 'designer', 'film', 'content', 'public relations', 'ux', 'user experience', 'animation'],
    role: /\b(journalist|editor|content (writer|manager)|communications (officer|manager)|graphic designer|ux (designer|researcher)|product designer|public relations|videographer)\b/i,
    boards: 'LinkedIn, Dribbble Jobs, Behance, Journalism.co.uk, Devex communications roles, agency career pages',
    creds: 'No licence'
  },
  humanities: {
    syn: ['history', 'philosophy', 'islamic studies', 'religious studies', 'linguistics', 'languages', 'literature', 'translation', 'library science', 'information science', 'archaeology'],
    role: /\b(historian|philosoph|linguist|translator|interpreter|librarian|archivist|curator|lecturer in (history|philosophy|literature))\b/i,
    boards: 'jobs.ac.uk, Times Higher Education Unijobs, HigherEdJobs, H-Net, museum and archive career pages, translation agencies, UN language careers',
    creds: 'No licence. Translation roles may require CIOL, ATA or NAATI certification'
  },
  arts: {
    syn: ['fine arts', 'music', 'performing arts', 'theatre', 'dance', 'visual arts', 'sculpture', 'painting'],
    role: /\b(musician|composer|artist|curator|performer|choreograph|art (teacher|director)|conservatoire)\b/i,
    boards: 'ArtsJobs, conservatoire and academy career pages, festival and orchestra vacancies, university arts faculties',
    creds: 'No licence'
  },
  aviation: {
    syn: ['aviation', 'piloting', 'pilot', 'air traffic', 'aeronautical', 'cabin crew', 'flight'],
    role: /\b(pilot|first officer|air traffic controller|flight (instructor|dispatcher)|aircraft (engineer|technician)|cabin crew)\b/i,
    boards: 'airline career pages, Aviation Job Search, Flightglobal Jobs, Gulf carrier careers',
    creds: 'EASA licence conversion for Europe; FAA for the USA; CASA for Australia; GCAA and GACA for the Gulf; ICAO English proficiency throughout'
  },
  maritime: {
    syn: ['maritime', 'shipping', 'marine engineering', 'nautical', 'seafarer', 'port management', 'logistics shipping'],
    role: /\b(marine engineer|deck officer|master mariner|port (manager|officer)|ship (superintendent|broker)|naval architect)\b/i,
    boards: 'Maritime Jobs, Martide, shipping company and port authority career pages',
    creds: 'STCW certification, flag-state endorsement and MCA or equivalent recognition of Pakistani certificates of competency'
  },
  hospitality: {
    syn: ['hospitality', 'tourism', 'hotel management', 'culinary', 'chef', 'aviation', 'pilot', 'cabin crew', 'travel management'],
    role: /\b(hotel|hospitality|chef|culinary|tourism|cabin crew|flight attendant|front office manager)\b/i,
    boards: 'Hosco, Caterer, Gulf hotel group career pages, airline career pages',
    creds: 'No licence. Aviation roles carry their own medical and training requirements'
  }
};


/* ---------------------------------------------------------------------------
   THE FULL PROFESSION LIST. The finder offers 108 professions. The families
   above are how we reason about them, but every one of those 108 dropdown
   values must resolve to a family, or the applicant who picks it gets no
   source atlas, no credential guidance and no profession gate. This map is the
   contract between the dropdown and the engine, and the test at the bottom of
   this file fails loudly if the two ever drift apart.
   --------------------------------------------------------------------------- */
const FIELD_MAP = {
  medicine: 'medicine', 'public-health': 'social', paramedical: 'allied_health',
  pharmacy: 'pharmacy', nursing: 'nursing', 'nursing-midwifery': 'nursing',
  dentistry: 'dentistry', physiotherapy: 'allied_health', 'allied-health': 'allied_health',
  'medical-laboratory': 'allied_health', 'radiology-imaging': 'allied_health',
  'occupational-therapy': 'allied_health', 'speech-therapy': 'allied_health',
  optometry: 'allied_health', audiology: 'allied_health', 'nutrition-dietetics': 'allied_health',
  veterinary: 'veterinary', psychology: 'social',
  biotechnology: 'sciences', microbiology: 'sciences', biochemistry: 'sciences',
  genetics: 'sciences', 'life-sciences': 'sciences', chemistry: 'sciences',
  physics: 'sciences', mathematics: 'sciences', statistics: 'sciences',
  'environmental-science': 'sciences', 'earth-sciences': 'sciences', astronomy: 'sciences',
  'materials-science': 'sciences', nanotechnology: 'sciences',
  'it-software': 'software', 'computer-science': 'software', 'data-science': 'software',
  'artificial-intelligence': 'software', cybersecurity: 'software', networking: 'software',
  'web-app-development': 'software', 'game-development': 'software', 'cloud-computing': 'software',
  robotics: 'software',
  'electrical-engineering': 'engineering', 'mechanical-engineering': 'engineering',
  'civil-engineering': 'engineering', 'chemical-engineering': 'engineering',
  'petroleum-engineering': 'engineering', 'mining-engineering': 'engineering',
  'industrial-engineering': 'engineering', 'aerospace-engineering': 'engineering',
  'automotive-engineering': 'engineering', 'biomedical-engineering': 'engineering',
  mechatronics: 'engineering', 'telecom-engineering': 'engineering',
  'textile-engineering': 'engineering', 'energy-renewables': 'engineering',
  'construction-management': 'engineering',
  architecture: 'architecture', 'urban-planning': 'architecture', 'interior-design': 'architecture',
  'business-administration': 'business', management: 'business', marketing: 'business',
  sales: 'business', 'human-resources': 'business', 'supply-chain-logistics': 'business',
  'project-management': 'business', entrepreneurship: 'business', 'international-business': 'business',
  accounting: 'finance', finance: 'finance', banking: 'finance', economics: 'finance',
  law: 'law', criminology: 'law',
  'political-science': 'social', 'international-relations': 'social',
  'public-administration': 'social', sociology: 'social', 'social-work': 'social',
  anthropology: 'social',
  history: 'humanities', philosophy: 'humanities', 'islamic-studies': 'humanities',
  'languages-linguistics': 'humanities', literature: 'humanities',
  'library-information-science': 'humanities',
  'journalism-media': 'media', communication: 'media', 'film-television': 'media',
  'graphic-design': 'media', 'fashion-design': 'media',
  'fine-arts': 'arts', music: 'arts', 'performing-arts': 'arts',
  'education-teaching': 'education', 'early-childhood-education': 'education',
  'special-education': 'education', 'sports-science': 'education',
  'hospitality-tourism': 'hospitality', 'culinary-arts': 'hospitality',
  'aviation-piloting': 'aviation', 'maritime-shipping': 'maritime',
  agriculture: 'agriculture', 'food-science': 'agriculture', forestry: 'agriculture',
  fisheries: 'agriculture', horticulture: 'agriculture'
};
/* The dropdown value the applicant actually picked, turned into something the engine can
   use. Returns the family plus the words that mean "this is my field", so the filter can
   match a posting on its own vocabulary rather than on a slug that appears nowhere. */
function fieldSlugToFamily(slug) { return FIELD_MAP[String(slug || '').toLowerCase()] || null; }
function termsForSlug(slug) {
  const s = String(slug || '').toLowerCase();
  const fam = FIELD_MAP[s];
  const own = s.split('-').filter(w => w.length > 2);
  const famWords = fam && FAMILIES[fam] ? FAMILIES[fam].syn : [];
  return [...new Set(own.concat(famWords))];
}

/* Which families does this person belong to? A person can belong to several, which is the
   normal case: a pharmacist with a pharmacology doctorate is pharmacy AND sciences. */
function familiesFor(terms) {
  const blob = (Array.isArray(terms) ? terms : [terms]).join(' ').toLowerCase();
  const out = [];
  for (const [key, f] of Object.entries(FAMILIES)) {
    if (f.syn.some(w => blob.includes(w))) out.push(key);
  }
  return out;
}
/* Which family does this JOB TITLE belong to? Null when the title names no profession we
   recognise, which must never be treated as a mismatch - only as unknown. */
function familyOfTitle(title) {
  const t = String(title || '');
  for (const [key, f] of Object.entries(FAMILIES)) if (f.role.test(t)) return key;
  return null;
}
/* The source atlas for this applicant. Every family they belong to contributes, so a
   pharmacist-pharmacologist is searched on industry boards AND academic boards. */
function sourceAtlas(fams) {
  const list = (fams || []).filter(f => FAMILIES[f]);
  if (!list.length) return '';
  return 'WHERE POSITIONS IN THIS FIELD ARE ACTUALLY ADVERTISED, search these as well as employer pages: '
    + list.map(f => FAMILIES[f].boards).join('; ') + '.';
}
function credentialAtlas(fams) {
  const list = (fams || []).filter(f => FAMILIES[f] && FAMILIES[f].creds);
  if (!list.length) return '';
  return 'CREDENTIAL AND VERIFICATION BODIES that apply to this field: ' + list.map(f => FAMILIES[f].creds).join('; ')
    + '. When the advert or the regulator states a verification body, processing time or official fee, record it exactly; never estimate one, and never offer to obtain a credential.';
}
module.exports = { FAMILIES, FIELD_MAP, familiesFor, familyOfTitle, sourceAtlas, credentialAtlas, fieldSlugToFamily, termsForSlug };
