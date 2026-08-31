// lib/referral.js — Referral rewards engine.
// RULE: every N qualified referrals earns one free case credit. Credits accumulate,
// each carries its OWN expiry, and the earliest-expiring credit is spent first.
// Everything here is idempotent: the same qualification event can arrive twice and
// still produce exactly one reward, enforced by a unique index in the database.

const { admin } = require('./supa');

const DEFAULTS = { per_milestone: 5, credits_per_milestone: 1, expiry_months: 6, qualify_on: 'cv_uploaded' };

async function settings() {
  try {
    const cfg = await require('./settings').getConfig();
    return Object.assign({}, DEFAULTS, (cfg && cfg.referral) || {});
  } catch (e) { return DEFAULTS; }
}

function addMonths(d, n) {
  const x = new Date(d);
  const day = x.getDate();
  x.setMonth(x.getMonth() + n);
  if (x.getDate() < day) x.setDate(0);   // clamp 31 Aug + 6mo -> 28/29 Feb, never overflow
  return x;
}

/** Has this referred user met the qualification bar? Never a click, never a bare signup. */
async function isQualified(userId, rule) {
  try {
    if (rule === 'signup') return true;
    if (rule === 'first_purchase') {
      const { data } = await admin().from('payments').select('id').eq('user_id', userId).eq('status', 'confirmed').limit(1);
      return !!(data && data.length);
    }
    // default: the referred person actually used the product (uploaded a document)
    const { data } = await admin().from('documents').select('id').eq('user_id', userId).limit(1);
    return !!(data && data.length);
  } catch (e) { return false; }
}

/**
 * Recount a referrer's qualified referrals and award any milestones they have reached.
 * Safe to call repeatedly: the unique (user_id, milestone) index guarantees one credit.
 */
async function syncRewards(referrerId) {
  const cfg = await settings();
  const out = { qualified: 0, pending: 0, awarded: 0, milestone: 0 };
  if (!referrerId) return out;

  const { data: referred } = await admin().from('profiles')
    .select('id, referral_status, referral_qualified_at').eq('referred_by', referrerId);
  const list = referred || [];

  for (const r of list) {
    if (r.id === referrerId) continue;                       // self-referral never counts
    if (r.referral_status === 'qualified') { out.qualified++; continue; }
    if (r.referral_status === 'rejected') continue;
    if (await isQualified(r.id, cfg.qualify_on)) {
      try {
        await admin().from('profiles')
          .update({ referral_status: 'qualified', referral_qualified_at: new Date().toISOString() })
          .eq('id', r.id);
      } catch (e) {}
      out.qualified++;
    } else out.pending++;
  }

  // Award every milestone reached that has not been awarded yet.
  const reached = Math.floor(out.qualified / cfg.per_milestone);
  for (let i = 1; i <= reached; i++) {
    const milestone = i * cfg.per_milestone;
    const earned = new Date();
    try {
      const { error } = await admin().from('referral_credits').insert({
        user_id: referrerId, source: 'referral_milestone', milestone,
        credits: cfg.credits_per_milestone,
        earned_at: earned.toISOString(),
        expires_at: addMonths(earned, cfg.expiry_months).toISOString(),
        status: 'active'
      });
      if (!error) {
        out.awarded++;
        try {
          await admin().from('support_tickets').insert({
            user_id: referrerId, subject: 'You earned a free case credit',
            message: 'Referral milestone reached: ' + milestone + ' qualified referrals.',
            reply: 'Congratulations. You have earned ' + cfg.credits_per_milestone +
              ' free case credit. It is valid until ' +
              addMonths(earned, cfg.expiry_months).toISOString().slice(0, 10) +
              '. Open Rewards on your dashboard to use it.',
            status: 'answered'
          });
        } catch (e) {}
      }
      // A duplicate-key error means this milestone was already awarded: correct, ignore.
    } catch (e) {}
  }
  out.milestone = cfg.per_milestone;
  return out;
}

/** Expire anything past its date, then return the live wallet. */
async function wallet(userId) {
  try {
    await admin().from('referral_credits')
      .update({ status: 'expired' })
      .eq('user_id', userId).eq('status', 'active').lt('expires_at', new Date().toISOString());
  } catch (e) {}
  const { data } = await admin().from('referral_credits')
    .select('*').eq('user_id', userId).order('expires_at', { ascending: true });
  const all = data || [];
  return {
    active: all.filter(c => c.status === 'active'),
    used: all.filter(c => c.status === 'used').length,
    expired: all.filter(c => c.status === 'expired').length,
    all
  };
}

/** Spend one credit, earliest expiry first. Returns the credit used, or null. */
async function redeem(userId, ref) {
  const w = await wallet(userId);
  const credit = w.active[0];                       // already sorted by expires_at
  if (!credit) return null;
  // Conditional update: only succeeds if the row is still active, which prevents a
  // double-spend from two simultaneous requests.
  const { data, error } = await admin().from('referral_credits')
    .update({ status: 'used', used_at: new Date().toISOString(), used_ref: ref || null })
    .eq('id', credit.id).eq('status', 'active').select();
  if (error || !data || !data.length) return null;
  return data[0];
}

module.exports = { syncRewards, wallet, redeem, settings, addMonths, isQualified, DEFAULTS };
