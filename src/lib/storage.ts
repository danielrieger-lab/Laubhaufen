import type { AppState, DayKey, MealSlot, PantryItem, Recipe, ShoppingItem, WeeklyMeal } from './types';

const STORAGE_KEY = 'laubhaufen:state';

export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2, 11);
}

export function getMondayForDate(date: Date): string {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = copy.getDate() - day + (day === 0 ? -6 : 1);
  copy.setDate(diff);
  copy.setHours(0, 0, 0, 0);
  return copy.toISOString().slice(0, 10);
}

export function dayLabel(day: DayKey): string {
  const labels: Record<DayKey, string> = {
    monday: 'Montag',
    tuesday: 'Dienstag',
    wednesday: 'Mittwoch',
    thursday: 'Donnerstag',
    friday: 'Freitag',
    saturday: 'Samstag',
    sunday: 'Sonntag'
  };

  return labels[day];
}

export function slotLabel(slot: MealSlot): string {
  const labels: Record<MealSlot, string> = {
    breakfast: 'Frühstück',
    lunch: 'Mittagessen',
    dinner: 'Abendessen'
  };

  return labels[slot];
}

export function parseLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseTags(value: string): string[] {
  const seen = new Set<string>();

  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => {
      const key = tag.toLocaleLowerCase('de-DE');
      if (!tag || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

export function joinLines(value: string[] | undefined): string {
  return (value ?? []).join('\n');
}

export function createRecipe(input: Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'>): Recipe {
  const now = Date.now();

  return {
    ...input,
    id: createId(),
    createdAt: now,
    updatedAt: now
  };
}

export function createWeeklyMeal(input: Omit<WeeklyMeal, 'id' | 'createdAt' | 'updatedAt'>): WeeklyMeal {
  const now = Date.now();

  return {
    ...input,
    id: createId(),
    createdAt: now,
    updatedAt: now
  };
}

export function createShoppingItem(input: Omit<ShoppingItem, 'id' | 'checked' | 'createdAt' | 'updatedAt'>): ShoppingItem {
  const now = Date.now();

  return {
    ...input,
    id: createId(),
    checked: false,
    createdAt: now,
    updatedAt: now
  };
}

export function nextCheckState(current: boolean): boolean {
  return !current;
}

export function loadAppState(): AppState | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AppState>;

    if (!Array.isArray(parsed.recipes) || !Array.isArray(parsed.weeklyMeals) || !Array.isArray(parsed.shoppingItems)) {
      return null;
    }

    return {
      recipes: parsed.recipes.map((recipe) => {
        const legacyRecipe = recipe as Recipe & { instructions?: unknown[]; servings?: number; prepTimeMinutes?: number };
        return {
          ...legacyRecipe,
          tags: Array.isArray(legacyRecipe.tags) ? legacyRecipe.tags.filter((tag): tag is string => typeof tag === 'string') : [],
          link: typeof legacyRecipe.link === 'string'
            ? legacyRecipe.link
            : Array.isArray(legacyRecipe.instructions) && typeof legacyRecipe.instructions[0] === 'string'
              ? legacyRecipe.instructions[0]
              : ''
        };
      }) as Recipe[],
      weeklyMeals: parsed.weeklyMeals as WeeklyMeal[],
      shoppingItems: parsed.shoppingItems as ShoppingItem[],
      pantryItems: Array.isArray(parsed.pantryItems) ? parsed.pantryItems as PantryItem[] : []
    };
  } catch {
    return null;
  }
}

export function saveAppState(state: AppState): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
