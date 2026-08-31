-- ForiForeign — 0030: the live plan ladder.
--
-- WHY THIS EXISTS. The active pricing row still held the original ladder seeded by 0010
-- (1 case / Rs 2,000, 5 / Rs 8,500, 10 / Rs 17,500) with no plan name, no matches-shown
-- count and no promo price. Because /api/pricing lets the stored packs win over the
-- default tier config, a fresh deploy kept showing that old ladder on the buy page no
-- matter what the code said, and the new Basic / Smart / Premium plans never appeared.
--
-- The ladder below is the one the product actually sells:
--   Basic    2 cases, 5 matches to choose from   Rs  5,000
--   Smart    5 cases, 8 matches to choose from   Rs 15,000  (promo Rs 9,500, featured)
--   Premium 10 cases, 20 matches to choose from  Rs 30,000  (promo Rs 15,000)
--
-- Idempotent: it only writes when the active row is not already this ladder, so running
-- the bundle twice changes nothing. Prices remain fully editable in the admin panel
-- afterwards; this only fixes the starting point.

update public.pricing set active = false
where active = true
  and not (packs @> '[{"credits":2,"pkr":5000}]'::jsonb);

insert into public.pricing (version, active, packs, refund_policy)
select
  (coalesce((select max(version::int) from public.pricing where version ~ '^[0-9]+$'), 0) + 1)::text,
  true,
  '[
    {"credits":2,"view":5,"pkr":5000,"promo_pkr":null,"name":"Basic","featured":false,"visible":true,
     "description":"Five carefully matched opportunities. Choose any two and we prepare both applications completely."},
    {"credits":5,"view":8,"pkr":15000,"promo_pkr":9500,"name":"Smart","featured":true,"visible":true,
     "description":"Eight matched opportunities. Choose any five and we prepare every application for you."},
    {"credits":10,"view":20,"pkr":30000,"promo_pkr":15000,"name":"Premium","featured":false,"visible":true,
     "description":"Twenty high-relevance opportunities with complete applications for any ten, plus six months of re-searching."}
  ]'::jsonb,
  'Unused case credits are refundable within 14 days. Credits already spent on delivered work are not refundable, because the work has been done and you keep every document.'
where not exists (
  select 1 from public.pricing
  where active = true
    and packs @> '[{"credits":2,"pkr":5000}]'::jsonb
);
