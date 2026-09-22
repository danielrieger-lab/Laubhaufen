import { getApps, initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  type Firestore
} from 'firebase/firestore';
import type { AppState, PantryItem, Recipe, ShoppingItem, WeeklyMeal } from './types';

type FirebaseConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

type FirebaseServices = {
  auth: Auth;
  db: Firestore;
  authReady: Promise<void>;
};

function readConfig(): FirebaseConfig | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined;
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined;
  const storageBucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined;
  const messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined;
  const appId = import.meta.env.VITE_FIREBASE_APP_ID as string | undefined;

  if (!apiKey || !authDomain || !projectId || !storageBucket || !messagingSenderId || !appId) {
    return null;
  }

  return { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId };
}

export function getFirebaseServices(): FirebaseServices | null {
  const config = readConfig();

  if (!config) {
    return null;
  }

  const app = getApps().length > 0 ? getApps()[0] : initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);

  return {
    auth,
    db,
    authReady: auth.currentUser ? Promise.resolve() : signInAnonymously(auth).then(() => undefined)
  };
}

function recipesRef(db: Firestore) {
  return collection(db, 'recipes');
}

function mealsRef(db: Firestore) {
  return collection(db, 'weeklyMeals');
}

function shoppingRef(db: Firestore) {
  return collection(db, 'shoppingItems');
}

function pantryRef(db: Firestore) {
  return collection(db, 'pantryItems');
}

function normalizeStrings(values: unknown): string[] {
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [];
}

function normalizeRecipe(id: string, data: Record<string, unknown>): Recipe {
  const legacyInstructions = normalizeStrings(data.instructions);

  return {
    id,
    title: typeof data.title === 'string' ? data.title : 'Unbenanntes Rezept',
    tags: normalizeStrings(data.tags),
    countries: normalizeStrings(data.countries),
    seasons: normalizeStrings(data.seasons),
    ingredients: normalizeStrings(data.ingredients),
    instructions: legacyInstructions,
    link: typeof data.link === 'string' ? data.link : legacyInstructions[0] ?? '',
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : Date.now(),
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now()
  };
}

function normalizeMeal(id: string, data: Record<string, unknown>): WeeklyMeal {
  return {
    id,
    weekStart: typeof data.weekStart === 'string' ? data.weekStart : '',
    day: data.day === 'monday' || data.day === 'tuesday' || data.day === 'wednesday' || data.day === 'thursday' || data.day === 'friday' || data.day === 'saturday' || data.day === 'sunday' ? data.day : 'monday',
    slot: data.slot === 'breakfast' || data.slot === 'lunch' || data.slot === 'dinner' ? data.slot : 'dinner',
    recipeId: typeof data.recipeId === 'string' ? data.recipeId : '',
    recipeTitle: typeof data.recipeTitle === 'string' ? data.recipeTitle : 'Eigenes Gericht',
    note: typeof data.note === 'string' ? data.note : '',
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : Date.now(),
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now()
  };
}

function normalizeShoppingItem(id: string, data: Record<string, unknown>): ShoppingItem {
  return {
    id,
    name: typeof data.name === 'string' ? data.name : 'Unnamed item',
    quantity: typeof data.quantity === 'number' ? data.quantity : 1,
    unit: typeof data.unit === 'string' ? data.unit : 'Stück',
    aisle: typeof data.aisle === 'string' ? data.aisle : 'Allgemein',
    checked: typeof data.checked === 'boolean' ? data.checked : false,
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : Date.now(),
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now()
  };
}

function normalizePantryItem(id: string, data: Record<string, unknown>): PantryItem {
  return {
    id,
    name: typeof data.name === 'string' ? data.name : 'Unbekannte Zutat',
    quantity: typeof data.quantity === 'number' ? data.quantity : 1,
    unit: typeof data.unit === 'string' ? data.unit : 'Stück',
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : Date.now(),
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now()
  };
}

function subscribeToCollection<T>(
  db: Firestore,
  refFactory: (db: Firestore) => ReturnType<typeof collection>,
  normalize: (id: string, data: Record<string, unknown>) => T,
  onItems: (items: T[]) => void,
  onError?: (error: Error) => void
) {
  const itemsQuery = query(refFactory(db), orderBy('updatedAt', 'desc'));

  return onSnapshot(itemsQuery, (snapshot) => {
    onItems(snapshot.docs.map((document) => normalize(document.id, document.data() as Record<string, unknown>)));
  }, onError);
}

export function subscribeToRecipes(db: Firestore, onRecipes: (recipes: Recipe[]) => void, onError?: (error: Error) => void) {
  return subscribeToCollection(db, recipesRef, normalizeRecipe, onRecipes, onError);
}

export function subscribeToWeeklyMeals(db: Firestore, onMeals: (meals: WeeklyMeal[]) => void, onError?: (error: Error) => void) {
  return subscribeToCollection(db, mealsRef, normalizeMeal, onMeals, onError);
}

export function subscribeToShoppingItems(db: Firestore, onItems: (items: ShoppingItem[]) => void, onError?: (error: Error) => void) {
  return subscribeToCollection(db, shoppingRef, normalizeShoppingItem, onItems, onError);
}

export function subscribeToPantryItems(db: Firestore, onItems: (items: PantryItem[]) => void, onError?: (error: Error) => void) {
  return subscribeToCollection(db, pantryRef, normalizePantryItem, onItems, onError);
}

export async function upsertRecipe(db: Firestore, recipe: Recipe): Promise<void> {
  await setDoc(doc(recipesRef(db), recipe.id), recipe);
}

export async function upsertWeeklyMeal(db: Firestore, meal: WeeklyMeal): Promise<void> {
  await setDoc(doc(mealsRef(db), meal.id), meal);
}

export async function upsertShoppingItem(db: Firestore, item: ShoppingItem): Promise<void> {
  await setDoc(doc(shoppingRef(db), item.id), item);
}

export async function upsertPantryItem(db: Firestore, item: PantryItem): Promise<void> {
  await setDoc(doc(pantryRef(db), item.id), item);
}

export async function deleteRecipe(db: Firestore, recipeId: string): Promise<void> {
  await deleteDoc(doc(recipesRef(db), recipeId));
}

export async function deleteWeeklyMeal(db: Firestore, mealId: string): Promise<void> {
  await deleteDoc(doc(mealsRef(db), mealId));
}

export async function deleteShoppingItem(db: Firestore, itemId: string): Promise<void> {
  await deleteDoc(doc(shoppingRef(db), itemId));
}

export async function deletePantryItem(db: Firestore, itemId: string): Promise<void> {
  await deleteDoc(doc(pantryRef(db), itemId));
}

export async function seedIfEmpty(db: Firestore, state: AppState): Promise<void> {
  const [recipesSnap, mealsSnap, shoppingSnap, pantrySnap] = await Promise.all([
    getDocs(recipesRef(db)),
    getDocs(mealsRef(db)),
    getDocs(shoppingRef(db)),
    getDocs(pantryRef(db))
  ]);

  const writes: Promise<void>[] = [];

  if (recipesSnap.empty) {
    writes.push(...state.recipes.map((recipe) => upsertRecipe(db, recipe)));
  }

  if (mealsSnap.empty) {
    writes.push(...state.weeklyMeals.map((meal) => upsertWeeklyMeal(db, meal)));
  }

  if (shoppingSnap.empty) {
    writes.push(...state.shoppingItems.map((item) => upsertShoppingItem(db, item)));
  }

  if (pantrySnap.empty) {
    writes.push(...state.pantryItems.map((item) => upsertPantryItem(db, item)));
  }

  await Promise.all(writes);
}
