// Today's weather for the outfit. Uses her location if the phone allows it,
// else the city in her profile. Never guesses a city: dressing someone in
// Boston for Texas weather is worse than no weather at all.
import { getWeather, type WeatherData } from "../../core/weather";

const position = () => new Promise<GeolocationPosition | null>(resolve => {
  if (typeof navigator === "undefined" || !navigator.geolocation) { resolve(null); return; }
  navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { timeout: 5000, maximumAge: 30 * 60000 });
});

async function geocode(city: string): Promise<{ lat: number; lon: number } | null> {
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
    const r = (await res.json())?.results?.[0];
    return r ? { lat: r.latitude, lon: r.longitude } : null;
  } catch { return null; }
}

export async function weatherForOutfit(city?: string): Promise<WeatherData | null> {
  const pos = await position();
  if (pos) return getWeather(pos.coords.latitude, pos.coords.longitude);
  const name = (city || "").split(",")[0].trim();
  if (!name) return null;
  const at = await geocode(name);
  return at ? getWeather(at.lat, at.lon) : null;
}
