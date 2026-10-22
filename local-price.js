// local-price.js — prices in the visitor's own currency, everywhere a price is shown (founder 2026-10-22: "the pricing
// page should show the price in local currency for everywhere — PKR for Pakistanis instead of USD").
//
// Paddle prices are already localized where Paddle can charge in that currency (its PricePreview returns e.g. INR or
// EUR). Where it can't (PKR, BDT, NGN, EGP, KES … are not Paddle currencies), the card is charged in US dollars, so the
// page shows the local amount — converted at today's rate (/api/fx, cached by the server) — with "billed as US$…"
// beneath it. Honest about what is charged; readable in the money people think in.
(function () {
  'use strict';
  // ISO country → currency (countries that use USD are simply absent).
  const MAP = 'PK:PKR,IN:INR,BD:BDT,LK:LKR,NP:NPR,AF:AFN,AE:AED,SA:SAR,QA:QAR,KW:KWD,BH:BHD,OM:OMR,JO:JOD,LB:LBP,IQ:IQD,IR:IRR,IL:ILS,TR:TRY,'
    + 'EG:EGP,MA:MAD,DZ:DZD,TN:TND,LY:LYD,NG:NGN,GH:GHS,KE:KES,UG:UGX,TZ:TZS,ET:ETB,RW:RWF,ZA:ZAR,ZM:ZMW,ZW:USD,MW:MWK,MZ:MZN,AO:AOA,CM:XAF,'
    + 'SN:XOF,CI:XOF,BJ:XOF,BF:XOF,ML:XOF,NE:XOF,TG:XOF,GA:XAF,CG:XAF,TD:XAF,CF:XAF,GQ:XAF,BW:BWP,NA:NAD,MU:MUR,SD:SDG,'
    + 'CN:CNY,HK:HKD,TW:TWD,JP:JPY,KR:KRW,SG:SGD,MY:MYR,ID:IDR,TH:THB,VN:VND,PH:PHP,MM:MMK,KH:KHR,LA:LAK,MN:MNT,KZ:KZT,UZ:UZS,KG:KGS,TJ:TJS,'
    + 'AZ:AZN,GE:GEL,AM:AMD,RU:RUB,UA:UAH,BY:BYN,MD:MDL,'
    + 'GB:GBP,CH:CHF,NO:NOK,SE:SEK,DK:DKK,IS:ISK,PL:PLN,CZ:CZK,HU:HUF,RO:RON,BG:BGN,RS:RSD,BA:BAM,MK:MKD,AL:ALL,'
    + 'DE:EUR,FR:EUR,IT:EUR,ES:EUR,PT:EUR,NL:EUR,BE:EUR,AT:EUR,IE:EUR,FI:EUR,GR:EUR,SK:EUR,SI:EUR,EE:EUR,LV:EUR,LT:EUR,LU:EUR,MT:EUR,CY:EUR,HR:EUR,'
    + 'CA:CAD,MX:MXN,BR:BRL,AR:ARS,CL:CLP,CO:COP,PE:PEN,UY:UYU,PY:PYG,BO:BOB,VE:VES,CR:CRC,GT:GTQ,HN:HNL,NI:NIO,DO:DOP,JM:JMD,TT:TTD,'
    + 'AU:AUD,NZ:NZD,FJ:FJD,PG:PGK';
  const CUR = Object.fromEntries(MAP.split(',').map((x) => x.split(':')));
  let fx = null;
  const loadFx = () => fx || (fx = fetch('/api/fx').then((r) => (r.ok ? r.json() : null)).catch(() => null));

  // money(12.5, 'PKR') → "Rs 3,480" style, whole units for big-number currencies.
  function money(amount, currency) {
    const whole = amount >= 100;
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency, currencyDisplay: 'narrowSymbol',
        minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(whole ? Math.round(amount / 10) * 10 : amount);
    } catch (e) { return `${currency} ${Math.round(amount)}`; }
  }

  // From a Paddle.PricePreview result → { [priceId]: { text, billed } } in the visitor's currency. `billed` is the USD
  // line ("billed as US$2.99") when the amount shown is a conversion; null when Paddle already charges in that currency.
  async function localize(preview) {
    const out = {};
    const d = preview && preview.data; if (!d) return out;
    for (const li of d.details.lineItems) out[li.price.id] = { text: li.formattedTotals.total, billed: null };
    if (d.currencyCode !== 'USD') return out;   // Paddle already shows (and charges) their currency
    const rates = await loadFx();
    const country = (d.address && d.address.countryCode) || (rates && rates.country) || '';
    const currency = CUR[String(country).toUpperCase()];
    if (!rates || !rates.rates || !currency || currency === 'USD' || !rates.rates[currency]) return out;
    for (const li of d.details.lineItems) {
      const usd = Number(li.totals.total) / 100;
      out[li.price.id] = { text: money(usd * rates.rates[currency], currency), billed: `billed as US${li.formattedTotals.total}` };
    }
    return out;
  }
  window.heraeLocalPrices = localize;
})();
