-- ForiForeign — 0017: seed the full destination-country list (54). Idempotent: existing rows untouched.
alter table if exists public.countries add column if not exists enabled boolean default true;
insert into public.countries (code, name, enabled) values
('AU','Australia',true),('AT','Austria',true),('AZ','Azerbaijan',true),('BH','Bahrain',true),
('BE','Belgium',true),('BN','Brunei',true),('BG','Bulgaria',true),('CA','Canada',true),
('CN','China',true),('HR','Croatia',true),('CY','Cyprus',true),('CZ','Czechia',true),
('DK','Denmark',true),('EE','Estonia',true),('FI','Finland',true),('FR','France',true),
('GE','Georgia',true),('DE','Germany',true),('GR','Greece',true),('HK','Hong Kong',true),
('HU','Hungary',true),('IE','Ireland',true),('IT','Italy',true),('JP','Japan',true),
('KZ','Kazakhstan',true),('KW','Kuwait',true),('LV','Latvia',true),('LT','Lithuania',true),
('LU','Luxembourg',true),('MY','Malaysia',true),('MT','Malta',true),('NL','Netherlands',true),
('NZ','New Zealand',true),('NO','Norway',true),('OM','Oman',true),('PL','Poland',true),
('PT','Portugal',true),('QA','Qatar',true),('RO','Romania',true),('SA','Saudi Arabia',true),
('SG','Singapore',true),('SK','Slovakia',true),('SI','Slovenia',true),('KR','South Korea',true),
('ES','Spain',true),('SE','Sweden',true),('CH','Switzerland',true),('TW','Taiwan',true),
('TH','Thailand',true),('TR','Turkiye',true),('AE','United Arab Emirates',true),
('GB','United Kingdom',true),('US','United States',true),('UZ','Uzbekistan',true)
on conflict (code) do nothing;
update public.countries set enabled = true where enabled is null;
