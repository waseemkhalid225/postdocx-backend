// lib/visa_seed2.js — Day 23 · route rules for ten more destinations, each with its official source.
// Seeded UNVERIFIED like the first set; amounts are read from the source at verification time.
const S = (country_code, route_key, route_name, lane, rules) => rules.map(r => Object.assign({ country_code, route_key, route_name, lane }, r));
const doc = (doc_type, text) => ({ rule_type: 'document', text, value: { doc_type } });
const seed = [
  ...S('NL', 'nl_study', 'Netherlands study residence permit (MVV/VVR)', 'study', [
    { rule_type: 'eligibility', text: 'The recognised institution applies for the residence permit on the student\'s behalf (TEV procedure).', source_url: 'https://ind.nl/en/residence-permits/study/study-at-a-university-or-college', source_title: 'IND - Study' },
    { rule_type: 'financial', text: 'Proof of sufficient means for the year, at the monthly norm published by IND, usually transferred to the institution.', source_url: 'https://ind.nl/en/residence-permits/study/study-at-a-university-or-college', source_title: 'IND - Study' },
    doc('passport', 'Valid passport.'), doc('admission_letter', 'Admission from a recognised sponsor institution.'), doc('bank_statement', 'Means of support evidence.'), doc('insurance', 'Health insurance after arrival.'), doc('degree', 'Prior qualifications.'), doc('photo', 'Passport photo.'),
    { rule_type: 'work_rights', text: 'Students may work limited hours a week with a work permit obtained by the employer, or full-time in summer.', source_url: 'https://ind.nl/en/residence-permits/study/study-at-a-university-or-college', source_title: 'IND - Study' },
    { rule_type: 'pr_path', text: 'Orientation year (zoekjaar) after graduation; highly skilled migrant route afterwards.', source_url: 'https://ind.nl/en/residence-permits/work/orientation-year-highly-educated-persons', source_title: 'IND - Orientation year' }
  ]),
  ...S('SE', 'se_study', 'Sweden residence permit for studies', 'study', [
    { rule_type: 'eligibility', text: 'Admission to full-time studies and the first tuition instalment paid before applying.', source_url: 'https://www.migrationsverket.se/English/Private-individuals/Studying-and-researching-in-Sweden/Higher-education.html', source_title: 'Swedish Migration Agency - Higher education' },
    { rule_type: 'financial', text: 'Show funds for living costs at the monthly amount set by the Migration Agency for the whole period.', source_url: 'https://www.migrationsverket.se/English/Private-individuals/Studying-and-researching-in-Sweden/Higher-education.html', source_title: 'Swedish Migration Agency' },
    doc('passport', 'Valid passport.'), doc('admission_letter', 'Admission and tuition receipt.'), doc('bank_statement', 'Funds evidence.'), doc('insurance', 'Health insurance for studies under one year.'),
    { rule_type: 'work_rights', text: 'Students may work without a separate permit alongside studies.', source_url: 'https://www.migrationsverket.se/English/Private-individuals/Studying-and-researching-in-Sweden/Higher-education.html', source_title: 'Swedish Migration Agency' },
    { rule_type: 'pr_path', text: 'Residence permit to look for work after completed studies, then work permit.', source_url: 'https://www.migrationsverket.se/English/Private-individuals/Studying-and-researching-in-Sweden/Higher-education.html', source_title: 'Swedish Migration Agency' }
  ]),
  ...S('FI', 'fi_study', 'Finland residence permit for studies', 'study', [
    { rule_type: 'eligibility', text: 'Admission to a Finnish higher education institution; permit granted for the whole degree.', source_url: 'https://migri.fi/en/studying-in-finland', source_title: 'Migri - Studying in Finland' },
    { rule_type: 'financial', text: 'Secure means of support at the annual amount set by Migri, plus tuition where charged.', source_url: 'https://migri.fi/en/studying-in-finland', source_title: 'Migri' },
    doc('passport', 'Valid passport.'), doc('admission_letter', 'Certificate of admission.'), doc('bank_statement', 'Funds evidence.'), doc('insurance', 'Health insurance.'),
    { rule_type: 'work_rights', text: 'Students may work an average number of hours per week set by law during term.', source_url: 'https://migri.fi/en/studying-in-finland', source_title: 'Migri' },
    { rule_type: 'pr_path', text: 'Residence permit to seek work or start a business after graduation.', source_url: 'https://migri.fi/en/residence-permit-for-looking-for-work', source_title: 'Migri - Looking for work' }
  ]),
  ...S('NO', 'no_study', 'Norway study permit', 'study', [
    { rule_type: 'eligibility', text: 'Admission to full-time study at an approved institution.', source_url: 'https://www.udi.no/en/want-to-apply/studies/', source_title: 'UDI - Studies' },
    { rule_type: 'financial', text: 'Funds at the annual amount set by UDI, deposited in a Norwegian account or the institution\'s deposit account.', source_url: 'https://www.udi.no/en/want-to-apply/studies/', source_title: 'UDI' },
    doc('passport', 'Valid passport.'), doc('admission_letter', 'Admission letter.'), doc('bank_statement', 'Deposit confirmation.'),
    { rule_type: 'work_rights', text: 'Part-time work up to the weekly cap alongside studies.', source_url: 'https://www.udi.no/en/want-to-apply/studies/', source_title: 'UDI' }
  ]),
  ...S('DK', 'dk_study', 'Denmark residence permit for higher education', 'study', [
    { rule_type: 'eligibility', text: 'Admission to a state-recognised programme; the institution completes part of the application.', source_url: 'https://www.nyidanmark.dk/en-GB/You-want-to-apply/Study/Higher-education', source_title: 'New to Denmark - Higher education' },
    doc('passport', 'Valid passport.'), doc('admission_letter', 'Admission letter and tuition documentation.'), doc('bank_statement', 'Funds evidence.'), doc('language_test', 'Language documentation as required by the programme.'),
    { rule_type: 'work_rights', text: 'Limited weekly working hours during term, full-time in summer months.', source_url: 'https://www.nyidanmark.dk/en-GB/You-want-to-apply/Study/Higher-education', source_title: 'New to Denmark' },
    { rule_type: 'pr_path', text: 'Job-seeking period after graduation included with the study permit for degree students.', source_url: 'https://www.nyidanmark.dk/en-GB/You-want-to-apply/Study/Higher-education', source_title: 'New to Denmark' }
  ]),
  ...S('IT', 'it_study', 'Italy study visa (type D) and permesso di soggiorno', 'study', [
    { rule_type: 'eligibility', text: 'Pre-enrolment on Universitaly and admission; visa at the consulate, then residence permit within 8 days of arrival.', source_url: 'https://vistoperitalia.esteri.it/home/en', source_title: 'Visa for Italy' },
    { rule_type: 'financial', text: 'Means of subsistence at the amount set annually, plus accommodation and insurance.', source_url: 'https://vistoperitalia.esteri.it/home/en', source_title: 'Visa for Italy' },
    doc('passport', 'Valid passport.'), doc('admission_letter', 'Universitaly pre-enrolment and admission.'), doc('bank_statement', 'Funds evidence.'), doc('insurance', 'Health insurance.'), doc('degree', 'Declaration of value / CIMEA statement where required.'),
    { rule_type: 'work_rights', text: 'Part-time work up to the weekly and annual caps with a study permit.', source_url: 'https://vistoperitalia.esteri.it/home/en', source_title: 'Visa for Italy' }
  ]),
  ...S('FR', 'fr_study', 'France long-stay student visa (VLS-TS)', 'study', [
    { rule_type: 'eligibility', text: 'Admission via Campus France (Études en France) where applicable, then the visa on France-Visas.', source_url: 'https://france-visas.gouv.fr/en/web/france-visas/student', source_title: 'France-Visas - Student' },
    { rule_type: 'financial', text: 'Monthly means of support at the amount set by decree for the stay.', source_url: 'https://france-visas.gouv.fr/en/web/france-visas/student', source_title: 'France-Visas' },
    doc('passport', 'Valid passport.'), doc('admission_letter', 'Admission / Campus France attestation.'), doc('bank_statement', 'Funds evidence.'), doc('insurance', 'Insurance for the first months.'), doc('photo', 'Photo.'),
    { rule_type: 'work_rights', text: 'Students may work up to the annual hours cap.', source_url: 'https://france-visas.gouv.fr/en/web/france-visas/student', source_title: 'France-Visas' },
    { rule_type: 'pr_path', text: 'APS / job-search residence after a master\'s; talent passport routes for skilled work.', source_url: 'https://france-visas.gouv.fr/en/web/france-visas/student', source_title: 'France-Visas' }
  ]),
  ...S('ES', 'es_study', 'Spain student visa', 'study', [
    { rule_type: 'eligibility', text: 'Admission to an authorised programme; visa at the consulate for stays over 90 days, TIE card after arrival.', source_url: 'https://www.exteriores.gob.es/Consulados/londres/en/ServiciosConsulares/Paginas/Consular/Student-visa.aspx', source_title: 'Spain - Student visa' },
    { rule_type: 'financial', text: 'Means of subsistence as a percentage of IPREM per month for the stay.', source_url: 'https://www.exteriores.gob.es/Consulados/londres/en/ServiciosConsulares/Paginas/Consular/Student-visa.aspx', source_title: 'Spain - Student visa' },
    doc('passport', 'Valid passport.'), doc('admission_letter', 'Admission letter.'), doc('bank_statement', 'Funds evidence.'), doc('insurance', 'Health insurance.'), doc('police_certificate', 'Police certificate for stays over 6 months.'), doc('photo', 'Photo.'),
    { rule_type: 'work_rights', text: 'Students may work part-time compatible with studies (rules eased in 2022).', source_url: 'https://www.exteriores.gob.es/Consulados/londres/en/ServiciosConsulares/Paginas/Consular/Student-visa.aspx', source_title: 'Spain - Student visa' }
  ]),
  ...S('PL', 'pl_study', 'Poland national visa (D) for studies', 'study', [
    { rule_type: 'eligibility', text: 'Admission to a Polish higher education institution; temporary residence permit after arrival.', source_url: 'https://www.gov.pl/web/udsc-en/students', source_title: 'Office for Foreigners - Students' },
    { rule_type: 'financial', text: 'Funds for living and return travel at the amounts set by regulation; tuition paid or documented.', source_url: 'https://www.gov.pl/web/udsc-en/students', source_title: 'Office for Foreigners' },
    doc('passport', 'Valid passport.'), doc('admission_letter', 'Admission letter.'), doc('bank_statement', 'Funds evidence.'), doc('insurance', 'Health insurance.'), doc('degree', 'Legalised / apostilled previous diploma.'),
    { rule_type: 'work_rights', text: 'Full-time students at Polish universities may work without a work permit.', source_url: 'https://www.gov.pl/web/udsc-en/students', source_title: 'Office for Foreigners' }
  ]),
  ...S('NZ', 'nz_student', 'New Zealand fee-paying student visa', 'study', [
    { rule_type: 'eligibility', text: 'Offer of place from an approved education provider and evidence of tuition paid.', source_url: 'https://www.immigration.govt.nz/new-zealand-visas/visas/visa/fee-paying-student-visa', source_title: 'Immigration NZ - Fee paying student visa' },
    { rule_type: 'financial', text: 'Living funds at the annual amount set by Immigration NZ, plus onward travel.', source_url: 'https://www.immigration.govt.nz/new-zealand-visas/visas/visa/fee-paying-student-visa', source_title: 'Immigration NZ' },
    { rule_type: 'language', text: 'English at the level required by the provider / NZQA rules.', source_url: 'https://www.immigration.govt.nz/new-zealand-visas/visas/visa/fee-paying-student-visa', source_title: 'Immigration NZ' },
    doc('passport', 'Valid passport.'), doc('admission_letter', 'Offer of place and fee receipt.'), doc('bank_statement', 'Funds evidence.'), doc('police_certificate', 'Police certificate for stays over 24 months.'), doc('insurance', 'Medical and travel insurance.'),
    { rule_type: 'work_rights', text: 'Work up to the weekly cap during term for eligible courses.', source_url: 'https://www.immigration.govt.nz/new-zealand-visas/visas/visa/fee-paying-student-visa', source_title: 'Immigration NZ' },
    { rule_type: 'pr_path', text: 'Post Study Work Visa after eligible qualifications; skilled migrant pathways.', source_url: 'https://www.immigration.govt.nz/new-zealand-visas/visas/visa/post-study-work-visa', source_title: 'Immigration NZ - Post study work' }
  ])
];
module.exports = { seed };
