// lib/portal_maps.js — KNOWN PORTAL FIELD MAPS. When the assistant is on one of these hosts, these selectors win over the heuristic
// label matching. Keys are field names the assistant already understands. Add a host, ship it with the next package.
const MAPS = {
  'apply.ukvi.homeoffice.gov.uk': { first_name: 'input[name*="givenName"],input[id*="given"]', last_name: 'input[name*="familyName"],input[id*="family"]', date_of_birth: 'input[name*="dateOfBirth"],input[id*="dob"]', passport_number: 'input[name*="passportNumber"]', email: 'input[type="email"]', phone: 'input[name*="telephone"],input[type="tel"]' },
  'onlineservices-servicesenligne.cic.gc.ca': { first_name: 'input[id*="givenName"]', last_name: 'input[id*="familyName"]', date_of_birth: 'input[id*="dob"]', passport_number: 'input[id*="passport"]', email: 'input[type="email"]' },
  'online.immi.gov.au': { first_name: 'input[id*="GivenNames"]', last_name: 'input[id*="FamilyName"]', date_of_birth: 'input[id*="DateOfBirth"]', passport_number: 'input[id*="PassportNumber"]', email: 'input[type="email"]' },
  'videx.diplo.de': { first_name: 'input[name*="vorname"],input[id*="firstName"]', last_name: 'input[name*="nachname"],input[id*="lastName"]', date_of_birth: 'input[name*="geburtsdatum"],input[id*="birth"]', passport_number: 'input[name*="pass"]' },
  'ceac.state.gov': { first_name: 'input[id*="GivenName"]', last_name: 'input[id*="Surname"]', date_of_birth: 'select[id*="DOBDay"]', passport_number: 'input[id*="PPT_NUM"]' },
  'www.ucas.com': { first_name: 'input[id*="firstName"]', last_name: 'input[id*="lastName"]', email: 'input[type="email"]', date_of_birth: 'input[id*="dateOfBirth"]' },
  'apply.commonapp.org': { first_name: 'input[id*="firstName"]', last_name: 'input[id*="lastName"]', email: 'input[type="email"]' }
};
function forUrl(url) { try { const h = new URL(String(url)).hostname.toLowerCase(); return MAPS[h] || null; } catch (e) { return null; } }
module.exports = { MAPS, forUrl };
