// ─── Emoji → line icons ────────────────────────────────────────────
// Saved data and presets still carry emoji (habits, trips, weather...).
// Screens draw them through <Emoji>, which looks them up here, so the app
// shows one consistent icon set (Lucide, rounded 24px, like Icons.tsx)
// instead of mixed emoji. Each icon also gets a tint by meaning.
import {
  Sparkles, Sparkle, Check, Plane, Heart, Sun, User, Cake, CloudRain, Wallet, Bell, Mail, Luggage,
  CloudSun, CloudSunRain, CloudLightning, Leaf, Lightbulb, Lock, Calendar, RefreshCw, Baby, Cloud,
  CloudFog, Snowflake, Sunrise, Dumbbell, Bird, Flower2, Flower, Sprout, ShoppingCart, School,
  ShoppingBasket, Moon, Zap, Camera, PenLine, X, CloudSnow, Thermometer, Anchor, TreeDeciduous,
  Mountain, Wind, Waves, Bath, Flame, Star, Target, Music, Ruler, Footprints, Wheat, Recycle, Bot,
  MapPin, Landmark, Trash2, Cookie, Send, Inbox, TriangleAlert, Brain, Users, Palette, Timer, Salad,
  Beef, Soup, Milk, Package, Gift, Link, Briefcase, PartyPopper, PersonStanding, Plug, RotateCcw,
  Scale, House, Link2, Frown, Meh, Smile, Droplet, BookOpen, Pill, Pencil, Carrot, Shirt, Coffee,
  Info, Utensils, Ticket, CircleDot, Map, Tent, Ship, TrainFront, Bus, Backpack, Smartphone, Key, Umbrella, Gem,
  type LucideIcon,
} from "lucide-react";

export type IconTone = "cleo" | "household" | "personal" | "plan" | "neutral";

const E: Record<string, [LucideIcon, IconTone]> = {
  "✦": [Sparkle, "cleo"], "✨": [Sparkles, "cleo"], "🌟": [Star, "cleo"], "⭐": [Star, "cleo"], "🤖": [Bot, "cleo"], "🧠": [Brain, "cleo"],
  "✓": [Check, "household"], "✕": [X, "neutral"], "↻": [RefreshCw, "neutral"], "🔄": [RefreshCw, "neutral"], "↺": [RotateCcw, "neutral"],
  "✎": [Pencil, "neutral"], "✍": [PenLine, "neutral"], "⌂": [House, "household"], "◉": [CircleDot, "plan"], "⚯": [Link2, "neutral"], "🔗": [Link, "neutral"],
  "〰": [Waves, "personal"], "ℹ": [Info, "neutral"],
  // Weather
  "☀": [Sun, "plan"], "🌤": [CloudSun, "plan"], "⛅": [CloudSun, "plan"], "🌦": [CloudSunRain, "plan"], "🌧": [CloudRain, "plan"],
  "⛈": [CloudLightning, "plan"], "☁": [Cloud, "plan"], "🌫": [CloudFog, "plan"], "❄": [Snowflake, "plan"], "🌨": [CloudSnow, "plan"],
  "🌡": [Thermometer, "plan"], "🌅": [Sunrise, "plan"], "🌙": [Moon, "plan"], "⚡": [Zap, "plan"], "🌊": [Waves, "plan"], "☂": [Umbrella, "plan"],
  // Travel and places
  "✈": [Plane, "cleo"], "🧳": [Luggage, "cleo"], "📍": [MapPin, "cleo"], "⚓": [Anchor, "cleo"], "🏔": [Mountain, "cleo"], "🌳": [TreeDeciduous, "cleo"],
  "🗺": [Map, "cleo"], "⛺": [Tent, "cleo"], "🚢": [Ship, "cleo"], "🚆": [TrainFront, "cleo"], "🚌": [Bus, "cleo"], "🎒": [Backpack, "cleo"], "🎟": [Ticket, "cleo"],
  // People, family, feelings
  "💛": [Heart, "personal"], "🧡": [Heart, "personal"], "♡": [Heart, "personal"], "♥": [Heart, "personal"], "💌": [Mail, "personal"],
  "👩": [User, "personal"], "👧": [User, "personal"], "🧒": [Baby, "personal"], "👶": [Baby, "personal"], "👫": [Users, "personal"],
  "🎂": [Cake, "personal"], "🎁": [Gift, "personal"], "🎈": [PartyPopper, "personal"], "😔": [Frown, "personal"], "😐": [Meh, "personal"], "😊": [Smile, "personal"],
  // Wellbeing
  "💪": [Dumbbell, "personal"], "🏃": [Footprints, "personal"], "🧘": [PersonStanding, "personal"], "🫁": [Wind, "personal"], "🛁": [Bath, "personal"],
  "🕯": [Flame, "personal"], "💧": [Droplet, "personal"], "📖": [BookOpen, "personal"], "💊": [Pill, "personal"], "🌿": [Leaf, "personal"],
  "🌸": [Flower2, "personal"], "🌻": [Flower, "personal"], "🦋": [Flower2, "personal"], "🌱": [Sprout, "personal"], "🕊": [Bird, "personal"],
  "🩰": [Footprints, "personal"], "🎵": [Music, "personal"], "🎨": [Palette, "personal"], "🎯": [Target, "personal"], "☕": [Coffee, "personal"],
  "👗": [Shirt, "personal"], "👕": [Shirt, "personal"], "💎": [Gem, "personal"], "📐": [Ruler, "personal"], "🌾": [Wheat, "personal"],
  // Household, money, food
  "💰": [Wallet, "household"], "🏦": [Landmark, "household"], "💡": [Lightbulb, "household"], "🛒": [ShoppingCart, "household"], "🧺": [ShoppingBasket, "household"],
  "🥦": [Salad, "household"], "🥩": [Beef, "household"], "🥫": [Soup, "household"], "🥛": [Milk, "household"], "🧊": [Snowflake, "household"],
  "🍪": [Cookie, "household"], "🥕": [Carrot, "household"], "🍽": [Utensils, "household"], "📦": [Package, "household"], "♻": [Recycle, "household"],
  "🗑": [Trash2, "household"], "⚖": [Scale, "household"], "🔌": [Plug, "household"], "🏠": [House, "household"], "🔑": [Key, "household"],
  // Plan, school, messages
  "📅": [Calendar, "plan"], "🏫": [School, "plan"], "⏱": [Timer, "plan"], "💼": [Briefcase, "plan"], "🔔": [Bell, "plan"], "✉": [Mail, "plan"],
  "📨": [Send, "plan"], "📥": [Inbox, "plan"], "📸": [Camera, "plan"], "📱": [Smartphone, "plan"], "🔒": [Lock, "neutral"], "⚠": [TriangleAlert, "neutral"],
};

export function iconForEmoji(e: string | undefined | null): [LucideIcon, IconTone] | null {
  if (!e) return null;
  const key = e.replace(/️|‍♀|‍♂/g, "").trim();
  return E[key] ?? E[[...key][0] ?? ""] ?? null;
}
