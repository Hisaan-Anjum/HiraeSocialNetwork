// ru-pay.js — is this visitor in Russia? Paddle refuses Russia, so these people get the ruble checkout instead. The time
// zone counts as well as the country, because a VPN hides the country (founder 11-05).
window.heraeInRussia = async () => {
  // ?ru=1 is the "Pay with a Russian card" link: a VPN plus a non-Russian clock would otherwise hide the ruble page.
  if (new URLSearchParams(location.search).get('ru') === '1') return true;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  if (/^(Europe\/(Moscow|Samara|Volgograd|Kaliningrad|Kirov|Saratov|Ulyanovsk|Astrakhan)|Asia\/(Yekaterinburg|Omsk|Novosibirsk|Krasnoyarsk|Irkutsk|Vladivostok|Yakutsk|Magadan|Kamchatka|Barnaul|Tomsk|Novokuznetsk|Chita|Sakhalin))$/.test(tz)) return true;
  const fx = await fetch('/api/fx').then((r) => r.json()).catch(() => ({}));
  return fx.country === 'RU';
};
