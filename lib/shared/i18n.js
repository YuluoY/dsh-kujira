/** Source-message catalog. Values/IDs and user data stay untouched; translate at render boundaries. */
import { messages } from './messages.js';
import i18next from './vendor/i18next.js';
const resources = Object.fromEntries(['zh','en','ko','ru'].map(language => [language,{translation:Object.fromEntries(Object.entries(messages).map(([key,value]) => [key,value[language]]))}]));
const engine = i18next.createInstance();
engine.init({resources,lng:'en',fallbackLng:'en',initAsync:false,showSupportNotice:false,keySeparator:false,nsSeparator:false,interpolation:{prefix:'{',suffix:'}',escapeValue:false}});
export const LOCALES = ['zh-CN', 'en-US', 'ko-KR', 'ru-RU'];
export function resolveLocale(preference = 'system', languages = ['en-US']) {
    if (LOCALES.includes(preference)) return preference;
    for (const language of languages) {
        try {
            const canonical = Intl.getCanonicalLocales(language)[0];
            if (/^(zh|en|ko|ru)(-|$)/.test(canonical)) return LOCALES.find(value=>value.startsWith(canonical.split('-')[0]+'-'));
        } catch { /* Ignore invalid browser language entries. */ }
    }
    return 'en-US';
}
let locale = 'en-US';
export const getLocale = () => locale;
export function configure(preference, languages = globalThis.navigator?.languages || ['en-US']) {
    locale = resolveLocale(preference, languages);
    return locale;
}
export function serviceRegion(preference = 'auto', timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
    if (preference === 'cn' || preference === 'global') return preference;
    return ['Asia/Shanghai','Asia/Urumqi','PRC'].includes(timeZone) ? 'cn' : 'global';
}
export function translate(source, params = {}, target = locale) {
    if (typeof source !== 'string') return source;
    return engine.t(source, {...params,lng:target.split('-')[0],defaultValue:source});
}
export const t = translate;
export function number(value, options = {}, target = locale) {
    return new Intl.NumberFormat(target, options).format(value);
}
export function money(value, currency = 'CNY', target = locale) {
    return number(value, {style:'currency', currency, currencyDisplay:'narrowSymbol', minimumFractionDigits:2, maximumFractionDigits:6}, target);
}
export function date(value, options = {year:'numeric',month:'short',day:'numeric'}, target = locale) {
    const parsed = new Date(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T12:00:00' : value);
    return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat(target, options).format(parsed);
}
export const time = (value, options = {hour:'numeric',minute:'2-digit'}) => date(value, options);
export function temperature(value, target = locale) {
    if (value == null) return '—';
    const fahrenheit = new Intl.Locale(target).maximize().region === 'US';
    return number(fahrenheit ? value * 9 / 5 + 32 : value, {maximumFractionDigits:1}, target) + (fahrenheit ? ' °F' : ' °C');
}
export function officialPricingUrl(target = locale) {
    return 'https://api-docs.deepseek.com/' + (target.startsWith('zh') ? 'zh-cn/' : '') + 'quick_start/pricing';
}
/** React elements are translated when created, never by mutating the DOM after rendering. */
export function element(React, type, props, ...children) {
    const text = value => Array.isArray(value) ? value.map(text) : typeof value === 'string' ? t(value) : typeof value === 'number' ? number(value) : value;
    let next = props;
    if (props && typeof type === 'string') {
        next = {...props};
        for (const key of ['aria-label','aria-valuetext','data-tooltip','title','placeholder','alt']) {
            if (typeof next[key] === 'string') next[key] = t(next[key]);
        }
    }
    return React.createElement(type, next, ...children.map(text));
}

export function parseNumber(value, target = locale) {
    const parts = new Intl.NumberFormat(target).formatToParts(1234.5);
    const group = parts.find(p=>p.type==='group')?.value;
    const decimal = parts.find(p=>p.type==='decimal')?.value || '.';
    let raw = String(value).trim();
    if (!raw) return NaN;
    if (group) raw = raw.split(group).join('');
    raw = raw.replace(/[\s\u00a0\u202f]/g,'').replace(decimal,'.');
    return /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw) ? Number(raw) : NaN;
}

export function wind(now) {
    const compass = ['北风','东北风','东风','东南风','南风','西南风','西风','西北风'];
    const aliases = ['N','NE','E','SE','S','SW','W','NW'];
    const direction = typeof now.windDirection === 'number' ? compass[Math.round(now.windDirection/45)%8] : compass[aliases.indexOf(now.windDirection)] || now.windDirection;
    const parts = direction ? [t(direction)] : [];
    if (now.wind != null) {
        const us = new Intl.Locale(locale).maximize().region === 'US';
        parts.push(number(us ? now.wind / 1.609344 : now.wind, {maximumFractionDigits:1}) + (us?' mph':' km/h'));
    } else if (now.windPower) {
        const level = String(now.windPower).match(/(?:Level\s*)?(\d+(?:[-–]\d+)?)(?:级)?/i)?.[1];
        if (level) parts.push(t('{value}级', {value:level}));
    }
    return parts.join(' · ') || '—';
}

export function country(target = locale) {
    const code = target.split('-')[0];
    return {zh:{region:'cn'},en:{region:'global'},ko:{region:'global'},ru:{region:'global'}}[code] || {region:'global'};
}
