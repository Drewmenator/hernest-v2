// ─── HerNest Weather Service — Open-Meteo (free, no API key) ─────

export interface WeatherData {
  temp: number;
  feelsLike: number;
  condition: string;
  icon: string;
  humidity: number;
  windSpeed: number;
  city?: string;
  unit: "F" | "C";
}

const WMO_CODES: Record<number, { condition: string; icon: string }> = {
  0:  { condition: "Clear sky",        icon: "☀️" },
  1:  { condition: "Mainly clear",     icon: "🌤" },
  2:  { condition: "Partly cloudy",    icon: "⛅️" },
  3:  { condition: "Overcast",         icon: "☁️" },
  45: { condition: "Foggy",            icon: "🌫" },
  48: { condition: "Icy fog",          icon: "🌫" },
  51: { condition: "Light drizzle",    icon: "🌦" },
  53: { condition: "Drizzle",          icon: "🌦" },
  55: { condition: "Heavy drizzle",    icon: "🌧" },
  61: { condition: "Light rain",       icon: "🌧" },
  63: { condition: "Rain",             icon: "🌧" },
  65: { condition: "Heavy rain",       icon: "🌧" },
  71: { condition: "Light snow",       icon: "🌨" },
  73: { condition: "Snow",             icon: "❄️" },
  75: { condition: "Heavy snow",       icon: "❄️" },
  80: { condition: "Rain showers",     icon: "🌦" },
  81: { condition: "Rain showers",     icon: "🌧" },
  82: { condition: "Violent showers",  icon: "⛈" },
  95: { condition: "Thunderstorm",     icon: "⛈" },
  99: { condition: "Thunderstorm",     icon: "⛈" },
};

export async function getWeather(lat: number, lon: number, useFahrenheit = true): Promise<WeatherData | null> {
  try {
    const unit = useFahrenheit ? "fahrenheit" : "celsius";
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m&temperature_unit=${unit}&wind_speed_unit=mph&timezone=auto`
    );
    const data = await res.json();
    const c = data.current;
    const wmo = WMO_CODES[c.weather_code] || { condition: "Unknown", icon: "🌡" };
    return {
      temp: Math.round(c.temperature_2m),
      feelsLike: Math.round(c.apparent_temperature),
      condition: wmo.condition,
      icon: wmo.icon,
      humidity: c.relative_humidity_2m,
      windSpeed: Math.round(c.wind_speed_10m),
      unit: useFahrenheit ? "F" : "C",
    };
  } catch {
    return null;
  }
}

export async function getWeatherByLocation(): Promise<WeatherData | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const w = await getWeather(pos.coords.latitude, pos.coords.longitude);
        resolve(w);
      },
      () => {
        // Fallback to League City, TX if location denied
        getWeather(29.5075, -95.0949).then(resolve).catch(() => resolve(null));
      },
      { timeout: 5000 }
    );
  });
}
