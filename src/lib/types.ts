export type DayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export type MealSlot = 'breakfast' | 'lunch' | 'dinner';

export interface Recipe {
  id: string;
  title: string;
  tags: string[];
  countries: string[];
  seasons: string[];
  ingredients: string[];
  instructions: string[];
  link: string;
  updatedAt: number;
  createdAt: number;
}

export interface WeeklyMeal {
  id: string;
  weekStart: string;
  day: DayKey;
  slot: MealSlot;
  recipeId: string;
  recipeTitle: string;
  note: string;
  updatedAt: number;
  createdAt: number;
}

export interface ShoppingItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  aisle: string;
  checked: boolean;
  updatedAt: number;
  createdAt: number;
}

export interface PantryItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  updatedAt: number;
  createdAt: number;
}

export interface AppState {
  recipes: Recipe[];
  weeklyMeals: WeeklyMeal[];
  shoppingItems: ShoppingItem[];
  pantryItems: PantryItem[];
}
