/** Normalize the free UApiPro basic weather response; missing measurements stay missing. */
export const WEATHER_ENDPOINT = 'https://uapis.cn/api/v1/misc/weather';
const numeric = v => v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null;
export function weatherShape(text) {
    if (/雷|thunder|storm/i.test(text)) return 'storm';
    if (/雪|snow|sleet/i.test(text)) return 'snow';
    if (/雨|rain|drizzle|shower/i.test(text)) return 'rain';
    if (/雾|霾|沙|fog|mist|haze|dust/i.test(text)) return 'fog';
    if (/多云|partly|few clouds/i.test(text)) return 'partly';
    if (/晴|clear|sunny/i.test(text)) return 'clear';
    return 'cloudy';
}
export function normalizeWeather(raw, { automatic = false, locationSource = 'manual', now = Date.now() } = {}) {
    if (!raw || typeof raw.city !== 'string' || !raw.city.trim() || typeof raw.weather !== 'string' || numeric(raw.temperature) === null) {
        throw new Error('天气服务暂未返回有效的城市与实况');
    }
    return {
        ok: true, city: raw.city, region: raw.province || '',
        displayLocation: /^[A-Z]{2}-\d+$/.test(raw.city) ? raw.province || raw.city : raw.city,
        automatic, locationSource, source: 'UApiPro', sourceUrl: 'https://uapis.cn/docs/api-reference/get-misc-weather',
        now: { text: canonicalWeather(raw.weather), shape: weatherShape(raw.weather), temp: numeric(raw.temperature),
            feelsLike: numeric(raw.feels_like), humidity: numeric(raw.humidity), wind: numeric(raw.wind_speed),
            windDirection: raw.wind_direction || null, windPower: raw.wind_power || null,
            windText: [raw.wind_direction,raw.wind_power].filter(v => typeof v === 'string').join(' · ') },
        tomorrow: null, fetchedAt: now, reportedAt: typeof raw.report_time === 'string' ? raw.report_time : null,
        // Never request paid forecast/extended modules by default.
        alerts: Array.isArray(raw.alerts) ? raw.alerts.slice(0,3).map(a => ({ title: String(a.title || '').slice(0,120), text: String(a.text || '').slice(0,500) })) : []
    };
}

function canonicalWeather(text) {
    const terms = {'clear':'晴','sunny':'晴','mostly clear':'大致晴朗','partly cloudy':'局部多云','cloudy':'多云','overcast':'阴','fog':'雾','mist':'雾','light rain':'小雨','moderate rain':'中雨','heavy rain':'大雨','light snow':'小雪','snow':'中雪','heavy snow':'大雪','thunderstorm':'雷阵雨','light drizzle':'小毛毛雨','drizzle':'毛毛雨','showers':'阵雨'};
    const known = terms[text.trim().toLowerCase()];
    if (known) return known;
    if (/^[晴阴雨雪雾多云小中大阵雷冻毛粒强暴凇局部致朗伴冰雹]+$/.test(text)) return text;
    return {clear:'晴',partly:'局部多云',cloudy:'阴',fog:'雾',rain:'中雨',snow:'中雪',storm:'雷阵雨'}[weatherShape(text)] || '未知天气';
}
