import { WEATHER_ENDPOINT, normalizeWeather } from '../shared/weather-data.js';
/** Weather services: UApiPro for mainland networks, Open-Meteo for global networks.
 * All requests run on the host. A public-provider fallback preserves the normalized
 * shape; explicit cities override approximate host-IP location. No model API key
 * or precise browser location is sent to either weather provider.
 */

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';

const TIMEOUT_MS = 4500;
const CACHE_MS = 15 * 60 * 1000;   // 天气 15 分钟缓存足够

/**
 * WMO 天气码 → 中文描述 + 图形类别。
 *
 * `shape` 是给浏览器端挑图标用的语义标签，不是图标本身。
 * 这里刻意不返回 emoji —— 天气图标的渲染要跟着 `currentColor` 走
 * （面板的强调色、hover 态都会变），emoji 是固定彩色的，做不到。
 * 至于具体画成什么样，交给前端那套 24×24 的线性图标。
 *
 * 类别只有 8 种：晴 / 少云 / 阴 / 雾 / 细雨 / 雨 / 雪 / 雷。
 * Open-Meteo 的 WMO 码有 28 个，但对用户来说「小雨」和「中雨」
 * 需要的视觉区分度远不如「雨」和「雪」之间大，合并之后一目了然。
 */
const WMO = {
    0: ['晴', 'clear'],
    1: ['大致晴朗', 'partly'],
    2: ['局部多云', 'partly'],
    3: ['阴', 'cloudy'],
    45: ['雾', 'fog'],
    48: ['雾凇', 'fog'],
    51: ['小毛毛雨', 'drizzle'],
    53: ['毛毛雨', 'drizzle'],
    55: ['大毛毛雨', 'rain'],
    56: ['冻毛毛雨', 'drizzle'],
    57: ['强冻毛毛雨', 'rain'],
    61: ['小雨', 'rain'],
    63: ['中雨', 'rain'],
    65: ['大雨', 'rain'],
    66: ['冻雨', 'rain'],
    67: ['强冻雨', 'rain'],
    71: ['小雪', 'snow'],
    73: ['中雪', 'snow'],
    75: ['大雪', 'snow'],
    77: ['雪粒', 'snow'],
    80: ['阵雨', 'drizzle'],
    81: ['强阵雨', 'rain'],
    82: ['暴雨', 'rain'],
    85: ['阵雪', 'snow'],
    86: ['强阵雪', 'snow'],
    95: ['雷阵雨', 'storm'],
    96: ['雷阵雨伴冰雹', 'storm'],
    99: ['强雷阵雨伴冰雹', 'storm']
};

/** 天气码 → { text, shape }。未知码给中性值，不报错。 */
export function describeCode(code)
{
    const hit = WMO[Number(code)];
    if (hit)
    {
        return { text: hit[0], shape: hit[1] };
    }
    return { text: '未知天气', shape: 'cloudy' };
}

/** 造一个不会 reject 的错误结果。 */
function fail(reason, message)
{
    return { ok: false, reason, message };
}

/** 带超时的 JSON 请求。 */
async function getJson(url)
{
    const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok)
    {
        const err = new Error('HTTP ' + res.status);
        err.status = res.status;
        throw err;
    }
    return res.json();
}

/**
 * 查城市 → 经纬度。
 * 返回 { name, admin1, country, latitude, longitude } 或 null。
 */
export async function geocode(city)
{
    if (!city || !String(city).trim())
    {
        return null;
    }
    const url = GEO_URL + '?name=' + encodeURIComponent(String(city).trim()) +
        '&count=1&language=zh&format=json';
    const data = await getJson(url);
    const hit = data && Array.isArray(data.results) ? data.results[0] : null;
    if (!hit)
    {
        return null;
    }
    return {
        name: hit.name || city,
        admin1: hit.admin1 || '',
        country: hit.country || '',
        latitude: hit.latitude,
        longitude: hit.longitude,
        timezone: hit.timezone || 'Asia/Shanghai'
    };
}

/** Regional providers share one normalized shape; caches include region and language. */
export function createWeatherClient(getCity, options = {})
{
    const cache = new Map(), pending = new Map();
    const request = options.fetch || globalThis.fetch;
    const json = async url => {
        const res = await request(url, {headers:{Accept:'application/json'},signal:AbortSignal.timeout(TIMEOUT_MS)});
        if (!res.ok) throw new Error('weather-unavailable');
        return res.json();
    };
    async function international(city, language) {
        let location;
        if (city) {
            const data = await json(GEO_URL + '?name=' + encodeURIComponent(city) + '&count=1&language=' + language + '&format=json');
            location = data.results?.[0];
        } else {
            // Only the server's public IP is inferred. No browser location or API key is sent.
            const data = await json('https://ipwho.is/');
            if (data.success !== false) location = {name:data.city,admin1:data.region,latitude:data.latitude,longitude:data.longitude};
        }
        if (!location || typeof location.name !== 'string' || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) || Math.abs(location.latitude)>90 || Math.abs(location.longitude)>180) throw new Error('location-unavailable');
        const data = await json('https://api.open-meteo.com/v1/forecast?latitude=' + location.latitude + '&longitude=' + location.longitude + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m&timezone=auto&forecast_days=1');
        const now = data.current;
        if (!now || !Number.isFinite(now.temperature_2m)) throw new Error('weather-unavailable');
        const weather = describeCode(now.weather_code);
        return {ok:true,city:location.name,region:location.admin1 || '',automatic:!city,locationSource:city?'manual':'host-ip',
            source:'Open-Meteo',sourceUrl:'https://open-meteo.com/',
            now:{...weather,temp:now.temperature_2m,feelsLike:now.apparent_temperature ?? null,humidity:now.relative_humidity_2m ?? null,wind:now.wind_speed_10m ?? null,windText:'',windDirection:now.wind_direction_10m ?? null},
            tomorrow:null,alerts:[],fetchedAt:Date.now(),reportedAt:now.time || null};
    }
    return async function queryWeather(force, {auto=true, region='cn', locale='zh-CN'} = {}) {
        const city = String(getCity() || '').trim().slice(0,80);
        const language = /^(zh|en|ko|ru)(-|$)/.exec(locale || '')?.[1] || 'en';
        const provider = region === 'global' ? 'global' : 'cn';
        if (!city && !auto) return fail('no-city', '自动定位已关闭，请设置城市。');
        const key = [provider,language,city || '@auto'].join(':');
        const hit = cache.get(key);
        if (!force && hit && Date.now()-hit.fetchedAt<CACHE_MS) return {...hit,cached:true};
        if (pending.has(key)) return pending.get(key);
        const domestic = async () => {
            const url = WEATHER_ENDPOINT + '?lang=' + (language==='zh'?'zh':'en') + (city?'&city='+encodeURIComponent(city):'');
            return normalizeWeather(await json(url), {automatic:!city,locationSource:city?'manual':'host-ip'});
        };
        const providers = provider==='global' ? [()=>international(city,language),domestic] : [domestic,()=>international(city,language)];
        const job = (async () => {
            try {
                for (const [index, load] of providers.entries()) {
                    try {
                        const value = {...await load(),fallback:index>0};
                        cache.delete(key);cache.set(key,value);
                        while(cache.size>32) cache.delete(cache.keys().next().value);
                        return value;
                    } catch { /* Try the other public weather service without forwarding credentials. */ }
                }
                if (hit) return {...hit,stale:true,cached:true,message:'暂未更新，显示上次天气'};
                return fail(city?'weather-unavailable':'location-unavailable',city?'天气服务暂不可用，可稍后刷新。':'暂时无法按网络位置获取天气，可以手动选城市。');
            } finally { pending.delete(key); }
        })();
        pending.set(key,job);
        return job;
    };
}

/**
 * 把天气结果拼成一句适合放气泡的话。
 */
export function weatherSentence(w)
{
    if (!w || !w.ok)
    {
        return w && w.message ? w.message : '查不到天气';
    }
    const parts = [w.city + ' ' + w.now.text];
    if (w.now.temp !== null)
    {
        parts.push(w.now.temp + '°C');
    }
    const t = w.tomorrow;
    if (t && t.high !== null && t.low !== null)
    {
        parts.push('｜明天 ' + t.text + ' ' + t.low + '~' + t.high + '°C');
    }
    return parts.join(' ');
}
