// lib/i18n.js — Day 8 · languages and origin markets.
// The interface's core surfaces (navigation, journey, money, actions) are translated into the
// languages of the origin markets ForiForeign serves; documents remain in the language the
// destination requires. Origin markets carry their currency, phone prefix and payment rails.
const LANGS = { en: { name: 'English', dir: 'ltr' }, ur: { name: 'اردو', dir: 'rtl' }, hi: { name: 'हिन्दी', dir: 'ltr' }, bn: { name: 'বাংলা', dir: 'ltr' }, ar: { name: 'العربية', dir: 'rtl' } };
const ORIGINS = {
  PK: { name: 'Pakistan', currency: 'PKR', phone: '92', langs: ['en', 'ur'], bank_transfer: true, id_label: 'CNIC' },
  IN: { name: 'India', currency: 'INR', phone: '91', langs: ['en', 'hi'], bank_transfer: false, id_label: 'Aadhaar / PAN' },
  BD: { name: 'Bangladesh', currency: 'BDT', phone: '880', langs: ['en', 'bn'], bank_transfer: false, id_label: 'NID' },
  AE: { name: 'United Arab Emirates', currency: 'AED', phone: '971', langs: ['en', 'ar', 'ur', 'hi'], bank_transfer: false, id_label: 'Emirates ID' },
  SA: { name: 'Saudi Arabia', currency: 'SAR', phone: '966', langs: ['en', 'ar', 'ur'], bank_transfer: false, id_label: 'Iqama' },
  QA: { name: 'Qatar', currency: 'QAR', phone: '974', langs: ['en', 'ar'], bank_transfer: false, id_label: 'QID' },
  OM: { name: 'Oman', currency: 'OMR', phone: '968', langs: ['en', 'ar'], bank_transfer: false, id_label: 'Resident card' },
  KW: { name: 'Kuwait', currency: 'KWD', phone: '965', langs: ['en', 'ar'], bank_transfer: false, id_label: 'Civil ID' },
  BH: { name: 'Bahrain', currency: 'BHD', phone: '973', langs: ['en', 'ar'], bank_transfer: false, id_label: 'CPR' },
  NP: { name: 'Nepal', currency: 'NPR', phone: '977', langs: ['en', 'hi'], bank_transfer: false, id_label: 'Citizenship no.' },
  LK: { name: 'Sri Lanka', currency: 'LKR', phone: '94', langs: ['en'], bank_transfer: false, id_label: 'NIC' },
  NG: { name: 'Nigeria', currency: 'NGN', phone: '234', langs: ['en'], bank_transfer: false, id_label: 'NIN' },
  EG: { name: 'Egypt', currency: 'EGP', phone: '20', langs: ['en', 'ar'], bank_transfer: false, id_label: 'National ID' },
  OTHER: { name: 'Other', currency: 'USD', phone: '', langs: ['en'], bank_transfer: false, id_label: 'National ID' }
};
const T = {
  nav_dashboard: { en: 'Dashboard', ur: 'ڈیش بورڈ', hi: 'डैशबोर्ड', bn: 'ড্যাশবোর্ড', ar: 'لوحة التحكم' },
  nav_profile: { en: 'Profile', ur: 'پروفائل', hi: 'प्रोफ़ाइल', bn: 'প্রোফাইল', ar: 'الملف الشخصي' },
  nav_workspace: { en: 'Workspace', ur: 'ورک اسپیس', hi: 'वर्कस्पेस', bn: 'ওয়ার্কস্পেস', ar: 'مساحة العمل' },
  nav_admin: { en: 'Admin', ur: 'ایڈمن', hi: 'एडमिन', bn: 'অ্যাডমিন', ar: 'الإدارة' },
  sign_out: { en: 'Sign out', ur: 'سائن آؤٹ', hi: 'साइन आउट', bn: 'সাইন আউট', ar: 'تسجيل الخروج' },
  credits: { en: 'credits', ur: 'کریڈٹس', hi: 'क्रेडिट', bn: 'ক্রেডিট', ar: 'رصيد' },
  your_steps: { en: 'Your steps', ur: 'آپ کے مراحل', hi: 'आपके चरण', bn: 'আপনার ধাপ', ar: 'خطواتك' },
  upload_cv: { en: 'Upload CV', ur: 'سی وی اپ لوڈ کریں', hi: 'CV अपलोड करें', bn: 'সিভি আপলোড করুন', ar: 'رفع السيرة الذاتية' },
  search: { en: 'Search', ur: 'تلاش', hi: 'खोजें', bn: 'অনুসন্ধান', ar: 'بحث' },
  we_prepare: { en: 'We prepare your case', ur: 'ہم آپ کا کیس تیار کرتے ہیں', hi: 'हम आपका केस तैयार करते हैं', bn: 'আমরা আপনার কেস প্রস্তুত করি', ar: 'نحن نجهز ملفك' },
  approve_apply: { en: 'Approve & Apply', ur: 'منظور کریں اور اپلائی کریں', hi: 'स्वीकृत करें और आवेदन करें', bn: 'অনুমোদন করুন ও আবেদন করুন', ar: 'وافق وقدّم' },
  choose_package: { en: 'Choose your package', ur: 'اپنا پیکیج منتخب کریں', hi: 'अपना पैकेज चुनें', bn: 'আপনার প্যাকেজ বেছে নিন', ar: 'اختر باقتك' },
  pay_by_card: { en: 'Pay by card', ur: 'کارڈ سے ادائیگی', hi: 'कार्ड से भुगतान', bn: 'কার্ডে পেমেন্ট', ar: 'الدفع بالبطاقة' },
  one_time: { en: 'one-time', ur: 'ایک بار', hi: 'एक बार', bn: 'এককালীন', ar: 'مرة واحدة' },
  documents: { en: 'Document vault', ur: 'دستاویزات', hi: 'दस्तावेज़', bn: 'নথিপত্র', ar: 'المستندات' },
  visa_readiness: { en: 'Visa readiness', ur: 'ویزا کی تیاری', hi: 'वीज़ा तैयारी', bn: 'ভিসা প্রস্তুতি', ar: 'جاهزية التأشيرة' },
  after_visa: { en: 'After the visa', ur: 'ویزا کے بعد', hi: 'वीज़ा के बाद', bn: 'ভিসার পরে', ar: 'بعد التأشيرة' },
  offers: { en: 'My offers & interviews', ur: 'میری آفرز اور انٹرویوز', hi: 'मेरे ऑफ़र और इंटरव्यू', bn: 'আমার অফার ও ইন্টারভিউ', ar: 'عروضي ومقابلاتي' },
  mobility_profile: { en: 'Global Mobility Profile', ur: 'گلوبل موبلیٹی پروفائل', hi: 'ग्लोबल मोबिलिटी प्रोफ़ाइल', bn: 'গ্লোবাল মোবিলিটি প্রোফাইল', ar: 'ملف التنقل العالمي' },
  ask_us: { en: 'Ask us', ur: 'ہم سے پوچھیں', hi: 'हमसे पूछें', bn: 'আমাদের জিজ্ঞাসা করুন', ar: 'اسألنا' },
  save: { en: 'Save', ur: 'محفوظ کریں', hi: 'सहेजें', bn: 'সংরক্ষণ', ar: 'حفظ' },
  language: { en: 'Language', ur: 'زبان', hi: 'भाषा', bn: 'ভাষা', ar: 'اللغة' },
  origin_country: { en: 'I am applying from', ur: 'میں یہاں سے اپلائی کر رہا ہوں', hi: 'मैं यहाँ से आवेदन कर रहा हूँ', bn: 'আমি এখান থেকে আবেদন করছি', ar: 'أقدّم من' },
  welcome: { en: 'Welcome', ur: 'خوش آمدید', hi: 'स्वागत है', bn: 'স্বাগতম', ar: 'مرحباً' }
};
// Whole world: every ISO country is an origin. Curated entries above keep their language and bank-transfer details;
// every other country gets currency and phone prefix from lib/world.js.
try { const W = require('./world').W; for (const [cc, v] of Object.entries(W)) if (!ORIGINS[cc]) ORIGINS[cc] = { name: v[0], currency: v[1], phone: v[2], langs: ['en'], bank_transfer: false, id_label: 'National ID' }; } catch (e) {}
function t(key, lang) { const r = T[key]; if (!r) return key; return r[lang] || r.en || key; }
module.exports = { LANGS, ORIGINS, T, t };
